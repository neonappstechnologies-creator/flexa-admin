/**
 * The panel, driven in a real browser against the REAL API and a real Postgres
 * (→ D215).
 *
 * This is the companion to `drive.mjs`, not a replacement for it, and the split
 * is the point:
 *
 *   * `drive.mjs` is hermetic — a stub API, no database, runs anywhere, and is
 *     what `npm run e2e` runs. It proves the panel's own chain and its security
 *     properties (cookie flags, forged cookies, a signed-out replay).
 *   * this one proves the half that one states it cannot: that the switches
 *     reach real SQL, and that "switched off" actually bites the surfaces it
 *     claims to — the client catalogue, and every provider door.
 *
 * It needs both processes up, and says so rather than starting them: the API is
 * `pnpm dev` in `apps/api` against `pnpm db:up`, with `OPS_SECRET` set.
 *
 *   API=http://127.0.0.1:3001/v1 OPS=test-ops PANEL=http://127.0.0.1:3100 \
 *     PASSWORD=drive-pw node e2e/drive-live.mjs
 */
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright-core';

const PANEL = process.env.PANEL ?? 'http://127.0.0.1:3100';
const API = process.env.API ?? 'http://127.0.0.1:3001/v1';
const OPS = process.env.OPS ?? 'test-ops';
const PASSWORD = process.env.PASSWORD ?? 'drive-pw';
const CLINIC = process.env.CLINIC ?? 'cedar';
/// The template the client-form section publishes (→ D257): La Lune's real one,
/// read from the flexa-beauty checkout beside this repo, so the drive proves the
/// file we will actually paste — not a template invented for the test.
const FORM_FILE =
  process.env.FORM_FILE ?? '../flexa-beauty/apps/api/client-forms/la-lune.json';

/// Chrome is used where it is installed rather than downloaded: `playwright-core`
/// ships no browser on purpose, and this machine has one.
const CHROME =
  process.env.CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const fails = [];
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(label);
};
const ops = async (path, init) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { 'x-ops-secret': OPS, 'content-type': 'application/json' },
  });
const clinic = async () =>
  (await (await ops('/internal/clinics')).json()).find((c) => c.id === CLINIC);

for (const [name, url] of [
  ['panel', `${PANEL}/login`],
  ['API', `${API}/health`],
]) {
  try {
    await fetch(url);
  } catch {
    console.error(`${name} is not running at ${url}`);
    process.exit(2);
  }
}

const before = await clinic();
if (!before) {
  console.error(`no clinic '${CLINIC}' on this API`);
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
const badResponses = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// A console "Failed to load resource" names no URL, so the response is what is
// recorded — an unactionable failure is not worth asserting on.
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});

