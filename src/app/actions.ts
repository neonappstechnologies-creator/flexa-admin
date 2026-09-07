'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { ApiError, patchClinic, type ClinicOpsPatch } from '@/lib/api';
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
