# WaveCheck

Event / conference registration system. **Phase 1 is software only**; the
`Device` model is already in place for the Phase 2 hardware check-in terminals
(QR / RFID readers).

## Stack

| Concern    | Choice                                      |
| ---------- | ------------------------------------------- |
| Framework  | Next.js 16 (App Router)                     |
| Language   | TypeScript (strict)                         |
| Database   | PostgreSQL                                  |
| ORM        | Prisma 7 (via the `@prisma/adapter-pg` driver adapter) |
| Styling    | Tailwind CSS v4                             |
| Components | shadcn/ui (Radix base, `new-york`, neutral) |

## Layout

```
app/dashboard/               organizer dashboard (RSC) + Server Action
app/kiosk/                   check-in terminal (client component)
app/register/[eventId]/      public registration page (RSC) + client form
app/api/auth/[...nextauth]/  Auth.js route handler
app/api/events/              GET (public) + POST (organizers)
app/api/registrations/       POST (public for now)
app/api/hardware/check-in/   POST — Phase 2 kiosk endpoint
components/ui/               shadcn/ui components
lib/auth.ts                  Auth.js config; exports auth/signIn/signOut
lib/db.ts                    Prisma client singleton
lib/password.ts              password hashing (scrypt)
lib/api.ts                   shared JSON response helpers
lib/session-cookie.ts        cookie names shared with proxy.ts
lib/utils.ts                 cn() class-name helper
lib/generated/prisma         generated Prisma client (gitignored)
proxy.ts                     route protection (Next 16's middleware)
prisma/schema.prisma         database schema
prisma/seed.ts               demo data for local development
types/next-auth.d.ts         session/JWT type augmentation
```

## Getting started

```bash
npm install                 # postinstall runs `prisma generate`
cp .env.example .env        # then fill in DATABASE_URL and NEXTAUTH_SECRET
npm run db:migrate          # create the initial migration + tables
npm run db:seed             # demo organizer, attendee, event, kiosk
npm run dev
```

The seed creates two logins (`organizer@wavecheck.test` and
`attendee@wavecheck.test`, both with password `password123`), a published
event, a registration whose credential token is `demo-credential-0001`, and a
kiosk `KIOSK-001` whose API key is `demo-kiosk-api-key-0001`. That key is a
fixed development convenience — real kiosks get a random one from the
dashboard, and it is the only place a key is ever readable.

## Scripts

| Script                | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `npm run dev`          | Dev server                               |
| `npm run build`        | Production build                         |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm run lint`         | ESLint                                   |
| `npm run db:migrate`   | Create + apply a migration (development) |
| `npm run db:deploy`    | Apply migrations (production)            |
| `npm run db:generate`  | Regenerate the Prisma client             |
| `npm run db:studio`    | Prisma Studio                            |

## Notes on Prisma 7

Prisma 7 no longer accepts `url` inside the `datasource` block:

- the **CLI** (migrate, studio) reads `DATABASE_URL` through `prisma.config.ts`;
- the **runtime** connects through a driver adapter, which `lib/db.ts` builds
  with `new PrismaPg({ connectionString })`.

Import the client from `@/lib/db`:

```ts
import { db } from "@/lib/db";

const events = await db.event.findMany({ include: { customFields: true } });
```

## Data model

`User` → organizes many `Event`s, and has many `Registration`s.
`Event` → has many `CustomField`s and `Registration`s.
`Registration` carries a unique `credentialToken` (the future QR / RFID
credential) and a `customFieldResponses` JSON blob keyed by `CustomField` id.

Deleting an `Event` cascades to its `CustomField`s and `Registration`s.
Deleting a `User` cascades to their `Registration`s, but is **restricted**
while they still organize events — reassign or archive those first.


## API

| Route                     | Auth                    | Purpose                        |
| ------------------------- | ----------------------- | ------------------------------ |
| `GET /api/events`         | public                  | List published events          |
| `POST /api/events`        | ORGANIZER / ADMIN       | Create an event + custom fields|
| `POST /api/registrations` | public (see below)      | Register an attendee, signing them up if new |
| `POST /api/hardware/check-in` | device key          | Check in by credential token or registration id |
| `POST /api/hardware/heartbeat` | device key         | Mark a kiosk ACTIVE |
| `GET /api/hardware/events` | device key            | Published events with live check-in tallies |
| `GET /api/hardware/registrations` | device key      | Name/email lookup for manual check-in |

### Checking someone in

```bash
curl -X POST http://localhost:3000/api/hardware/check-in \
  -H 'Content-Type: application/json' \
  -H 'x-device-identifier: KIOSK-001' \
  -H 'x-device-api-key: demo-kiosk-api-key-0001' \
  -d '{"credentialToken":"demo-credential-0001"}'
