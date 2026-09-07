'use client';

import { useActionState } from 'react';

import { signInAction } from '../actions';

export function LoginForm() {
  const [error, formAction, pending] = useActionState(signInAction, null);
  return (
    <form action={formAction}>
      <input
        type="password"
        name="password"
        // The browser may offer to remember it; this is a shared password on an
        // internal tool and an operator saving it is fine and expected.
        autoComplete="current-password"
        aria-label="Panel password"
        placeholder="Password"
        autoFocus
        required
      />
      {error ? (
        // `role="alert"` so a screen reader is told, rather than the message
        // simply appearing where nobody's focus is.
        <p className="notice bad" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
