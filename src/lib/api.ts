/// The panel's whole view of the Flexa API (→ D215): two internal routes,
/// called from the server and never from a browser.
///
/// **This file is the contract's other side.** The API's own source of it is
/// `apps/api/src/ops/clinics/clinic-ops.service.ts`, which cannot be imported
/// here — the panel is a separate repository, and `@flexa/shared` exists so the
/// two *clients* agree about shapes, neither of which may call these routes at
/// all. So the shape is restated, and the pair is kept honest by both being
/// written from that one file.

/// **Every function here runs on the server, and only on the server**, because
/// each one sends `OPS_SECRET` — the credential that can switch a clinic off.
/// There is no `NEXT_PUBLIC_` variable in this app and there must never be one:
/// a browser that could call these routes is a browser that holds the secret,
/// and a page's JavaScript is public by definition.
///
/// The throw below is not decoration. It turns "somebody imported this from a
/// client component" from a silent credential leak into a crash on the first
/// render — which is the difference between finding out now and never.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/api.ts reached the browser bundle — it carries the ops secret.',
  );
}

/// One clinic as the operator sees it — the four columns that are ours, plus
/// just enough to recognise the row. Deliberately not the clinic's own data:
/// this panel has no business reading a menu, a client list or a calendar, and
/// the API does not send them.
export interface OpsClinic {
  id: string;
  name: string;
  area: string;
  bookingSlug: string | null;
  /// The OWNER's own answer to "am I ready to be found". Shown here, written by
  /// nothing here: a suspension must not destroy it.
  published: boolean;
  /// ISO instant, or null while the clinic is running.
  disabledAt: string | null;
  disabledReason: string | null;
  clientRemindersEnabled: boolean;
  staffDigestEnabled: boolean;
}

export interface ClinicOpsPatch {
  disabled?: boolean;
  disabledReason?: string;
  clientRemindersEnabled?: boolean;
  staffDigestEnabled?: boolean;
}

/// What went wrong, in words a person at a desk can act on. The panel renders
/// this; it never renders a stack trace, and it never renders the raw body of a
/// response that might carry the secret back.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function config(): { baseUrl: string; secret: string } {
  const baseUrl = (process.env.FLEXA_API_BASE_URL ?? '').replace(/\/+$/, '');
  const secret = process.env.OPS_SECRET ?? '';
  if (!baseUrl || !secret) {
    throw new ApiError(
      'This panel is not configured: FLEXA_API_BASE_URL and OPS_SECRET must both be set.',
      'NOT_CONFIGURED',
    );
  }
  return { baseUrl, secret };
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const { baseUrl, secret } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        // The credential is spent HERE, on the server. It is the whole reason
        // every call in this panel goes through a server action or a server
        // component: a browser that could make this request would have to hold
        // this string, and then the panel's password would be decoration.
        'x-ops-secret': secret,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Never cached. An operator panel that showed a clinic as running after
      // somebody switched it off would be worse than no panel.
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      `Could not reach the Flexa API at ${baseUrl}.`,
      'UNREACHABLE',
    );
  }

  if (!response.ok) {
    // The API answers typed codes, never prose (`apps/api/CLAUDE.md`), so this
    // reads the code and says what each one means for the person reading it.
    const code = await codeOf(response);
    throw new ApiError(messageFor(response.status, code), code);
  }
  return (await response.json()) as T;
}

async function codeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string };
    return body.code ?? `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}

function messageFor(status: number, code: string): string {
  switch (code) {
    case 'OPS_DISABLED':
      return 'The API has no OPS_SECRET set, so it is refusing every operator request. Set it on the API and restart it.';
    case 'BAD_OPS_SECRET':
      return "This panel's OPS_SECRET does not match the API's. They must be the same string.";
    case 'CLINIC_NOT_FOUND':
      return 'That clinic no longer exists.';
    case 'REASON_WITHOUT_DISABLE':
      return 'A reason can only be given while switching a clinic off.';
    case 'NOTHING_TO_UPDATE':
      return 'Nothing was changed.';
    default:
      return `The API refused the request (${status} ${code}).`;
  }
}

export function listClinics(): Promise<OpsClinic[]> {
  return call<OpsClinic[]>('/internal/clinics', { method: 'GET' });
}

export function patchClinic(
  id: string,
  patch: ClinicOpsPatch,
): Promise<OpsClinic> {
  return call<OpsClinic>(`/internal/clinics/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
}

/// One clinic, out of the list.
///
/// There is no `GET /internal/clinics/:id` on the API and deliberately so: this
/// deployment has single-digit clinics, the list is one small request, and a
/// second route would be a second read of the same rows to keep in step with
/// the first — the "two reads, one question" invariant in `apps/api/CLAUDE.md`,
/// which exists because that drift already shipped a deactivated practitioner
/// onto a clinic's public page (→ D198).
export async function clinicById(id: string): Promise<OpsClinic | null> {
  return (await listClinics()).find((clinic) => clinic.id === id) ?? null;
}
