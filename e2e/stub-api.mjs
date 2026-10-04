import { createServer } from 'node:http';

/**
 * A stand-in for the Flexa API's two internal routes, for the drive.
 *
 * **It is not a mock of the panel's own code** — the panel talks to it over
 * real HTTP with a real secret header, and it answers the real contract from
 * `apps/api/src/ops/clinics/clinic-ops.service.ts`, including the refusals. Its
 * job is to make the panel drivable on a machine with no Postgres, and to be
 * the OTHER side of the wire so that what the drive proves is a request the
 * real API would accept.
 *
 * The one rule it copies rather than approximates: **a re-disable does not move
 * the timestamp.** That is the invariant the API holds in a conditional
 * `updateMany`, and a stub that quietly restamped would let the panel ship a
 * bug the real thing refuses.
 */
const SECRET = process.env.STUB_OPS_SECRET ?? 'stub-secret';

const clinics = new Map(
  [
    {
      id: 'cedar',
      name: 'Cedar & Stone Clinic',
      area: 'Achrafieh',
      bookingSlug: 'cedar-stone',
      published: true,
      disabledAt: null,
      disabledReason: null,
      clientRemindersEnabled: true,
      staffDigestEnabled: true,
    },
    {
      id: 'la-lune',
      name: 'La Lune',
      area: 'Jounieh',
      bookingSlug: 'la-lune',
      published: true,
      disabledAt: '2026-09-01T05:00:00.000Z',
      disabledReason: 'Non-payment — suspended pending contact',
      clientRemindersEnabled: true,
      staffDigestEnabled: false,
    },
    {
      id: 'nour',
      name: 'Nour Beauty Lounge',
      area: 'Tripoli',
      bookingSlug: null,
      published: false,
      disabledAt: null,
      disabledReason: null,
      clientRemindersEnabled: true,
      staffDigestEnabled: true,
    },
  ].map((c) => [c.id, c]),
);

/**
 * Client forms (→ D257): one form per clinic, versioned. The stub keeps the
 * three rules the drive leans on — an unknown property is refused with its
 * path, a field key keeps its type across versions, and an identical publish
 * adds no version — and leaves the rest of the validation to the real API,
 * which is the authority (`apps/api/src/clients/forms/client-form-schema.ts`).
 */
const forms = new Map([
  [
    'la-lune',
    {
      disabledAt: null,
      entries: 2,
      versions: [
        {
          version: 1,
          versionId: 'ver-la-lune-1',
          publishedAt: '2026-10-04T12:00:00.000Z',
          template: {
            title: 'Skin care',
            sections: [
              {
                key: 'history',
                title: 'History',
                fields: [{ type: 'longText', key: 'history' }],
              },
            ],
          },
        },
      ],
    },
  ],
]);

/**
 * Papers (→ D258): the keys the paper upload has answered. The API's own rule
 * the stub keeps — **a layout must name a paper that exists** — so a template
 * naming any other key is refused at check, publish and sample alike, with the
 * same path and words (`client-form-ops.service.ts`'s `missingPaper`).
 */
const papers = new Set();
/// Every request that reached the paper route, refused or not — so the drive
/// can tell "the panel refused it" from "the API refused it", which word for
/// word say the same thing.
let paperRequests = 0;

/// The smallest file that starts the way a PDF must — the sample's stand-in.
const STUB_PDF = Buffer.from('%PDF-1.4\n% stub sample\n%%EOF\n', 'latin1');

function refusePrint(template) {
  const print = template?.print;
  if (print === undefined) return null;
  if (!papers.has(print.background)) {
    return {
      path: 'print.background',
      reason: 'BAD_VALUE',
      message:
        "No uploaded paper has that key. Upload the clinic's paper PDF first and use the key it answers with.",
    };
  }
  return null;
}

