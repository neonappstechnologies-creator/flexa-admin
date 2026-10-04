import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, clientForm, type OpsClientForm } from '@/lib/api';

import { FormEditor, SwitchOffForm } from './form-editor';
import { PaperUpload } from './paper-upload';

export const dynamic = 'force-dynamic';

/// Beirut, for the clinic page's reason: every date in this product is kept on
/// that clock.
const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Beirut',
});

/// What the box holds for a clinic that has never had a form: the smallest
/// template the API accepts, so the first **Check** teaches the shape instead of
/// failing on an empty box.
const STARTER = {
  title: 'Client file',
  sections: [
    {
      key: 'notes',
      title: 'Notes',
      fields: [{ type: 'longText', key: 'notes' }],
    },
  ],
};

const files = (n: number) => (n === 1 ? '1 filled file' : `${n} filled files`);

/**
 * A clinic's client form (→ D257): a clinic either has one form or uses B-06's
 * default notes. We write the form — transcribed from the clinic's own paper —
 * and publish it here; the desk sees it the next time a record is opened, with
 * no app release.
 */
export default async function ClientFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let form: OpsClientForm;
  try {
    form = await clientForm(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CLINIC_NOT_FOUND') notFound();
    return (
      <main className="shell narrow">
        <div className="masthead">
          <Link className="back" href={`/clinics/${encodeURIComponent(id)}`}>
            &lsaquo; Back to the clinic
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

  const status = form.live
    ? `Live · version ${form.version} · published ${WHEN.format(new Date(form.publishedAt!))} · ${files(form.entries)}`
    : form.version !== null
      ? `Switched off since ${WHEN.format(new Date(form.disabledAt!))} — the desk is on its default notes. ${files(form.entries)} kept; they come back when a version is published.`
      : 'No form — this clinic’s desk uses the default free-text notes.';

  return (
    <main className="shell">
      <div className="masthead">
        <div>
          <Link className="back" href={`/clinics/${encodeURIComponent(form.clinicId)}`}>
            &lsaquo; {form.clinicName}
          </Link>
          <h1>Client form</h1>
          <p className="sub">{status}</p>
          <div className="chips">
            <span className={form.live ? 'chip ok' : 'chip mute'}>
              {form.live ? 'Form live' : 'Default notes'}
            </span>
          </div>
        </div>
      </div>

      <FormEditor
        clinicId={form.clinicId}
        initialText={JSON.stringify(form.template ?? STARTER, null, 2)}
        initialPreview={form.template}
        currentVersion={form.version}
      />

      <PaperUpload clinicId={form.clinicId} current={form.template?.print?.background ?? null} />

      {form.live ? <SwitchOffForm clinicId={form.clinicId} entries={form.entries} /> : null}
    </main>
  );
}
