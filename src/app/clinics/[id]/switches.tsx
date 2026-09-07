'use client';

import { useActionState } from 'react';

import { updateClinicAction } from '../../actions';

/**
 * One reminder switch, and one form per switch.
 *
 * Each form carries the value it is moving **to**, so a page loaded a minute
 * ago can only ever re-assert a value somebody already chose — never invert a
 * change it never saw. That is also why there is no Save button batching all
 * four fields: "switch this clinic off" must be a press whose own label says
 * so, not a side effect of adjusting a reminder and pressing Save.
 *
 * Its own `useActionState`, not one shared by the section, so pressing one
 * switch does not put every other switch on the page into a pending state and
 * report its error under all of them.
 */
export function ReminderSwitch({
  clinicId,
  field,
  on,
  title,
  why,
}: {
  clinicId: string;
  field: 'clientRemindersEnabled' | 'staffDigestEnabled';
  on: boolean;
  title: string;
  why: string;
}) {
  const [error, formAction, pending] = useActionState(updateClinicAction, null);

  return (
    <form action={formAction} className="switch">
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!on)} />
      <span className="switch-text">
        <span className="title">{title}</span>
        <span className="why">{why}</span>
        {error ? (
          <span className="notice bad" role="alert">
            {error}
          </span>
        ) : null}
      </span>
      <span className="switch-state">
        <span className={on ? 'chip ok' : 'chip mute'}>{on ? 'On' : 'Off'}</span>
        <button className="quiet" type="submit" disabled={pending}>
          {pending ? '…' : on ? 'Turn off' : 'Turn on'}
        </button>
      </span>
    </form>
  );
}

/**
 * The off-switch, kept in its own section away from the reminders.
 *
 * It states what it does **before** it is pressed rather than in a confirmation
 * after, because the consequences are the decision: a suspension is not a
 * cancellation, so nothing on anybody’s calendar moves, and switching the
 * clinic back on restores it to the day it went off.
 */
export function DisableSection({
  clinicId,
  disabled,
  reason,
  since,
  published,
}: {
  clinicId: string;
  disabled: boolean;
  reason: string | null;
  since: string | null;
  published: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateClinicAction, null);

  return (
    <section className={disabled ? 'card danger' : 'card'}>
      <h2>{disabled ? 'This clinic is switched off' : 'Switch this clinic off'}</h2>

      {disabled ? (
        <>
          <p className="sub">
            Since {since}. Clients cannot find or book it, its staff cannot sign
            in, and neither reminder clock sends on its behalf.
          </p>
          {reason ? (
            <p className="reason">
              <span className="sub">Reason on file</span>
              {reason}
            </p>
          ) : null}
          <p className="sub">
            Switching it back on restores it exactly as it was
            {published
              ? ' — it was published by its owner, so it becomes visible again immediately.'
              : ' — note its owner has not published it, so it stays invisible to clients until they do.'}
          </p>
        </>
      ) : (
        <p className="sub">
          Clients will not find or book it, its staff will not be able to sign
          in, and neither reminder clock will send on its behalf.{' '}
          <strong>Existing appointments are left standing</strong> — this is a
          suspension, not a cancellation, and nothing is cancelled or refunded.
        </p>
      )}

      <form action={formAction}>
        <input type="hidden" name="clinicId" value={clinicId} />
        <input type="hidden" name="field" value="disabled" />
        <input type="hidden" name="value" value={String(!disabled)} />

        {disabled ? null : (
          <label className="field">
            <span>Why (internal note — never shown to the clinic or a client)</span>
            <textarea
              name="disabledReason"
              maxLength={280}
              placeholder="Non-payment — suspended pending contact"
            />
          </label>
        )}

        {error ? (
          <p className="notice bad" role="alert">
            {error}
          </p>
        ) : null}

        <div className="actions">
          <button
            className={disabled ? undefined : 'destructive'}
            type="submit"
            disabled={pending}
          >
            {pending
              ? 'Working…'
              : disabled
                ? 'Switch it back on'
                : 'Switch this clinic off'}
          </button>
        </div>
      </form>
    </section>
  );
}
