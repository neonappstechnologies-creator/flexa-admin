'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import {
  ApiError,
  checkClientForm,
  patchClinic,
  publishClientForm,
  switchOffClientForm,
  type ClinicOpsPatch,
  type OpsFormTemplate,
} from '@/lib/api';
import { isSignedIn, signIn, signOut } from '@/lib/session';

/// Every server action re-checks the session (→ D215).
///
/// A server action is a **POST endpoint**, reachable by anything that can find
/// its id — not a function the page privately calls. Guarding only the page
/// that draws the buttons would therefore guard nothing.
///
/// **Today it is the second line, not the first**, and the honest version of
/// that sentence matters: `proxy.ts`'s matcher is path-based, so it covers this
/// POST as well as the GET that rendered the form, and a signed-out replay is
/// turned away before it reaches here. That is measured — `e2e/drive.mjs`
/// replays a real form with the cookie removed and gets the redirect — and so
/// is the consequence: deleting this check leaves the whole drive green,
/// because nothing reaches it. It stays for the day the matcher changes, a
/// route moves out from under it, or Next stops routing action POSTs through
/// the proxy. Untested from outside, deliberate, and said out loud rather than
/// left looking covered.
async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) redirect('/login');
}

export async function signInAction(
  _prev: string | null,
  form: FormData,
): Promise<string | null> {
  const ok = await signIn(String(form.get('password') ?? ''));
  // One message for a wrong password and for a panel with nothing configured.
  // The sign-in screen is the one surface a stranger can reach, and "no
  // password is set" is a sentence worth not saying out loud.
  if (!ok) return 'That password was not right.';
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}

/**
 * Moves ONE switch on one clinic.
 *
 * **The form carries the value being moved TO, never a toggle** of whatever the
 * page happened to be showing. That is what makes two operators with the panel
 * open safe: a stale page can only ever re-assert a value somebody already
 * chose, never invert a change it never saw. It is also why there is no Save
 * button batching four fields — "switch this clinic off" must be a press whose
 * label says so, not a side effect of adjusting a reminder and pressing Save.
 *
 * It returns an error string rather than throwing, so a clinic that could not
 * be reached leaves the page standing with a sentence on it instead of
 * replacing the panel with an error screen.
 */
export async function updateClinicAction(
  _prev: string | null,
  form: FormData,
): Promise<string | null> {
  await requireSession();

  const id = String(form.get('clinicId') ?? '');
  if (!id) return 'That form was missing its clinic.';

  const patch: ClinicOpsPatch = {};
  const field = form.get('field');
  const value = form.get('value') === 'true';

  if (field === 'disabled') {
    patch.disabled = value;
    const reason = String(form.get('disabledReason') ?? '').trim();
    // A reason travels only with a switch-off: the API refuses it otherwise
    // (`REASON_WITHOUT_DISABLE`), and a panel that knowingly sends a request it
    // knows will be refused is a panel that teaches its operator to ignore
    // errors.
    if (value && reason) patch.disabledReason = reason;
  } else if (field === 'clientRemindersEnabled') {
    patch.clientRemindersEnabled = value;
  } else if (field === 'staffDigestEnabled') {
    patch.staffDigestEnabled = value;
  } else {
    return 'That form asked for a switch this panel does not have.';
  }

  try {
    await patchClinic(id, patch);
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  }
  revalidatePath('/');
  revalidatePath(`/clinics/${id}`);
  return null;
}

// ── Client forms (→ D257) ─────────────────────────────────────────────────────

/// What the template editor shows after a press. `text` is ALWAYS handed back,
/// refused or not, so a template that failed a check stays in the box exactly
/// as it was typed — an editor that emptied a two-hundred-line document over a
/// missing comma would be one nobody could use twice.
export interface ClientFormEditorState {
  text: string;
  error: string | null;
  notice: string | null;
  preview: OpsFormTemplate | null;
}

/**
 * Checks or publishes a clinic's client form, from the same box.
 *
 * Two buttons, one form, told apart by `intent` — because the operator's
 * workflow is check → read the preview → publish, and making them retype or
 * re-paste the document between the two would be how the published template
 * ends up being a different one from the template they checked.
 *
 * The API validates everything (`clients/forms/client-form-schema.ts`); this
 * only refuses what it cannot even send — text that is not JSON.
 */
export async function clientFormAction(
  prev: ClientFormEditorState,
  form: FormData,
): Promise<ClientFormEditorState> {
  await requireSession();

  const id = String(form.get('clinicId') ?? '');
  const text = String(form.get('template') ?? '');
  const intent = form.get('intent');
  if (!id) {
    return { ...prev, text, error: 'That form was missing its clinic.', notice: null };
  }

  let template: unknown;
  try {
    template = JSON.parse(text);
  } catch (error) {
    return {
      text,
      error: `That is not valid JSON: ${(error as Error).message}`,
      notice: null,
      preview: null,
    };
  }

  try {
    if (intent === 'check') {
      const checked = await checkClientForm(id, template);
      return {
        text,
        error: null,
        notice: 'The template is valid. Below is how the desk will see it.',
        preview: checked.template,
      };
    }
    if (intent === 'publish') {
      const before = Number(form.get('currentVersion') ?? '') || null;
      const published = await publishClientForm(id, template);
      revalidatePath(`/clinics/${id}`);
      revalidatePath(`/clinics/${id}/form`);
      return {
        // What the API stored, not what was typed: the two differ by exactly
        // the normalization (trimmed words, dropped empty labels), and the box
        // should hold the template the desk is now drawing.
        text: JSON.stringify(published.template, null, 2),
        error: null,
        notice:
          published.version === before
            ? `Nothing in the template changed, so it is still version ${published.version} — and it is live.`
            : `Published as version ${published.version}. The desk sees it the next time a client's record is opened.`,
        preview: published.template,
      };
    }
    return { ...prev, text, error: 'That form asked for something this panel does not do.', notice: null };
  } catch (error) {
    if (error instanceof ApiError) {
      return { text, error: error.message, notice: null, preview: null };
    }
    throw error;
  }
}

/// Puts a clinic back on its default notes. The filled files are kept by the
/// API and come back the moment a version is published again.
export async function switchOffClientFormAction(
  _prev: string | null,
  form: FormData,
): Promise<string | null> {
  await requireSession();

  const id = String(form.get('clinicId') ?? '');
  if (!id) return 'That form was missing its clinic.';

  try {
    await switchOffClientForm(id);
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  }
  revalidatePath(`/clinics/${id}`);
  revalidatePath(`/clinics/${id}/form`);
  return null;
}
