# WaveCheck

Event / conference registration system: organizers publish events, attendees
register and receive a credential token, and a terminal at the door checks
them in.

Both phases are in place. The software runs on its own — `/kiosk` turns any
tablet into a check-in terminal — and physical RFID readers are supported,
either through that page or through [`hardware-bridge/`](hardware-bridge/README.md)
for serial readers.

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
app/
  dashboard/                  organizer dashboard (RSC) + Server Actions
  kiosk/                      check-in terminal (client component)
  register/[eventId]/         public registration page (RSC) + client form
  api/auth/[...nextauth]/     Auth.js route handler
  api/events/                 GET (public) + POST (organizers)
  api/registrations/          POST (public, self-identifying)
  api/hardware/check-in/      POST — check in by token or registration id
  api/hardware/heartbeat/     POST — mark a kiosk ACTIVE
  api/hardware/events/        GET — events with live check-in tallies
  api/hardware/registrations/ GET — name/email lookup for manual check-in
components/ui/                shadcn/ui components
lib/auth.ts                   Auth.js config; exports auth/signIn/signOut
lib/db.ts                     Prisma client, built on first use
lib/password.ts               scrypt hashing for passwords and device keys
lib/hardware-auth.ts          device credential check for /api/hardware
lib/hardware-headers.ts       header names, server-free for the kiosk bundle
lib/api.ts                    shared JSON response helpers
lib/session-cookie.ts         cookie names shared with proxy.ts
lib/utils.ts                  cn() class-name helper
lib/generated/prisma          generated Prisma client (gitignored)
proxy.ts                      route protection (Next 16's middleware)
prisma/schema.prisma          database schema
prisma/seed.ts                demo data for local development
types/next-auth.d.ts          session/JWT type augmentation
hardware-bridge/              standalone serial RFID bridge (own package.json)
.github/workflows/ci.yml      typecheck, lint and build on every PR
```

## Getting started

You need **PostgreSQL** running locally and **Node.js 20.9 or newer** (Next 16
and the bridge both require it).

```bash
npm install                 # postinstall runs `prisma generate`
cp .env.example .env        # fill in all three variables — see below
npm run db:migrate          # creates the database if absent, applies migrations
npm run db:seed             # demo organizer, attendee, event, kiosk
npm run dev                 # http://localhost:3000
```

`.env.example` carries three variables and all three matter. `AUTH_URL` is the
easiest to skip and the most confusing to debug: without it Auth.js refuses to
trust the incoming Host header, and every `/api/auth` request fails with
`UntrustedHost`. It bites production builds rather than `next dev`, so an app
that works locally can break on deploy.

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
| `npm start`            | Serve a production build                 |
| `npm run typecheck`    | `next typegen && tsc --noEmit`           |
| `npm run lint`         | ESLint                                   |
| `npm run db:migrate`   | Create + apply a migration (development) |
| `npm run db:seed`      | Load the demo data                       |
| `npm run db:deploy`    | Apply migrations (production)            |
| `npm run db:generate`  | Regenerate the Prisma client             |
| `npm run db:push`      | Push the schema without a migration      |
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

`User` → organizes many `Event`s, and has many `Registration`s. `name` is
optional, so anything displaying an attendee falls back to their email.
`Event` → has many `CustomField`s and `Registration`s.
`Registration` carries a unique `credentialToken` — the credential a reader
scans — and a `customFieldResponses` JSON blob keyed by `CustomField` id.
`Device` is a check-in terminal: a `deviceIdentifier`, an `apiKeyHash`, and
`lastHeartbeatAt` for whether it is alive. It stands apart from the others,
with no relations into them.

Deleting an `Event` cascades to its `CustomField`s and `Registration`s.
Deleting a `User` cascades to their `Registration`s, but is **restricted**
while they still organize events — reassign or archive those first.


## API

| Route                     | Auth                    | Purpose                        |
| ------------------------- | ----------------------- | ------------------------------ |
| `GET /api/events`         | public                  | List published events          |
| `POST /api/events`        | ORGANIZER / ADMIN       | Create an event + custom fields|
| `POST /api/registrations` | public, self-identifying | Register an attendee, signing them up if new |
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

| Case                      | Response                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| Valid, not yet checked in | `{"success":true,"attendeeName":"...","checkedInAt":"..."}`                     |
| Already checked in        | `{"success":false,"message":"Already checked in","checkedInAt":"...","attendeeName":"..."}` |
| Unknown token             | `{"success":false,"message":"Invalid credential"}`                              |
| Cancelled registration    | `{"success":false,"message":"Registration cancelled","attendeeName":"..."}`     |

`checkedInAt` on a repeat scan is what lets a terminal say *when* someone came
through rather than only that they did. Every call also refreshes the calling
`Device`'s `lastHeartbeatAt` and marks it `ACTIVE`.

## Registering

`POST /api/registrations` is public, so the request has to prove who is
registering. The body carries `attendee` — name, email and password. A new
email creates the account; an email that already exists must supply the
matching password. There is no way to name an existing user by id, so the
endpoint cannot be used to register somebody else.

`/register/[eventId]` renders the event's `CustomField` rows rather than a
fixed set of questions: `TEXT` becomes a text input, `DROPDOWN` a native
`<select>` built from the field's `options`, and `BOOLEAN` a checkbox. Each
input's `name` is the `CustomField.id`, which is the key the API validates
required answers against, so `customFieldResponses` lines up by construction.

An unticked checkbox submits `false` rather than nothing, so a boolean field
always counts as answered — matching the API, which treats `undefined`, `null`
and `""` as missing and `false` as a real answer.

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

### Keyboard-wedge readers

A keyboard-wedge RFID reader behaves like a very fast keyboard: it types the
credential and presses Enter. The token field is therefore an ordinary text
input inside a `<form>`, so the reader's Enter submits it with no key handling
of its own — the same code path a human typing a token uses. Such a reader
needs no software on the machine at all: it just types into the focused
field.

Because the field is disabled while a check-in is in flight, and a disabled
element cannot take focus, the focus effect also re-runs when the field is
re-enabled. Without that the next tap would go nowhere.

**Manual fallback.** "Search by Email/Name" looks up registrations for the
selected event and checks one in directly. It posts the *registration id*, not
the credential token. The search endpoint never returns tokens at all: a token
is a credential, and nothing needs to hand one out to read a name.

## Hardware integration

Physical readers are supported. Which part of WaveCheck you need depends on
what the reader pretends to be:

| Reader | Behaviour | Use |
| --- | --- | --- |
| USB HID "keyboard wedge" | Types the UID and presses Enter | `/kiosk` in a browser — nothing to install |
| USB serial / UART | Appears as `/dev/ttyUSB0` or `COM3` | [`hardware-bridge/`](hardware-bridge/README.md) |

[`hardware-bridge/`](hardware-bridge/README.md) is a standalone Node project
that runs on the machine at the door, reads credentials off a serial reader
and posts them to `/api/hardware/check-in` with this device's key. It has its
own `package.json` and toolchain and is excluded from the app's TypeScript and
ESLint projects, so the two build independently.

Its README covers wiring (including why an MFRC522 breakout needs a UART
jumper or a microcontroller in front of it), getting a device key from the
dashboard, running it under systemd, and testing the whole path with `socat`
virtual serial ports instead of hardware.

## Hardware security

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