/// The one `file` part of a multipart body, as bytes — or null when there is
/// none. Just enough of RFC 7578 for the drive's own requests.
function filePart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(marker);
  while (at !== -1) {
    const next = body.indexOf(marker, at + marker.length);
    if (next === -1) break;
    const part = body.subarray(at + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('latin1');
    if (/name="file"/.test(head)) return part.subarray(split + 4);
    at = next;
  }
  return null;
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const FIELD_PROPS = new Set([
  'type', 'key', 'label', 'hint', 'options', 'columns', 'rows', 'source',
]);

function refuseTemplate(template, priorVersions) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    return { path: '', reason: 'NOT_AN_OBJECT', message: 'A template must be a JSON object.' };
  }
  if (typeof template.title !== 'string' || !template.title.trim()) {
    return { path: 'title', reason: 'REQUIRED', message: 'A form needs a title.' };
  }
  if (!Array.isArray(template.sections) || template.sections.length === 0) {
    return { path: 'sections', reason: 'TOO_FEW', message: 'A form needs at least one section.' };
  }
  const was = new Map(
    priorVersions.flatMap((v) =>
      v.template.sections.flatMap((s) => s.fields.map((f) => [f.key, f.type])),
    ),
  );
  for (const [i, section] of template.sections.entries()) {
    for (const [j, field] of (section.fields ?? []).entries()) {
      for (const prop of Object.keys(field)) {
        if (!FIELD_PROPS.has(prop)) {
          return {
            path: `sections[${i}].fields[${j}].${prop}`,
            reason: 'UNKNOWN_PROPERTY',
            message: `"${prop}" is not something a field can have.`,
          };
        }
      }
      const before = was.get(field.key);
      if (before && before !== field.type) {
        return {
          path: `sections[${i}].fields[${j}].type`,
          reason: 'RETYPED',
          message: `"${field.key}" was a ${before} field in an earlier version, and a key keeps its type.`,
        };
      }
    }
  }
  return null;
}

