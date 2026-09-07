import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionCookie } from '@/lib/session';

/// Keeps a signed-out browser off the panel's pages.
///
/// `proxy.ts` is Next 16's name for what was `middleware.ts`; the old convention
/// still runs but warns on every build.
///
/// **This is a redirect, not the security boundary.** It runs on
/// navigations; a server action is a POST carrying its own id, and guarding the
/// page that draws the buttons would guard nothing. Every action re-checks the
/// session itself (`requireSession` in `actions.ts`), and this exists so a
/// signed-out person sees a password field rather than an empty list — a UX
/// job, stated as one.
///
/// It reads `request.cookies` rather than `next/headers`: this runs on the Edge
/// runtime, where the `cookies()` accessor those server components use is not
/// available. Both paths end in the same `verifySessionCookie`.
export async function proxy(request: NextRequest) {
  if (await verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the sign-in page itself and Next's own assets. A matcher
  // that caught `/login` would redirect the sign-in page to itself forever.
  // `icon.svg` is excluded alongside the assets: it is the tab icon, and a
  // signed-out browser asking for it should get the icon rather than a redirect
  // to the sign-in page it is already looking at.
  matcher: ['/((?!login|icon.svg|_next/static|_next/image|favicon.ico).*)'],
};
