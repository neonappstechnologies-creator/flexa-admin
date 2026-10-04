# Flexa operator panel

Switch a clinic off, turn its reminders on or off, and publish its client form.
Internal; not a clinic's own account and not part of the product.

It is a small Next.js app in front of routes the Flexa API already has:

```
GET    /v1/internal/clinics                 every clinic's operational state
PATCH  /v1/internal/clinics/:id             one switch
GET    /v1/internal/clinics/:id/form        the clinic's client form (→ D257)
POST   /v1/internal/clinics/:id/form/check  validate a template, write nothing
PUT    /v1/internal/clinics/:id/form        publish a template as a new version
DELETE /v1/internal/clinics/:id/form        back to the default notes (files kept)
POST   /v1/internal/clinics/:id/form/paper  store the clinic's paper PDF (→ D258)
POST   /v1/internal/clinics/:id/form/sample a sample PDF of a draft (or the live) template
```

All of them sit behind `OpsGuard` (`x-ops-secret`) and are excluded from Swagger —
see `apps/api/src/ops/` (the switches) and `apps/api/src/clients/forms/` (the
client form) in the `flexa-beauty` repo, which are the source of truth for the
shapes `src/lib/api.ts` restates.

## The three switches, and what they actually do

**Switch this clinic off** (`Clinic.disabledAt`). A suspension, not a
cancellation:

* clients cannot see or book it — every public gate asks one shared
  `LIVE_CLINIC` rule, so the catalogue, the offers, the gallery, the products,
  the storefront subdomain and the booking write path all refuse together;
* its people cannot sign in or act — `ProviderJwtGuard` refuses every provider
  request with `403 CLINIC_DISABLED`, and so do all three sign-in doors, so an
  already-open desk stops within the request rather than at the end of its
  24-hour token;
* neither clock sends on its behalf;
* **existing appointments are left standing.** Nothing is cancelled or
  refunded, and switching it back on restores the clinic to the day it went off.

It is deliberately **not** the same thing as the owner's own `published` flag.
That column is their answer to *am I ready to be found*; overwriting it to
suspend a clinic would destroy it and hand it back wrong on the way out.

**Client appointment reminders** (`Clinic.clientRemindersEnabled`) — the push a
client gets 24 h and 2 h before an appointment.

**Staff daily digest** (`Clinic.staffDigestEnabled`) — the evening WhatsApp:
tomorrow's own appointments to each practitioner, the whole day to the owner.

Both reminder switches only ever turn something **off**. The deployment's own
`PUSH_REMINDERS` and `STAFF_DIGEST` remain the master switch above them, so a
clinic set to On here still sends nothing if the API has that clock disarmed.

## The client form (→ D257)

Some clinics keep a paper client file — La Lune's skin consultation form was the
first. We transcribe it into a **template** and publish it from
**Clinic → Client form**; while it is live it **replaces the default notes** on
every client's record at that clinic, and **everyone at the desk** can fill it in.
A clinic with no form is exactly as before.

* **Check** validates the template exactly as publishing would and shows a preview
  of what the desk will draw. Nothing is written.
* **Publish** adds a new version. Forms already filled keep what was ticked. An
  identical template adds no version — publishing it only switches the form back
  on.
* **A field's `key` is permanent.** Rename its label freely, but never reuse a key
  for a different question; the API refuses a key that changes its type
  (`RETYPED`), because stored answers would be read as the wrong question.
* **Switch the form off** puts the desk back on its default notes. Every filled
  file is kept and comes back when a version is published again.

Anything Flexa already knows is not retyped: a client's name and phone are
`record` fields, and a paper session log is a `visits` field filled in from the
visits marked done. Keep each clinic's source template in the `flexa-beauty` repo
under `apps/api/client-forms/` — its test suite validates every file there with
the API's own rules, which is how a template is known to be good before it is
pasted here.

## The paper (→ D258)

A clinic whose form came on paper can have each client's file downloaded **as
that paper**: *Download PDF* on a client's file gives back the clinic's own PDF
with the answers written in place, the boxes ticked and the session table filled
from the visits marked done. A form without a paper layout offers no download
and is exactly as before.

1. **Upload the paper** under *Client form → Paper*. The API keeps it private
   and answers its key (`prv-….pdf`) and each page's size in points. Storing a
   paper changes nothing the desk sees.
2. **Add a `print` block to the template**: `background` names that key, and
   `fields` says where each answer goes — a `box` for a line, a tick square per
   option, a box per cell of a table, rows and columns for the session log.
   Positions are PDF points from each page's **top-left** corner (A4 is
   595.28 × 841.89) and pages count from 0. La Lune's
   `apps/api/client-forms/la-lune.json` is the worked example;
   `apps/api/src/clients/forms/client-form-print.ts` is the rulebook.
3. **Check**, then **Download a sample PDF** — every box ticked, every place
   written, more sessions than the table holds — and hold it against the paper.
   The sample draws whatever is in the box; nothing is stored until **Publish**.

