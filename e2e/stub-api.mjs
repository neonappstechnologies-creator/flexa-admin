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
    });
  }

  if (req.headers['x-ops-secret'] !== SECRET) {
    return send(res, 403, { code: 'BAD_OPS_SECRET' });
  }

  if (req.method === 'GET' && url.pathname === '/v1/internal/clinics') {
    return send(res, 200, [...clinics.values()].sort((a, b) => a.name.localeCompare(b.name)));
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
