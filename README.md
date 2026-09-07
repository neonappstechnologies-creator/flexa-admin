# Flexa operator panel

Switch a clinic off, and turn its reminders on or off. Internal; not a clinic's
own account and not part of the product.

It is a small Next.js app in front of two routes the Flexa API already has:

```
GET   /v1/internal/clinics       every clinic's operational state
PATCH /v1/internal/clinics/:id   one switch
```

Both sit behind `OpsGuard` (`x-ops-secret`) and are excluded from Swagger — see
`apps/api/src/ops/` in the `flexa-beauty` repo, which is the source of truth for
the shapes `src/lib/api.ts` restates.

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

## Running it

```bash
cp .env.example .env.local     # fill in all four
npm install
npm run dev                    # http://localhost:3000
```

Against a local API, set `FLEXA_API_BASE_URL=http://localhost:3001/v1` and give
`apps/api/.env` an `OPS_SECRET` matching this one — unset there, the API answers
`403 OPS_DISABLED` to everything and the panel says so.

## Deploying to Vercel

1. Push this directory as its own repository.
2. Import it on Vercel. It is a stock Next.js app — no build settings to change.
3. Set all four environment variables for **Production** (and Preview, if you
   want previews to work). None of them is `NEXT_PUBLIC_`.
4. No CORS change is needed on the API: every request to it is made server-side
   from Vercel, so no browser origin is involved.

Consider putting Vercel's own access protection in front of the deployment as
well. The password is the boundary; a second door costs nothing.
