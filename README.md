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
app/                 routes (App Router)
components/ui/       shadcn/ui components
lib/db.ts            Prisma client singleton
lib/utils.ts         cn() class-name helper
lib/generated/prisma generated Prisma client (gitignored)
prisma/schema.prisma database schema
prisma.config.ts     Prisma CLI config (migrations + datasource URL)
```

## Getting started

```bash
npm install                 # postinstall runs `prisma generate`
cp .env.example .env        # then fill in DATABASE_URL and NEXTAUTH_SECRET
npm run db:migrate          # create the initial migration + tables
npm run dev
```

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