The layout is checked against the paper itself: a place on a page the paper
does not have, or off a page's edge, is refused with its path, at Check and at
Publish.

**Keep the paper small.** Vercel refuses a function request over 4.5 MB, and
the paper travels inside every sample and every client file the desk
downloads, so this panel takes papers up to 4 MB. A form exported at print
quality is usually far heavier than it needs to be — La Lune's arrived as
5.1 MB and is stored at 432 KB, indistinguishable on screen.
`apps/api/client-forms/README.md` has the recipe. Whatever tool is used, the
pages must keep their size and the artwork its place, or every measured
position moves; the sample is how to tell.

## The two secrets

They are different strings and that is the point.

* `ADMIN_PASSWORD` is what a person types here. It mints a signed, `httpOnly`
  session cookie (12 h, expiry inside the signature so a browser cannot extend
  it).
* `OPS_SECRET` is the API's operator credential. **It never reaches a browser.**
  Every call carrying it is made by this app's server, from a server component
  or a server action. There is no `NEXT_PUBLIC_` variable in this app and there
  must never be one — a browser that could call those routes is a browser that
  holds a credential which switches clinics off, and page JavaScript is public.

`src/lib/api.ts` throws on import if it ever reaches the browser bundle, which
turns that mistake from a silent leak into a crash on the first render.

## Where it runs

**https://flexa-admin-ten.vercel.app** — the Vercel project `flexa-admin` in *HHH's projects*, deployed
2026-10-04. It is **not connected to GitHub** (Vercel cannot read this private repo), so a push deploys
nothing: from this folder run

```bash
vercel deploy --prod --scope hhhs-projects-1747c7be
```

`.vercelignore` keeps every local `.env` out of the upload. The four variables live in the Vercel
project's production environment; its `ADMIN_SESSION_SECRET` is its own, so a cookie minted by a local
run is never a session on the deployed panel. The password is the same `ADMIN_PASSWORD` as locally.

## Running it

```bash
cp .env.example .env.local     # fill in all four
npm install
npm run dev                    # http://localhost:3000
```

Against a local API, set `FLEXA_API_BASE_URL=http://localhost:3001/v1` and give
`apps/api/.env` an `OPS_SECRET` matching this one — unset there, the API answers
`403 OPS_DISABLED` to everything and the panel says so.

## Driving it

```bash
npm run build && npm run e2e     # 87 checks
```

`e2e/drive.mjs` starts `e2e/stub-api.mjs` — a stand-in that answers the **real**
contract, refusals included — and drives the panel over HTTP the way a browser
with JavaScript turned off does. That is not a lesser substitute: every control
here is a `<form>` whose action is a server action, and React renders the
`$ACTION_*` fields into it precisely so a plain POST invokes the action. So the
drive submits the inputs the page actually ships, to the URL the page names,
and reads the HTML that comes back — which is the whole chain: password →
signed cookie → server action → a request carrying the ops secret → the switch
moved, read back from the other side.

It runs against the stub so it runs anywhere. What that costs, stated rather
than implied: it proves the panel's whole path and the shape of what it sends,
and proves nothing about the API's SQL.

That half has its own drive:

```bash
# with apps/api on :3001 (OPS_SECRET set, against pnpm db:up) and this on :3100
npm run e2e:live                 # 24 checks, in a real browser
```

`e2e/drive-live.mjs` drives real Chrome — `playwright-core` against the browser
already installed, so no download — through the panel against the **real API and
a real Postgres**, and reads the result from the other side: the clinic gone
from `GET /clinics`, its profile and its slot grid `404`, and a provider session
**minted before the switch** refused `403 CLINIC_DISABLED` on its next request,
on `me` and on `refresh` — which is the claim that an open desk stops inside the
request rather than at the end of its 24-hour token. It restores every column it
touched, so it can be run against a database you care about.

Two things it deliberately does not cover, and both are written down where they
matter: the client-side pending/error niceties (`useActionState` re-rendering
without a navigation), and `requireSession()` inside the server action, which
`proxy.ts`'s matcher shadows — deleting that check leaves the drive green,
which was measured, and is why the assertion beside it says *turned away at the
edge* rather than claiming to cover the action. The sample route's own
`isSignedIn()` check (→ D258) is the same second line, shadowed the same way.
The paper's 4 MB browser-side check (`setCustomValidity`) needs JavaScript, so
the drive cannot see it either.

## Signing everyone out

Change `ADMIN_SESSION_SECRET`. Every open session is signed with it, so a new
value invalidates all of them at once. Sessions last 12 hours and do not renew.

## Deploying to Vercel

1. Push this directory as its own repository.
2. Import it on Vercel. It is a stock Next.js app — no build settings to change.
3. Set all four environment variables for **Production** (and Preview, if you
   want previews to work). None of them is `NEXT_PUBLIC_`.
4. No CORS change is needed on the API: every request to it is made server-side
   from Vercel, so no browser origin is involved.

Consider putting Vercel's own access protection in front of the deployment as
well. The password is the boundary; a second door costs nothing.
