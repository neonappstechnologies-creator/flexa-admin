import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ApiError,
  clientForm,
  clinicById,
  type OpsClientForm,
  type OpsClinic,
} from '@/lib/api';

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

  // The client form's state, read separately and allowed to fail on its own: an
  // API that predates the form routes (→ D257) must still let the operator
  // reach the switches on this page, which are the reason it exists.
  let form: OpsClientForm | null = null;
  let formError: string | null = null;
  try {
    form = await clientForm(clinic.id);
  } catch (error) {
    formError =
      error instanceof ApiError ? error.message : 'Could not read the client form.';
  }

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

      <section className="card">
        <h2>Client form</h2>
        <p className="sub">
          The clinic&rsquo;s own client file, transcribed from its paper form. While
          it is live it replaces the default notes on every client&rsquo;s record,
          and everyone at the desk can fill it in.
        </p>
        {formError ? (
          <p className="notice bad" role="alert">
            {formError}
          </p>
        ) : null}
        <Link className="row form-row" href={`/clinics/${encodeURIComponent(clinic.id)}/form`}>
          <span>
            <span className="name">
              {form?.live
                ? `Live \u00b7 version ${form.version}`
                : form && form.version !== null
                  ? 'Switched off \u2014 on the default notes'
                  : 'No form \u2014 on the default notes'}
            </span>
            <span className="meta">
              {form
                ? form.entries === 1
                  ? '1 filled file'
                  : `${form.entries} filled files`
                : 'Open to write or publish one'}
            </span>
          </span>
          <span className="chevron" aria-hidden="true">
            &rsaquo;
          </span>
        </Link>
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
