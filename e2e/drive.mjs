import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Drives the operator panel over HTTP, exactly as a browser with JavaScript
 * turned off does (→ D215).
 *
 * **Why not a headless browser.** The obvious rig is Playwright, and this was
 * written that way first; Chrome could not be launched on the machine this was
 * built on, and a drive that only runs somewhere else is a drive nobody runs.
 * The no-JS path is not a lesser substitute either: every control in this panel
 * is a `<form>` whose action is a server action, and React renders the
 * `$ACTION_*` fields into that form precisely so a POST with no JavaScript
 * invokes it. So this submits the very inputs the page ships, to the URL the
 * page names, and reads the HTML that comes back — which is the whole chain:
 * password → signed cookie → server action → a request carrying the ops secret
 * → the switch actually moved.
 *
 * What it does NOT cover, stated rather than implied: the client-side
 * `useActionState` niceties (the pending state, the inline error re-render
 * without a navigation), and the API's own SQL — this runs against
 * `e2e/stub-api.mjs`, which answers the real contract because the real API
 * needs Postgres.
 *
 *   npm run build && npm run e2e
 */
const PORT = 3311;
const STUB_PORT = 4311;
const SECRET = 'stub-secret-for-the-drive';
const PASSWORD = 'correct-horse-battery';
/// Identifies the stub this run started, so a leftover on the port is caught
/// as a leftover rather than read as a panel defect.
const NONCE = randomUUID();

const failures = [];
let checks = 0;

function check(name, ok, detail = '') {
  checks += 1;
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── the smallest browser that can drive a form ──────────────────────────────

const jar = new Map();

function remember(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, { value, raw });
  }
  return response;
}

const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v.value}`).join('; ');

async function get(path) {
  const response = remember(
    await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { cookie: cookieHeader() },
      redirect: 'manual',
    }),
  );
  return {
    status: response.status,
    location: response.headers.get('location'),
    html: await response.text(),
  };
}

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#x27': "'", '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => ENTITIES[e] ?? m);

/// Every `<input>` inside one `<form>…</form>`, in document order — including
/// React's `$ACTION_*` fields, which is the whole point.
function fieldsOf(formHtml) {
  return [...formHtml.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .map((tag) => ({
      name: decode(/\bname="([^"]*)"/.exec(tag)?.[1] ?? ''),
      value: decode(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? ''),
    }))
    .filter((f) => f.name);
}

function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]);
}

/// A control is found by the `field` its own hidden input names — the same
/// handle `updateClinicAction` reads — so the drive cannot press something the
/// action would ignore.
function formFor(html, field) {
  const form = formsIn(html).find((f) =>
    fieldsOf(f).some((x) => x.name === 'field' && x.value === field),
  );
  if (!form) throw new Error(`no ${field} form on this page`);
  return form;
}

/// One `<li>` of the clinic list, by the name shown in it.
function rowOf(html, clinicName) {
  const row = html
    .split('<li>')
    .slice(1)
    .find((r) => r.includes(clinicName));
  if (!row) throw new Error(`no row for ${clinicName}`);
  return row;
}

/// Submits a form the way a no-JS browser submits it: `multipart/form-data`,
/// every field the page rendered, to the page it was rendered on.
async function submit(path, formHtml, overrides = {}) {
  const boundary = `----drive${randomUUID()}`;
  const fields = fieldsOf(formHtml).map((f) =>
    f.name in overrides ? { name: f.name, value: String(overrides[f.name]) } : f,
  );
  for (const [name, value] of Object.entries(overrides)) {
    if (!fields.some((f) => f.name === name)) fields.push({ name, value: String(value) });
  }
  const body =
    fields
      .map(
        (f) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`,
      )
      .join('') + `--${boundary}--\r\n`;

  const response = remember(
    await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: {
        cookie: cookieHeader(),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      redirect: 'manual',
    }),
  );
  return {
    status: response.status,
    location: response.headers.get('location') ?? response.headers.get('x-action-redirect'),
    html: await response.text(),
  };
}

