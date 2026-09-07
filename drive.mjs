/* A user-shaped drive of the panel (→ D214), against a real API and a real
   database. It presses what a person presses and reads what a person reads. */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:3100';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
const badResponses = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// A console "Failed to load resource" says only that something 404'd, never
// what — so the URL is captured here or the failure is unactionable.
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});

console.log('\n1 · the gate');
await page.goto(`${BASE}/clinics/cedar`, { waitUntil: 'networkidle' });
check('a signed-out visit to a deep link lands on /login', page.url().endsWith('/login'), page.url());
check('the page source carries no ops secret', !(await page.content()).includes('test-ops'));

console.log('\n2 · a wrong password');
await page.fill('input[type=password]', 'not-the-password');
await page.click('button[type=submit]');
await page.waitForSelector('.notice.bad');
check('is refused, and says so', (await page.textContent('.notice.bad')).includes('not right'));
check('and does not say whether a password is even configured', !(await page.content()).toLowerCase().includes('not configured'));

console.log('\n3 · the right password');
await page.fill('input[type=password]', 'drive-pw');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });
await page.waitForSelector('.row');
const names = await page.$$eval('.row .name', (n) => n.map((x) => x.textContent));
check('lands on the list with every clinic', names.length === 4, names.join(', '));
check('each row says it is running', (await page.$$('.chip.ok')).length === 4);

console.log('\n4 · search');
await page.fill('input[name=q]', 'cedar');
await page.click('.search button');
await page.waitForSelector('.row');
check('narrows to one', (await page.$$('.row')).length === 1);
await page.fill('input[name=q]', 'zzz');
await page.click('.search button');
await page.waitForSelector('.empty');
check('says so when nothing matches', (await page.textContent('.empty')).includes('No clinic matches'));

console.log('\n5 · the detail page');
await page.goto(`${BASE}/clinics/cedar`, { waitUntil: 'networkidle' });
check('names the clinic', (await page.textContent('h1')) === 'Cedar & Stone Clinic');
const on = await page.$$eval('.switch .chip', (n) => n.map((x) => x.textContent));
check('both reminder switches read On', JSON.stringify(on) === '["On","On"]', on.join(','));
check('the off-switch states the consequence before it is pressed',
  (await page.textContent('.card.danger, .card:last-of-type')).includes('Existing appointments are left standing'));

console.log('\n6 · turn the staff digest off');
await page.click('.switch:last-of-type button');
await page.waitForFunction(() => document.querySelectorAll('.switch .chip')[1]?.textContent === 'Off', null, { timeout: 15000 });
check('the switch reads Off', true);
const api1 = await (await fetch('http://127.0.0.1:3001/v1/internal/clinics', { headers: { 'x-ops-secret': 'test-ops' } })).json();
const cedar1 = api1.find((c) => c.id === 'cedar');
check('the API agrees', cedar1.staffDigestEnabled === false && cedar1.clientRemindersEnabled === true,
  `sd=${cedar1.staffDigestEnabled} cr=${cedar1.clientRemindersEnabled}`);
check('and the OTHER switch was not touched', cedar1.clientRemindersEnabled === true);

console.log('\n7 · switch the clinic off, with a reason');
await page.fill('textarea[name=disabledReason]', 'Driving the panel');
await page.click('button.destructive');
await page.waitForSelector('.card.danger', { timeout: 15000 });
const api2 = (await (await fetch('http://127.0.0.1:3001/v1/internal/clinics', { headers: { 'x-ops-secret': 'test-ops' } })).json()).find((c) => c.id === 'cedar');
check('the API records it, with the reason', api2.disabledAt !== null && api2.disabledReason === 'Driving the panel',
  `${api2.disabledAt} / ${api2.disabledReason}`);
check('the owner’s published flag is untouched', api2.published === true);
check('the page now says when', (await page.textContent('.card.danger')).includes('Since'));
check('and shows the reason on file', (await page.textContent('.card.danger')).includes('Driving the panel'));

console.log('\n8 · what a client sees while it is off');
const list = await (await fetch('http://127.0.0.1:3001/v1/clinics')).json();
check('the clinic is gone from the client catalogue', !list.some((c) => c.id === 'cedar'), list.map((c) => c.id).join(','));
check('and its profile 404s', (await fetch('http://127.0.0.1:3001/v1/clinics/cedar')).status === 404);

console.log('\n9 · the list shows it as off');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
check('a chip says Switched off', (await page.$$('.chip.off')).length === 1);
check('the count in the header says so too', (await page.textContent('.sub')).includes('1 switched off'));

console.log('\n10 · switch it back on');
await page.goto(`${BASE}/clinics/cedar`, { waitUntil: 'networkidle' });
await page.click('.card.danger button[type=submit]');
await page.waitForFunction(() => !document.querySelector('.card.danger'), null, { timeout: 15000 });
const api3 = (await (await fetch('http://127.0.0.1:3001/v1/internal/clinics', { headers: { 'x-ops-secret': 'test-ops' } })).json()).find((c) => c.id === 'cedar');
check('it is running again', api3.disabledAt === null);
check('the reason went with the suspension', api3.disabledReason === null);
check('the digest switch is still off — nothing was reset', api3.staffDigestEnabled === false);

console.log('\n11 · put the digest back and sign out');
await page.click('.switch:last-of-type button');
await page.waitForFunction(() => document.querySelectorAll('.switch .chip')[1]?.textContent === 'On', null, { timeout: 15000 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.click('.masthead button');
await page.waitForURL(`${BASE}/login`, { timeout: 15000 });
check('signing out returns to the password', page.url().endsWith('/login'));
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
check('and the session is really gone', page.url().endsWith('/login'), page.url());

check(
  'nothing on any page failed to load',
  badResponses.length === 0,
  badResponses.slice(0, 3).join(' | '),
);
check('no page errors anywhere in the drive', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(fails.length === 0 ? '\nALL CHECKS PASSED' : `\n${fails.length} FAILED: ${fails.join(' | ')}`);
process.exit(fails.length === 0 ? 0 : 1);
