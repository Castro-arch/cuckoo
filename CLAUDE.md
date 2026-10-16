# Cuckoo

Open-source (AGPL-3.0) scheduling platform: a self-hostable alternative to
Calendly / Cal.com. CalDAV-native and EU-first. Built in public.

## Principles
1. Open forever: AGPL-3.0, the core is never closed.
2. Self-host first: `docker compose up` must give a working instance.
3. Open standards: CalDAV and iCalendar (RFC 5545) are first-class, not only Google.
4. EU-first: data can stay 100% in the EU; audit trail and GDPR features.
5. Built in public: code, roadmap and decisions (ADRs) are public, in English.

## Architecture (pnpm workspaces + Turborepo)
- `apps/web`     Next.js (App Router), Tailwind, shadcn/ui. Public booking pages + owner dashboard.
- `apps/api`     NestJS REST API. Auth, business rules, slot calculation, bookings. OpenAPI generated.
- `apps/worker`  BullMQ consumers: calendar sync, reminders, emails.
- `packages/core`   Pure domain logic (slot engine, timezone helpers). NO framework or DB imports.
- `packages/db`     Schema, migrations and DB client (ORM decided in ADR-0002).
- `packages/shared` Zod schemas and types shared by web, api and worker.
- `packages/config` Shared tsconfig / eslint / prettier.
- `docker-compose.yml` PostgreSQL 16 + Redis 7 (+ apps in production mode).

## Domain rules (non-negotiable)
- Every instant is stored in UTC (`timestamptz`). A user's timezone is stored as an IANA name (e.g. `Europe/Berlin`).
- Booking time is a `tstzrange` protected by an `EXCLUDE USING gist` constraint (extension `btree_gist`)
  scoped to the owner and ignoring cancelled bookings. Double booking must be impossible at the DB level.
- The API never waits on external providers inside a user request (except OAuth callbacks).
  Sync, reminders and emails go through BullMQ.
- Jobs are idempotent: deterministic `jobId` (e.g. `reminder:<bookingId>:<offset>`); rescheduling removes old jobs.
- Provider credentials (OAuth tokens, CalDAV passwords) are encrypted at rest (AES-256-GCM, key from env) and never logged.
- The slot engine in `packages/core` is a pure function:
  (schedule, date overrides, event type, busy intervals, range, now) -> available slots.
  It must have exhaustive unit tests, including DST transitions and owner/guest in different timezones.

## Conventions
- TypeScript strict mode, ESM everywhere.
- Validate all input with Zod; share schemas via `packages/shared`.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), small and focused commits.
- Tests: Vitest for unit/integration, Playwright for end-to-end.
- Every significant technical decision gets an ADR in `docs/adr/NNNN-title.md` (context, decision, consequences).
- Code, comments, commit messages and docs in English.
- Do not add a dependency without a one-line justification in the PR/commit body.
- Prefer boring, well-maintained libraries. No premature abstractions.

## Workflow for Claude Code
- For any non-trivial task: plan first, show the plan, wait for approval, then implement.
- Write or update tests in the same change as the code.
- Run lint, typecheck and tests before declaring a task done.
- Commit at each coherent step with a Conventional Commit message.
- If a rule above needs to change, propose an ADR instead of silently breaking it.

## Commands
<!-- Fill in as the project grows -->
- `pnpm install`
- `docker compose up -d db redis`
- `pnpm dev`
- `pnpm test`
- `pnpm lint && pnpm typecheck`

## Current phase: Phase 1 (MVP)
In scope:
- Sign up / login (email + Google)
- Event types (duration, buffers, minimum notice, daily limit, location)
- Weekly availability + date overrides
- Public booking page with a shareable link
- Google Calendar and CalDAV sync (free/busy + writing bookings)
- Confirmation, cancellation and rescheduling by email
- Automatic email reminders
- .ics invites and video link (Jitsi / Google Meet)
- Docker Compose install

Out of scope for now (do not build yet):
teams, round-robin, routing forms, custom workflows, SSO, Microsoft/Outlook,
payments, own CalDAV server, AI features, Cal.com/Calendly importer, hosted cloud.
