import Link from 'next/link';

import { ApiError, listClinics, type OpsClinic } from '@/lib/api';

import { signOutAction } from './actions';
import { StatusChips } from './status-chips';

/// Never prerendered and never cached: this page's whole job is to say what is
/// true right now.
export const dynamic = 'force-dynamic';

/// The search runs here, over the list the API already sent, rather than as a
/// query the API answers. The deployment has single-digit clinics; a `q` on the
/// wire would be a round trip and an endpoint parameter to test, for a filter a
/// string comparison does in a microsecond. When a page of clinics stops
/// fitting in one response this moves — and `ClinicOpsRepository.all` says the
/// same thing from the other side.
function matching(clinics: OpsClinic[], q: string): OpsClinic[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return clinics;
  return clinics.filter((clinic) =>
    [clinic.name, clinic.area, clinic.bookingSlug ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

export default async function ClinicsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q ?? '';

  let clinics: OpsClinic[];
  try {
    clinics = await listClinics();
  } catch (error) {
    // A configuration or connectivity problem is this panel's most likely
    // failure by far, and the one an operator can actually fix — so it gets a
    // sentence naming what to set, not an error page.
    return (
      <main className="shell">
        <div className="masthead">
          <h1>Clinics</h1>
        </div>
        <p className="notice bad" role="alert">
          {error instanceof ApiError
            ? error.message
            : 'Something went wrong reaching the Flexa API.'}
        </p>
      </main>
    );
  }

  const shown = matching(clinics, q);
  const off = clinics.filter((clinic) => clinic.disabledAt !== null).length;

  return (
    <main className="shell">
      <div className="masthead">
        <div>
          <h1>Clinics</h1>
          <p className="sub">
            {clinics.length} clinic{clinics.length === 1 ? '' : 's'}
            {off > 0 ? ` · ${off} switched off` : ''}
          </p>
        </div>
        <form action={signOutAction}>
          <button className="quiet" type="submit">
            Sign out
          </button>
        </form>
      </div>

      {/* A GET form, so a search survives a reload, is linkable, and works with
          no JavaScript at all — which an internal tool should. */}
      <form className="search" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, area or subdomain"
          aria-label="Search clinics"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="quiet" type="submit">
          Search
        </button>
      </form>

      {shown.length === 0 ? (
        <p className="empty">
          {clinics.length === 0
            ? 'The API returned no clinics at all.'
            : `No clinic matches “${q.trim()}”.`}
        </p>
      ) : (
        <ul className="rows">
          {shown.map((clinic) => (
            <li key={clinic.id}>
              <Link className="row" href={`/clinics/${clinic.id}`}>
                <span>
                  <span className="name">{clinic.name}</span>
                  <span className="meta">
                    {clinic.area}
                    {clinic.bookingSlug ? ` · ${clinic.bookingSlug}` : ''}
                  </span>
                  <StatusChips clinic={clinic} />
                </span>
                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="sub footnote">
        Both reminder switches only ever turn something <em>off</em>: the
        deployment&rsquo;s own <code>PUSH_REMINDERS</code> and{' '}
        <code>STAFF_DIGEST</code> stay the master switch above them, so a clinic
        set to On here still sends nothing if the API has that clock disarmed.
      </p>
    </main>
  );
}
