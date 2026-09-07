import type { OpsClinic } from '@/lib/api';

/**
 * What is true about this clinic, in the order an operator cares.
 *
 * "Not visible to clients" has **two** causes and they are not the same thing —
 * the owner has not published it (→ D30), or we have switched it off (→ D215) —
 * so they are two chips and never one "inactive". Collapsing them is how
 * somebody switches a clinic back on and then cannot work out why nobody can
 * find it.
 *
 * The reminder chips appear **only when a switch is off**, because on is the
 * default for every clinic: a row of green "on" chips beside every name would
 * say nothing while burying the one row that differs.
 */
export function StatusChips({ clinic }: { clinic: OpsClinic }) {
  return (
    <span className="chips">
      {clinic.disabledAt !== null ? (
        <span className="chip off">Switched off</span>
      ) : (
        <span className="chip ok">Running</span>
      )}
      {!clinic.published ? (
        <span className="chip warn">Not published by owner</span>
      ) : null}
      {!clinic.clientRemindersEnabled ? (
        <span className="chip mute">Client reminders off</span>
      ) : null}
      {!clinic.staffDigestEnabled ? (
        <span className="chip mute">Staff digest off</span>
      ) : null}
    </span>
  );
}
