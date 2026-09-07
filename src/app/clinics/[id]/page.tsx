import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, clinicById, type OpsClinic } from '@/lib/api';

import { StatusChips } from '../../status-chips';
import { DisableSection, ReminderSwitch } from './switches';

export const dynamic = 'force-dynamic';

/// Beirut, because that is the clock every date in this product is kept in
/// (`clinicWallClock`, `apps/api/src/bookings/policy/policy.ts`). A suspension
/// stamped at 23:40 local must not read here as the next day.
const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Beirut',
});

export default async function ClinicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let clinic: OpsClinic | null;
  try {
    clinic = await clinicById(id);
  } catch (error) {
    return (
      <main className="shell narrow">
        <div className="masthead">
          <Link className="back" href="/">
            &lsaquo; All clinics
          </Link>
        </div>
        <p className="notice bad" role="alert">
          {error instanceof ApiError
            ? error.message
            : 'Something went wrong reaching the Flexa API.'}
        </p>
      </main>
    );
  }
  if (!clinic) notFound();

  return (
    <main className="shell narrow">
      <div className="masthead">
        <div>
          <Link className="back" href="/">
            &lsaquo; All clinics
          </Link>
          <h1>{clinic.name}</h1>
          <p className="sub">
            {clinic.area}
            {clinic.bookingSlug
              ? ` \u00b7 ${clinic.bookingSlug}.flexa.beauty`
              : ' \u00b7 no booking subdomain'}
          </p>
          <StatusChips clinic={clinic} />
        </div>
      </div>

      <section className="card">
        <h2>Reminders</h2>
        <p className="sub">
          Two different messages on two different clocks. Turning either off here
          stops it for this clinic alone.
        </p>

        <ReminderSwitch
          clinicId={clinic.id}
          field="clientRemindersEnabled"
          on={clinic.clientRemindersEnabled}
          title="Client appointment reminders"
          why="The push a client gets 24 hours and 2 hours before their appointment here. Unpublishing a clinic does not stop these \u2014 somebody who already holds an appointment is still reminded \u2014 but switching it off does."
        />
        <ReminderSwitch
          clinicId={clinic.id}
          field="staffDigestEnabled"
          on={clinic.staffDigestEnabled}
          title="Staff daily digest"
          why="The WhatsApp message each evening: tomorrow\u2019s own appointments to each practitioner, and the whole clinic\u2019s day to the owner. A receptionist gets nothing either way."
        />
      </section>

      <DisableSection
        clinicId={clinic.id}
        disabled={clinic.disabledAt !== null}
        reason={clinic.disabledReason}
        since={clinic.disabledAt ? WHEN.format(new Date(clinic.disabledAt)) : null}
        published={clinic.published}
      />
    </main>
  );
}