```

The device comes from the headers, never the body, so a kiosk cannot record a
check-in against another terminal. `demo-kiosk-api-key-0001` is the seeded
demo key; real kiosks get theirs from the dashboard.

Every business outcome returns HTTP 200 and a `success` flag, because kiosk
firmware tends to collapse non-2xx responses into a generic network error and
swallow the message meant for the screen. Only a malformed body is a 400.

| Case                        | Response                                              |
| --------------------------- | ----------------------------------------------------- |
| Valid, not yet checked in   | `{"success":true,"attendeeName":"..."}`               |
| Already checked in          | `{"success":false,"message":"Already checked in"}`    |
| Unknown token               | `{"success":false,"message":"Invalid credential"}`    |
| Cancelled registration      | `{"success":false,"message":"Registration cancelled"}`|

A known `deviceIdentifier` also updates that `Device`'s `lastHeartbeatAt` and
marks it `ACTIVE`.

## Pages

| Route                  | Access             | What it does                                  |
| ---------------------- | ------------------ | --------------------------------------------- |
| `/dashboard`           | ORGANIZER / ADMIN  | Lists events and creates them via a Server Action |
| `/register/[eventId]`  | public             | Sign-up form for a published event            |
| `/kiosk`               | public             | Check-in terminal for the entrance tablet      |

The dashboard is a Server Component that queries Prisma directly. An organizer
sees the events they own; an admin sees all of them. `createEvent` in
`app/dashboard/actions.ts` re-checks the session and role itself — Server
Actions are reachable by a direct POST, so `proxy.ts` confirming a cookie is
not enough — then writes the event and calls `revalidatePath('/dashboard')`.

`/register/[eventId]` renders a published event and calls `notFound()` for
anything else, so draft and archived events do not leak. Its client form posts
to `/api/registrations` and shows the returned `credentialToken`, which is
what the kiosk scans.

## Kiosk

`/kiosk` is the terminal that runs on a tablet at the entrance. It is a client
component and deliberately unauthenticated — it is a standalone appliance, not
a staff login — so `proxy.ts` does not cover it.

Using it:

1. On the dashboard, under **Kiosk Credentials**, generate credentials for the
   terminal. The API key is shown once and never again.
2. Open `/kiosk`, enter that **Device Identifier** and **API Key** plus an
   optional location, then press **Connect**. That calls
   `POST /api/hardware/heartbeat`, which marks the device `ACTIVE`. The kiosk
   re-sends a heartbeat every 60 seconds so `lastHeartbeatAt` stays
   meaningful, and stores its credentials in `localStorage` so a reload or a
   reboot comes back ready. **Disconnect** clears them.
3. Pick the event being checked in. The header shows
   `Checked In: X / Y Total Registrations`, refreshed after every scan.
   Cancelled registrations are excluded from Y.
4. Scan a badge. The token field is focused on entry and re-focused after
   every scan, so an unattended terminal is always ready for the next tap.

### How this simulates Phase 2 hardware

A keyboard-wedge RFID reader behaves like a very fast keyboard: it types the
credential and presses Enter. The token field is therefore an ordinary text
input inside a `<form>`, so the reader's Enter submits it with no key handling
of its own — the same code path a human typing a token uses. When real readers
arrive they need no application change; they just type into the focused field.

Because the field is disabled while a check-in is in flight, and a disabled
element cannot take focus, the focus effect also re-runs when the field is
re-enabled. Without that the next tap would go nowhere.

**Manual fallback.** "Search by Email/Name" looks up registrations for the
selected event and checks one in directly. It posts the *registration id*, not
the credential token: the search endpoint never returns tokens, since the token
is the credential and the endpoint is unauthenticated.

### Hardware security

Every `/api/hardware/*` route requires device credentials, sent as headers:

```
x-device-identifier: KIOSK-001
x-device-api-key:    <the key shown once at provisioning>
```

- Keys are generated with 32 bytes from a CSPRNG and stored only as a scrypt
  hash, using the same `lib/password.ts` helpers as user passwords. A leaked
  database cannot be used to impersonate a terminal.
- Provisioning is an ORGANIZER/ADMIN Server Action, which re-checks the
  session and role itself — Server Actions are reachable by direct POST.
- A failed check returns the same `401` whether the device is unknown, was
  provisioned before key auth existed, or simply sent the wrong key, and an
  unknown device still pays for a hash comparison. Otherwise response times
  would reveal which kiosk identifiers exist.
- `proxy.ts` still exempts `/api/hardware` from the *session* check. That is
  not public access: a kiosk is an appliance with no user session, so the
  cookie check would reject it before it could present its own credentials.

Verifying the key costs roughly 45 ms per request, which is scrypt doing its
job. That is comfortable for a kiosk. If these endpoints ever serve heavy
traffic, note that API keys are high-entropy random strings and do not need a
slow KDF the way user-chosen passwords do — a single SHA-256 would be
cryptographically sufficient and far cheaper.

## CI

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`:
`npm ci`, then typecheck, lint and build. It needs no database — `lib/db.ts`
builds its Prisma client on first use, so importing a route module during the
build does not open a connection.

Note that `npm run typecheck` runs `next typegen` first. `PageProps` and
`LayoutProps` are generated by Next.js, so a bare `tsc --noEmit` fails on a
fresh checkout that has never been built.

## Authentication

Auth.js v5 (`next-auth@5` beta) with a Credentials provider. Credentials
cannot use database sessions, so the session strategy is JWT and the session
carries `user.id` and `user.role`.

`proxy.ts` — Next.js 16 renamed `middleware.ts` to `proxy.ts` — guards
`/dashboard/*` and `/api/*`. It is deliberately an **optimistic** check: it
only looks for a session cookie and never touches the database, because it
runs on every matched request. Real authorization lives in each route
handler, which calls `auth()` and checks the role itself.

`@auth/prisma-adapter` is installed but **not wired up**. It stores sessions
and OAuth accounts, which a JWT + Credentials setup does not use, and it
expects `Account`, `Session` and `VerificationToken` models plus Auth.js's own
`User` shape. Add those models when you add an OAuth provider.

## Known gaps

These are deliberate MVP shortcuts, not oversights:

- **`POST /api/registrations` is public.** Signing up inline is safe — an
  existing email must prove itself with the matching password — but the older
  `attendeeId` path takes a bare user id, so anyone can still register anyone.
  Drop `attendeeId` or require a session before this goes anywhere public.
- **The registration form's dietary field is hardcoded.** It is stored under
  the key `dietaryRestriction`, while the API checks an event's *required*
  fields by `CustomField.id`. So an event with required custom fields will
  reject this form until it renders the event's real fields.
- **There is no key rotation.** Provisioning refuses an identifier that
  already exists, so a lost key means issuing a new device rather than
  re-keying the old one. Deleting the `Device` row revokes access.
- **A kiosk keeps its key in `localStorage`.** That is what lets a tablet
  survive a reload, but it means a stolen tablet is a stolen key. Revoke by
  deleting the device. Any script injected into the kiosk page could also read
  it, so keep that page's dependencies boring.
- **Devices seeded before key auth have `apiKeyHash` null** and cannot
  authenticate. Re-run `npm run db:seed`, or issue them fresh credentials.
- **`attendeeName` falls back to the attendee's email** when `User.name` is
  null, since the name is optional.
- **Passwords use scrypt, not bcrypt.** `lib/password.ts` is the only place
  that knows; hashes are prefixed with their scheme so a later swap can detect
  and re-hash old ones on next sign-in.
- **Capacity is checked inside a transaction but is still racy** under
  concurrent registration; enforce it with a database constraint if
  overselling matters.
