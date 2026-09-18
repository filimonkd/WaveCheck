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
event, a kiosk `KIOSK-001`, and a registration whose credential token is
`demo-credential-0001`.

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
| `POST /api/hardware/check-in` | none (see below)    | Kiosk check-in by credential   |

### Checking someone in

```bash
curl -X POST http://localhost:3000/api/hardware/check-in \
  -H 'Content-Type: application/json' \
  -d '{"deviceIdentifier":"KIOSK-001","credentialToken":"demo-credential-0001"}'
```

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

The dashboard is a Server Component that queries Prisma directly. An organizer
sees the events they own; an admin sees all of them. `createEvent` in
`app/dashboard/actions.ts` re-checks the session and role itself — Server
Actions are reachable by a direct POST, so `proxy.ts` confirming a cookie is
not enough — then writes the event and calls `revalidatePath('/dashboard')`.

`/register/[eventId]` renders a published event and calls `notFound()` for
anything else, so draft and archived events do not leak. Its client form posts
to `/api/registrations` and shows the returned `credentialToken`, which is
what the kiosk scans.

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
- **`POST /api/hardware/check-in` is unauthenticated.** `deviceIdentifier` is
  an identifier, not a secret, so anyone who can reach the endpoint and guess
  a credential token can check someone in. Give `Device` a hashed API key and
  require it before Phase 2 hardware ships.
- **`attendeeName` falls back to the attendee's email** when `User.name` is
  null, since the name is optional.
- **Passwords use scrypt, not bcrypt.** `lib/password.ts` is the only place
  that knows; hashes are prefixed with their scheme so a later swap can detect
  and re-hash old ones on next sign-in.
- **Capacity is checked inside a transaction but is still racy** under
  concurrent registration; enforce it with a database constraint if
  overselling matters.
