import { cookies } from 'next/headers';

/// The panel's own front door (→ D215).
///
/// **One shared password, and a signed cookie** — deliberately, not as a
/// placeholder for real accounts. The audience is us; there is nothing here to
/// scope per person, and an `AdminUser` table would be a login system to
/// maintain, migrate and reset for a panel with three switches on it. The API
/// side already works this way: `OPS_SECRET` is one deploy-time string on one
/// internal route, and this is its front end.
///
/// What it is NOT is a way for that secret to reach a browser. The password
/// here and `OPS_SECRET` there are two different strings on purpose: this one
/// unlocks the panel, that one is spent by the panel's **server** when it calls
/// the API. A person who guesses the password gets the panel; they never get a
/// credential they could point at the API themselves.
///
/// Exported because `proxy.ts` cannot use the accessors below: they read
/// through `next/headers`, and middleware is handed the request itself.
export const SESSION_COOKIE = 'flexa_admin';

/// Twelve hours. Long enough that an operator is not retyping a password all
/// day, short enough that a laptop left open in a café stops being a panel by
/// the evening. There is no refresh: the session simply ends.
const SESSION_MS = 12 * 60 * 60 * 1000;

/// Web Crypto rather than `node:crypto`, so one implementation works in a
/// server component, in a server action and in middleware — the last of which
/// runs on the Edge runtime, where `node:crypto` does not exist. Getting this
/// wrong fails at the edge only, which is to say in production only.
async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/// Constant time, and length-safe. `a === b` on a secret leaks how much of a
/// guess was right through how long the comparison took; it is a small leak and
/// it costs nothing to close.
function sameSecret(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Lengths differing is itself the answer, but keep the loop running over a
  // fixed span so the timing does not describe the length either.
  let diff = ab.length ^ bb.length;
  const span = Math.max(ab.length, bb.length);
  for (let i = 0; i < span; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/// Everything this module needs from the environment, read at REQUEST time
/// rather than at module load: a value baked in at build time would mean
/// changing the password on Vercel needs a redeploy to take effect.
function config(): { password: string; secret: string } | null {
  const password = process.env.ADMIN_PASSWORD ?? '';
  const secret = process.env.ADMIN_SESSION_SECRET ?? '';
  // **Closed unless configured** — `OpsGuard`'s own rule, restated on this
  // side. With no password set there is nothing to match, so the panel refuses
  // everyone rather than opening to anyone.
  return password && secret ? { password, secret } : null;
}

export function isConfigured(): boolean {
  return config() !== null;
}

/// True when the password is right. `false` for every reason — wrong password,
/// nothing configured — because the sign-in screen may not explain itself.
export async function signIn(password: string): Promise<boolean> {
  const conf = config();
  if (!conf) return false;
  if (!sameSecret(password, conf.password)) return false;

  const expiresAt = Date.now() + SESSION_MS;
  const payload = String(expiresAt);
  const value = `${payload}.${await sign(payload, conf.secret)}`;
  (await cookies()).set(SESSION_COOKIE, value, {
    // Unreadable to any script on the page: the cookie IS the session, so a
    // single XSS anywhere in this panel would otherwise hand it over.
    httpOnly: true,
    // Vercel serves this over HTTPS; a local `next dev` is HTTP, which is why
    // this tracks NODE_ENV rather than being hardcoded true.
    secure: process.env.NODE_ENV === 'production',
    // `strict`, not `lax`: nothing outside this panel ever links into it, so
    // there is no navigation this breaks and one less way to be dragged into
    // acting on somebody else's behalf.
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SESSION_MS / 1000),
  });
  return true;
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/// Whether this request carries a session we issued and that has not expired.
///
/// The expiry is INSIDE the signed payload rather than left to the cookie's own
/// `maxAge`: a browser is what enforces `maxAge`, and a browser is the one
/// party here that is not trusted. Signed, the deadline travels with the value
/// and cannot be extended by keeping the cookie around.
export async function isSignedIn(): Promise<boolean> {
  return verifySessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

/// The same question asked of a raw cookie value, for `proxy.ts`.
///
/// It is one function rather than two implementations on purpose: middleware
/// runs on the Edge and the accessors above do not, so the check would
/// otherwise be written twice — and the copy that diverges is the one guarding
/// the pages, silently, in production only.
export async function verifySessionCookie(
  raw: string | undefined,
): Promise<boolean> {
  const conf = config();
  if (!conf || !raw) return false;

  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return false;
  if (!sameSecret(mac, await sign(payload, conf.secret))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