function formView(clinic) {
  const form = forms.get(clinic.id);
  const latest = form?.versions.at(-1) ?? null;
  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    live: !!form && latest !== null && form.disabledAt === null,
    disabledAt: form?.disabledAt ?? null,
    version: latest?.version ?? null,
    versionId: latest?.versionId ?? null,
    publishedAt: latest?.publishedAt ?? null,
    template: latest?.template ?? null,
    entries: form?.entries ?? 0,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://stub');

  // The drive's own back door, so an assertion can read what the API holds
  // rather than what the page says it holds.
  if (url.pathname === '/__state') {
    // The nonce is how the drive knows this is the stub IT started. A stale
    // server left on this port from an earlier run answered the panel with a
    // different secret, and the drive read the resulting 403 as a panel bug —
    // ten minutes of looking in the wrong place. Identity, not politeness.
    return send(res, 200, {
      nonce: process.env.STUB_NONCE ?? '',
      clinics: [...clinics.values()],
      forms: Object.fromEntries(forms),
      papers: [...papers],
      paperRequests,
    });
  }

  if (req.headers['x-ops-secret'] !== SECRET) {
    return send(res, 403, { code: 'BAD_OPS_SECRET' });
  }

  if (req.method === 'GET' && url.pathname === '/v1/internal/clinics') {
    return send(res, 200, [...clinics.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  // → D258 · the paper upload and the sample, ahead of the form routes.
  const paperRoute = /^\/v1\/internal\/clinics\/([^/]+)\/form\/(paper|sample)$/.exec(url.pathname);
  if (req.method === 'POST' && paperRoute) {
    const clinic = clinics.get(decodeURIComponent(paperRoute[1]));
    if (!clinic) return send(res, 404, { code: 'CLINIC_NOT_FOUND' });

    if (paperRoute[2] === 'paper') {
      paperRequests += 1;
      const bytes = filePart(await readRaw(req), req.headers['content-type']);
      if (!bytes || bytes.length === 0) return send(res, 400, { code: 'NO_DOCUMENT' });
      // Bytes decide, never the name or the declared type (→ D115).
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return send(res, 400, { code: 'UNSUPPORTED_DOCUMENT_TYPE' });
      }
      const key = `prv-stub-paper-${papers.size + 1}.pdf`;
      papers.add(key);
      return send(res, 201, { key, pages: [{ width: 595.2756, height: 841.8898 }] });
    }

    const body = await readBody(req);
    const form = forms.get(clinic.id);
    const template = body.template ?? form?.versions.at(-1)?.template;
    if (body.template !== undefined) {
      const refusal = refuseTemplate(body.template, form?.versions ?? []);
      if (refusal) return send(res, 400, { code: 'BAD_FORM_TEMPLATE', ...refusal });
    }
    if (template?.print === undefined) {
      return send(res, 400, {
        code: 'BAD_FORM_TEMPLATE',
        path: 'print',
        reason: 'REQUIRED',
        message: 'This template has no "print" layout, so there is no paper to draw a sample on.',
      });
    }
    const missing = refusePrint(template);
    if (missing) return send(res, 400, { code: 'BAD_FORM_TEMPLATE', ...missing });
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="Sample.pdf"',
    });
    return res.end(STUB_PDF);
  }

  const formRoute = /^\/v1\/internal\/clinics\/([^/]+)\/form(\/check)?$/.exec(url.pathname);
  if (formRoute) {
    const clinic = clinics.get(decodeURIComponent(formRoute[1]));
    if (!clinic) return send(res, 404, { code: 'CLINIC_NOT_FOUND' });
    const isCheck = formRoute[2] === '/check';

    if (req.method === 'GET' && !isCheck) return send(res, 200, formView(clinic));

    if (req.method === 'DELETE' && !isCheck) {
      const form = forms.get(clinic.id);
      // The API's invariant: a re-switch-off keeps the date it went off.
      if (form && form.disabledAt === null) form.disabledAt = new Date().toISOString();
      return send(res, 200, formView(clinic));
    }

    if ((req.method === 'POST' && isCheck) || (req.method === 'PUT' && !isCheck)) {
      const body = await readBody(req);
      const form = forms.get(clinic.id) ?? { disabledAt: null, entries: 0, versions: [] };
      const refusal = refuseTemplate(body.template, form.versions) ?? refusePrint(body.template);
      if (refusal) return send(res, 400, { code: 'BAD_FORM_TEMPLATE', ...refusal });
      if (isCheck) return send(res, 200, { ok: true, template: body.template });

      const latest = form.versions.at(-1);
      if (!latest || JSON.stringify(latest.template) !== JSON.stringify(body.template)) {
        const version = (latest?.version ?? 0) + 1;
        form.versions.push({
          version,
          versionId: `ver-${clinic.id}-${version}`,
          publishedAt: new Date().toISOString(),
          template: body.template,
        });
      }
      form.disabledAt = null;
      forms.set(clinic.id, form);
      return send(res, 200, formView(clinic));
    }
  }

  const patch = /^\/v1\/internal\/clinics\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'PATCH' && patch) {
    const body = JSON.parse(
      await new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => resolve(raw || '{}'));
      }),
    );
    if (Object.keys(body).length === 0) {
      return send(res, 400, { code: 'NOTHING_TO_UPDATE' });
    }
    if (body.disabledReason !== undefined && body.disabled !== true) {
      return send(res, 400, { code: 'REASON_WITHOUT_DISABLE' });
    }
    const clinic = clinics.get(decodeURIComponent(patch[1]));
    if (!clinic) return send(res, 404, { code: 'CLINIC_NOT_FOUND' });

    if (body.disabled === true) {
      // The invariant: already off keeps the date it went off.
      if (clinic.disabledAt === null) clinic.disabledAt = new Date().toISOString();
      if (body.disabledReason !== undefined) clinic.disabledReason = body.disabledReason;
    } else if (body.disabled === false) {
      clinic.disabledAt = null;
      clinic.disabledReason = null;
    }
    if (body.clientRemindersEnabled !== undefined) {
      clinic.clientRemindersEnabled = body.clientRemindersEnabled;
    }
    if (body.staffDigestEnabled !== undefined) {
      clinic.staffDigestEnabled = body.staffDigestEnabled;
    }
    return send(res, 200, clinic);
  }

  send(res, 404, { code: 'NOT_FOUND' });
});

server.listen(Number(process.env.STUB_PORT ?? 4310), () => {
  process.stdout.write('stub-api listening\n');
});