async function waitFor(url, what) {
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${what} never came up at ${url}`);
}

// ── the run ────────────────────────────────────────────────────────────────

const stub = spawn(process.execPath, ['e2e/stub-api.mjs'], {
  env: {
    ...process.env,
    STUB_PORT: String(STUB_PORT),
    STUB_OPS_SECRET: SECRET,
    STUB_NONCE: NONCE,
  },
  stdio: 'ignore',
});
const app = spawn('npx', ['next', 'start', '--port', String(PORT)], {
  env: {
    ...process.env,
    FLEXA_API_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
    OPS_SECRET: SECRET,
    ADMIN_PASSWORD: PASSWORD,
    ADMIN_SESSION_SECRET: 'a'.repeat(64),
  },
  stdio: 'ignore',
});

async function stubState() {
  const body = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__state`)).json();
  // A server we did not start is not our stub, whatever it answers. Without
  // this the drive silently talks to a leftover from a previous run and reports
  // its wrong secret as a panel defect.
  if (body.nonce !== NONCE) {
    throw new Error(
      `something else is listening on :${STUB_PORT} — kill it and re-run`,
    );
  }
  return body.clinics;
}

const state = async () =>
  Object.fromEntries((await stubState()).map((c) => [c.id, c]));

/// What the stub holds for client forms — the API's side, not the page's.
async function stubForms() {
  const body = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__state`)).json();
  if (body.nonce !== NONCE) throw new Error(`something else is listening on :${STUB_PORT}`);
  return body.forms;
}

/// The decoded text of the one `<textarea>` in a page — the template box.
function textareaOf(html) {
  const m = /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  return m ? decode(m[1]) : null;
}

try {
  await waitFor(`http://127.0.0.1:${STUB_PORT}/__state`, 'the stub API');
  await stubState();
  await waitFor(`http://127.0.0.1:${PORT}/login`, 'the panel');

  process.stdout.write('\nthe front door\n');

  let page = await get('/');
  check('a signed-out browser is sent to the password screen', page.status === 307 &&
    (page.location ?? '').endsWith('/login'), `${page.status} ${page.location}`);
  // Asserted on the CONTENT, not only the redirect: a redirect that still
  // streamed the list would pass a URL check and leak every clinic's status.
  check('and is shown no clinic at all', !page.html.includes('Cedar & Stone'));

  let login = await get('/login');
  const loginForm = formsIn(login.html)[0];
  let refused = await submit('/login', loginForm, { password: 'not the password' });
  check('a wrong password is refused', refused.html.includes('not right'),
    refused.status + '');
  check('and mints no session', !jar.has('flexa_admin'));

  const accepted = await submit('/login', loginForm, { password: PASSWORD });
  check('the right password opens the panel', jar.has('flexa_admin'), accepted.status + '');

  process.stdout.write('\nthe list\n');
  page = await get('/');
  check('the panel is now readable', page.status === 200, page.status + '');
  check("every clinic is listed",
    page.html.includes('Cedar &amp; Stone Clinic') &&
      page.html.includes('La Lune') &&
      page.html.includes('Nour Beauty Lounge'));
  check('a running clinic reads Running',
    rowOf(page.html, 'Cedar &amp; Stone').includes('>Running<'));
  check('a switched-off one reads Switched off',
    rowOf(page.html, 'La Lune').includes('>Switched off<'));
  // The two reasons a clinic is invisible are different facts, and the panel
  // must not blur them: this one is the owner's own answer, not ours.
  check('an unpublished clinic is told apart from a suspended one',
    rowOf(page.html, 'Nour Beauty').includes('Not published by owner') &&
      rowOf(page.html, 'Nour Beauty').includes('>Running<'));
  // On is every clinic's default, so a chip only ever marks the row that differs.
  check('a switched-off reminder is chipped, and an on one is not',
    rowOf(page.html, 'La Lune').includes('Staff digest off') &&
      !rowOf(page.html, 'Cedar &amp; Stone').includes('digest off'));
  check('the master-switch caveat is on the page, not just in the code',
    page.html.includes('PUSH_REMINDERS') && page.html.includes('STAFF_DIGEST'));

  process.stdout.write('\nthe search\n');
  const found = await get('/?q=jounieh');
  check('searches the area as well as the name',
    found.html.includes('La Lune') && !found.html.includes('Cedar &amp; Stone Clinic'));
  const missed = await get('/?q=zzz');
  check('says so when nothing matches', /No clinic|no clinic/.test(missed.html));

  process.stdout.write('\nthe reminder switches\n');
  let detail = await get('/clinics/cedar');
  check('a clinic opens its own page', detail.status === 200 &&
    detail.html.includes('Cedar &amp; Stone Clinic'), detail.status + '');
  check('the digest starts On', formFor(detail.html, 'staffDigestEnabled').includes('>On<'));

  await submit('/clinics/cedar', formFor(detail.html, 'staffDigestEnabled'));
  let after = await state();
  check('turning the staff digest off moves the API’s own column',
    after.cedar.staffDigestEnabled === false);
  check('and touches nothing else', after.cedar.clientRemindersEnabled === true &&
    after.cedar.disabledAt === null && after.cedar.published === true);
  detail = await get('/clinics/cedar');
  check('the page now reads Off', formFor(detail.html, 'staffDigestEnabled').includes('>Off<'));

  await submit('/clinics/cedar', formFor(detail.html, 'clientRemindersEnabled'));
  after = await state();
  check('client reminders switch independently', after.cedar.clientRemindersEnabled === false);
  check('and the first switch stayed where it was put', after.cedar.staffDigestEnabled === false);

  // A switch that only travels one way is half a switch.
  detail = await get('/clinics/cedar');
  await submit('/clinics/cedar', formFor(detail.html, 'staffDigestEnabled'));
  check('and back on again', (await state()).cedar.staffDigestEnabled === true);

  process.stdout.write('\nswitching a clinic off\n');
  detail = await get('/clinics/nour');
  check('the consequences are stated BEFORE the press, not in a dialog after',
    detail.html.includes('Existing appointments are left standing'));
  await submit('/clinics/nour', formFor(detail.html, 'disabled'), {
    disabledReason: 'Fraud review',
  });
  const nour = (await state()).nour;
  check('the switch-off is recorded', nour.disabledAt !== null);
  check('with the operator’s reason', nour.disabledReason === 'Fraud review');
  // The one thing a suspension must never do: overwrite the owner's own answer
  // to "am I ready to be found", which would come back wrong when it lifts.
  check('and did not touch the owner’s published flag', nour.published === false);
  detail = await get('/clinics/nour');
  check('the page now says it is off, and why',
    detail.html.includes('This clinic is switched off') &&
      detail.html.includes('Fraud review'));
  // An unpublished clinic switched back on is still invisible, and the page has
  // to say so or an operator turns it on and cannot work out why nothing changed.
  check('and warns that switching it back on will not make it visible',
    detail.html.includes('has not published it'));

  const stampBefore = (await state())['la-lune'].disabledAt;
  detail = await get('/clinics/la-lune');
  await submit('/clinics/la-lune', formFor(detail.html, 'disabled'));
  check('switching back on clears the stamp', (await state())['la-lune'].disabledAt === null);
  check('and clears the note with it', (await state())['la-lune'].disabledReason === null);
  check('the suspension it cleared was the original one, unmoved',
    stampBefore === '2026-09-01T05:00:00.000Z', String(stampBefore));

  process.stdout.write('\nthe client form\n');
  detail = await get('/clinics/cedar');
  check('a clinic page links its client form, and says it has none',
    detail.html.includes('/clinics/cedar/form') && detail.html.includes('No form'));
  let formPage = await get('/clinics/cedar/form');
  check('the form page opens', formPage.status === 200, formPage.status + '');
  check('and says the desk is on the default notes',
    formPage.html.includes('default free-text notes'));
  const editor = () => formsIn(formPage.html).find((f) => f.includes('name="template"'));
  const TEMPLATE = {
    title: 'Skin care',
    subtitle: 'Client consultation form',
    sections: [
      {
        key: 'client',
        title: 'Client information',
        fields: [
          { type: 'record', key: 'fullName', label: 'Full name', source: 'name' },
          { type: 'text', key: 'referredBy', label: 'Referred by' },
        ],
      },
      {
        key: 'skin',
        title: 'Skin condition',
        fields: [
          {
            type: 'checkboxes',
            key: 'skinCondition',
            columns: 2,
            options: [
              { key: 'acne', label: 'Acne' },
              { key: 'redness', label: 'Redness' },
            ],
          },
        ],
      },
    ],
  };
  const typo = structuredClone(TEMPLATE);
  typo.sections[0].fields[1] = { type: 'text', key: 'referredBy', lable: 'Referred by' };
  let result = await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(typo),
    intent: 'check',
  });
  check('a typo in a property is refused, and the page says exactly where',
    result.html.includes('sections[0].fields[1].lable'));
  check('the refused template is still in the box, as typed',
    (textareaOf(result.html) ?? '').includes('"lable"'));
  result = await submit('/clinics/cedar/form', editor(), { template: 'not json', intent: 'check' });
  check('text that is not JSON is refused before anything is sent',
    result.html.includes('not valid JSON'));
  result = await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(TEMPLATE),
    intent: 'check',
  });
  check('a valid template checks', result.html.includes('The template is valid'));
  check('and the preview draws its sections and its boxes',
    result.html.includes('Skin condition') && result.html.includes('Redness'));
  check('checking writes nothing on the API', (await stubForms()).cedar === undefined);

  result = await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(TEMPLATE),
    intent: 'publish',
  });
  let stored = (await stubForms()).cedar;
  check('publishing makes version 1 live on the API',
    stored?.versions.length === 1 && stored.disabledAt === null);
  check('and the page says so', result.html.includes('Published as version 1'));

  formPage = await get('/clinics/cedar/form');
  result = await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(TEMPLATE),
    intent: 'publish',
  });
  check('an identical publish adds no version', (await stubForms()).cedar.versions.length === 1);
  check('and says nothing changed', result.html.includes('still version 1'));

  const retyped = structuredClone(TEMPLATE);
  retyped.sections[0].fields[1].type = 'longText';
  result = await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(retyped),
    intent: 'publish',
  });
  check('a key cannot change its type between versions', result.html.includes('keeps its type'));
  check('and the refused publish moved nothing', (await stubForms()).cedar.versions.length === 1);

  const edited = structuredClone(TEMPLATE);
  edited.sections[1].fields[0].options.push({ key: 'rosacea', label: 'Rosacea' });
  await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(edited),
    intent: 'publish',
  });
  check('an edited template becomes version 2', (await stubForms()).cedar.versions.length === 2);
  formPage = await get('/clinics/cedar/form');
  check('the page reads live at version 2', formPage.html.includes('Live · version 2'));

  const switchOff = formsIn(formPage.html).find((f) => f.includes('Switch the form off'));
  check('switching off says the filled files are kept, before the press',
    formPage.html.includes('kept') && switchOff !== undefined);
  await submit('/clinics/cedar/form', switchOff);
  stored = (await stubForms()).cedar;
  check('switching the form off stamps it on the API', stored.disabledAt !== null);
  formPage = await get('/clinics/cedar/form');
  check('and the page says the desk is back on its notes',
    formPage.html.includes('Switched off since'));
  await submit('/clinics/cedar/form', editor(), {
    template: JSON.stringify(edited),
    intent: 'publish',
  });
  stored = (await stubForms()).cedar;
  check('publishing it again switches it back on, with no new version',
    stored.disabledAt === null && stored.versions.length === 2);

  detail = await get('/clinics/la-lune');
  check('a clinic with a live form says so on its own page',
    detail.html.includes('Live · version 1') && detail.html.includes('2 filled files'));
  check('the ops secret is not on the form page either', !formPage.html.includes(SECRET));

  process.stdout.write('\nthe credential\n');
  page = await get('/');
  // The whole security posture in one assertion: nothing the browser was given
  // contains the ops secret. If a fetch ever escapes to the client, this fails.
  check('the ops secret is nowhere in what the browser receives', !page.html.includes(SECRET));
  check('nor is the panel password', !page.html.includes(PASSWORD));
  let leaked = null;
  for (const chunk of [...page.html.matchAll(/src="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1])) {
    const js = await (await fetch(`http://127.0.0.1:${PORT}${chunk}`)).text();
    if (js.includes(SECRET) || js.includes(PASSWORD)) leaked = chunk;
  }
  check('and in none of the scripts the page loads', leaked === null, String(leaked));

  const session = jar.get('flexa_admin');
  check('the session cookie is httpOnly', /httponly/i.test(session.raw));
  check('and sameSite strict', /samesite=strict/i.test(session.raw));
  check('and carries only a deadline and a signature',
    /^\d+\.[0-9a-f]{64}$/.test(session.value), session.value.slice(0, 20));

  process.stdout.write('\nthe back door\n');
  // A server action is a POST endpoint, not a private function the page calls:
  // anything that can find its id can invoke it. So the question worth asking
  // is what happens to a real form replayed with the cookie taken away.
  //
  // **What this proves, precisely.** `proxy.ts`'s matcher is path-based and
  // therefore covers POST as well as GET, so the replay is turned away at the
  // edge and the action never runs. That is the boundary, and it is what these
  // two lines pin. `requireSession()` inside the action is a SECOND line, and
  // this drive cannot observe it: deleting it leaves every check here green
  // (measured — the mutation passed 41/41), because the request never reaches
  // it. It stays anyway, for the day the matcher changes or a route moves; but
  // it is untested from out here, and saying so is better than an assertion
  // that reads like it covers it.
  detail = await get('/clinics/cedar');
  const stolen = formFor(detail.html, 'staffDigestEnabled');
  const before = (await state()).cedar.staffDigestEnabled;
  const held = jar.get('flexa_admin');
  jar.delete('flexa_admin');
  const replayed = await submit('/clinics/cedar', stolen);
  check('a signed-out replay of a real form is turned away at the edge',
    replayed.status === 307 && (replayed.location ?? '').endsWith('/login'),
    `${replayed.status} ${replayed.location}`);
  check('and the switch it aimed at did not move',
    (await state()).cedar.staffDigestEnabled === before);
  jar.set('flexa_admin', held);

  process.stdout.write('\nforging one\n');
  const [payload] = session.value.split('.');
  jar.set('flexa_admin', { value: `${payload}.${'f'.repeat(64)}`, raw: '' });
  check('a cookie we did not sign is not a session', (await get('/')).status === 307);
  // The deadline lives INSIDE the signed payload, so extending it breaks the
  // signature: a browser cannot grant itself more time by keeping the cookie.
  jar.set('flexa_admin', {
    value: `${Number(payload) + 86400000}.${session.value.split('.')[1]}`,
    raw: '',
  });
  check('nor is one whose deadline was moved', (await get('/')).status === 307);
  jar.set('flexa_admin', session);

  process.stdout.write('\nsigning out\n');
  page = await get('/');
  await submit('/', formsIn(page.html).find((f) => f.includes('Sign out')));
  check('signing out closes the panel again', (await get('/')).status === 307);
} finally {
  stub.kill();
  app.kill();
}

process.stdout.write(`\n${checks - failures.length}/${checks} checks passed\n`);
if (failures.length) {
  process.stdout.write(`\nFAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