try {
  console.log('\n1 · the gate');
  await page.goto(`${PANEL}/clinics/${CLINIC}`, { waitUntil: 'networkidle' });
  check('a signed-out deep link lands on /login', page.url().endsWith('/login'));
  check('and no page ever carries the ops secret', !(await page.content()).includes(OPS));

  console.log('\n2 · signing in');
  await page.fill('input[type=password]', 'not-the-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.notice.bad');
  check('a wrong password is refused, visibly', true);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${PANEL}/`, { timeout: 15000 });
  await page.waitForSelector('.row');
  check('the right one lands on the list', (await page.$$('.row')).length > 0);

  console.log('\n3 · one reminder switch, and only that one');
  await page.goto(`${PANEL}/clinics/${CLINIC}`, { waitUntil: 'networkidle' });
  const wasDigest = before.staffDigestEnabled;
  await page.click('.switch:last-of-type button');
  await page.waitForFunction(
    (want) => document.querySelectorAll('.switch .chip')[1]?.textContent === want,
    wasDigest ? 'Off' : 'On',
    { timeout: 15000 },
  );
  const afterDigest = await clinic();
  check('the database moved', afterDigest.staffDigestEnabled === !wasDigest);
  check(
    'and the other switch did not',
    afterDigest.clientRemindersEnabled === before.clientRemindersEnabled,
  );

  console.log('\n4 · switching the clinic off');
  await page.fill('textarea[name=disabledReason]', 'Driving the panel');
  await page.click('button.destructive');
  await page.waitForSelector('.card.danger', { timeout: 15000 });
  const off = await clinic();
  check('the API recorded when', off.disabledAt !== null, off.disabledAt);
  check('and why', off.disabledReason === 'Driving the panel');
  check("the owner's published flag never moved", off.published === before.published);

  console.log('\n5 · what that actually does to a client');
  const list = await (await fetch(`${API}/clinics`)).json();
  check('gone from the client catalogue', !list.some((c) => c.id === CLINIC));
  check('its profile 404s', (await fetch(`${API}/clinics/${CLINIC}`)).status === 404);
  check(
    'its slot grid 404s',
    (await fetch(`${API}/clinics/${CLINIC}/slots?date=2026-09-10`)).status === 404,
  );

  console.log('\n6 · and to a desk that is already signed in');
  // The token is minted BEFORE the switch, so this is the claim that matters:
  // an open desk stops inside the request, not at the end of its 24-hour token.
  const provider = process.env.PROVIDER_PHONE ?? '+9613700001';
  await ops(`/internal/clinics/${CLINIC}`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled: false }),
  });
  const req = await (
    await fetch(`${API}/provider/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: provider }),
    })
  ).json();
  if (!req.devCode) {
    check('a provider session could be minted (needs OTP_EXPOSE_DEV_CODE)', false);
  } else {
    const session = await (
      await fetch(`${API}/provider/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: provider, code: req.devCode }),
      })
    ).json();
    const auth = { authorization: `Bearer ${session.token}` };
    check('signs in while the clinic runs', (await fetch(`${API}/provider/clinic`, { headers: auth })).status === 200);

    await ops(`/internal/clinics/${CLINIC}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled: true, disabledReason: 'Driving the panel' }),
    });
    const codeOf = async (r) => `${r.status} ${(await r.json()).code}`;
    check(
      'the open session is refused at once',
      (await codeOf(await fetch(`${API}/provider/clinic`, { headers: auth }))) ===
        '403 CLINIC_DISABLED',
    );
    check(
      'so is restoring it',
      (await codeOf(await fetch(`${API}/provider/auth/me`, { headers: auth }))) ===
        '403 CLINIC_DISABLED',
    );
    check(
      'so is refreshing it',
      (await codeOf(
        await fetch(`${API}/provider/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        }),
      )) === '403 CLINIC_DISABLED',
    );
  }

  console.log('\n7 · switching it back on');
  await page.goto(`${PANEL}/clinics/${CLINIC}`, { waitUntil: 'networkidle' });
  await page.click('.card.danger button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.card.danger'), null, {
    timeout: 15000,
  });
  const back = await clinic();
  check('it is running again', back.disabledAt === null);
  check('the reason went with the suspension', back.disabledReason === null);
  check('and it is bookable again', (await fetch(`${API}/clinics/${CLINIC}`)).status === 200);

  console.log('\n7b · a client form, published from here and filled at the desk (→ D257)');
  const template = readFileSync(FORM_FILE, 'utf8');
  const formState = async () =>
    (await ops(`/internal/clinics/${CLINIC}/form`)).json();
  const formBefore = await formState();
  await page.goto(`${PANEL}/clinics/${CLINIC}/form`, { waitUntil: 'networkidle' });
  await page.fill('textarea[name=template]', template);
  await page.click('button[name=intent][value=check]');
  await page.waitForSelector('.notice.good', { timeout: 15000 });
  const preview = (await page.textContent('.preview')) ?? '';
  check('La Lune\'s template checks against the real validator', true);
  check(
    'and the preview draws it as the paper does',
    preview.includes('Pre-treatment checklist') &&
      preview.includes('Which allergies?') &&
      preview.includes('Morning routine'),
  );
  check('checking wrote nothing', (await formState()).version === formBefore.version);

  await page.click('button[name=intent][value=publish]');
  await page.waitForFunction(
    () => /Published as version|still version/.test(document.querySelector('.notice.good')?.textContent ?? ''),
    null,
    { timeout: 15000 },
  );
  const published = await formState();
  check('publishing makes it live on the API', published.live === true && published.version !== null);

  // The desk's side, as the RECEPTIONIST — the user's call is that every role
  // reads and writes the whole file. A second phone, because section 6 spent
  // the owner's 30-second OTP cooldown.
  const desk = process.env.DESK_PHONE ?? '+9613700003';
  const otp = await (
    await fetch(`${API}/provider/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: desk }),
    })
  ).json();
  if (!otp.devCode) {
    check('a desk session could be minted (needs OTP_EXPOSE_DEV_CODE)', false);
  } else {
    const deskSession = await (
      await fetch(`${API}/provider/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: desk, code: otp.devCode }),
      })
    ).json();
    const deskAuth = {
      authorization: `Bearer ${deskSession.token}`,
      'content-type': 'application/json',
    };
    const directory = await (
      await fetch(`${API}/provider/clients`, { headers: deskAuth })
    ).json();
    const someone = (directory.clients ?? directory).find((c) => !c.guest);
    const view = await (
      await fetch(`${API}/provider/clients/${someone.id}/form`, { headers: deskAuth })
    ).json();
    check(
      'the receptionist reads the clinic\'s form for a client',
      view.form?.versionId === published.versionId,
    );
    const saved = await fetch(`${API}/provider/clients/${someone.id}/form`, {
      method: 'PUT',
      headers: deskAuth,
      body: JSON.stringify({
        versionId: published.versionId,
        answers: {
          skinType: 'Combination, sensitive',
          preTreatment: { selected: ['allergies'], details: { allergies: 'Penicillin' } },
        },
      }),
    });
    check('and saves a file', saved.status === 200, String(saved.status));

    await page.goto(`${PANEL}/clinics/${CLINIC}/form`, { waitUntil: 'networkidle' });
    check(
      'the panel counts the filled file',
      ((await page.textContent('main')) ?? '').includes('1 filled file'),
    );
    await page.click('button:has-text("Switch the form off")');
    await page.waitForFunction(
      () => (document.querySelector('main')?.textContent ?? '').includes('Switched off since'),
      null,
      { timeout: 15000 },
    );
    const offForm = await formState();
    check('switching it off reaches the API', offForm.live === false && offForm.disabledAt !== null);
    check('and keeps the filled file', offForm.entries >= 1);
    const offView = await (
      await fetch(`${API}/provider/clients/${someone.id}/form`, { headers: deskAuth })
    ).json();
    check('the desk is back on its default notes', offView.form === null);

    await page.click('button[name=intent][value=publish]');
    await page.waitForFunction(
      () => /still version|Published as version/.test(document.querySelector('.notice.good')?.textContent ?? ''),
      null,
      { timeout: 15000 },
    );
    const backOn = await formState();
    check(
      'publishing the same template switches it back on, with no new version',
      backOn.live === true && backOn.version === published.version,
    );
    const backView = await (
      await fetch(`${API}/provider/clients/${someone.id}/form`, { headers: deskAuth })
    ).json();
    check(
      'and the file the receptionist saved is still there',
      backView.entry?.answers?.preTreatment?.details?.allergies === 'Penicillin',
    );
  }
  // Leave the desk on its default notes: there is no route that deletes a form
  // (switching off is the operator's whole act), so the version and the file
  // stay in the database until it is reseeded.
  await ops(`/internal/clinics/${CLINIC}/form`, { method: 'DELETE' });

  console.log('\n8 · the panel left nothing behind');
  await ops(`/internal/clinics/${CLINIC}`, {
    method: 'PATCH',
    body: JSON.stringify({
      clientRemindersEnabled: before.clientRemindersEnabled,
      staffDigestEnabled: before.staffDigestEnabled,
    }),
  });
  const restored = await clinic();
  check(
    'every column is back where the drive found it',
    JSON.stringify(restored) === JSON.stringify(before),
  );
  check('nothing failed to load', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(
  fails.length === 0
    ? `\nALL ${fails.length === 0 ? '' : ''}CHECKS PASSED`
    : `\n${fails.length} FAILED: ${fails.join(' | ')}`,
);
process.exit(fails.length === 0 ? 0 : 1);
