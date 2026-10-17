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
- Do not add a dependency without a one-line justification (included in the proposed commit message).
- Prefer boring, well-maintained libraries. No premature abstractions.

## Git policy (strict)
The maintainer makes every commit and push himself. Claude Code never does.
- NEVER run `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git tag`,
  `git stash` or any other command that writes history or touches the remote.
- Read-only git is fine: `git status`, `git diff`, `git log`, `git show`, `git blame`.
- Never stage files (`git add`). The maintainer reviews the diff and stages himself.
- At the end of each coherent step, STOP and hand over a commit proposal:
  1. The list of files to stage.
  2. The exact commands, ready to paste (`git add <paths>` then `git commit -F -` or `-m`).
  3. A Conventional Commit message: imperative subject <= 72 chars with scope
     (e.g. `feat(core): add slot engine`), a body explaining WHAT and WHY,
     and a `Dependencies:` list justifying each new package.
- No `Co-Authored-By` or any AI attribution in commit messages.
- One logical change per commit. Split unrelated changes into separate proposals.

## Engineering standard
Work at the level of a senior engineer at a big tech company.
- Design before code: state the problem, constraints, options with trade-offs, and the choice.
- Small, reviewable changes. Each one builds, passes lint, typecheck and tests on its own.
- Tests are part of the change: unit tests for logic, integration tests for boundaries,
  edge cases and failure paths covered, no test that only asserts the happy path.
- Explicit error handling: typed errors, no swallowed exceptions, actionable messages.
- Security by default: validate all input, least privilege, no secrets in code or logs.
- Observability: structured logs with context, health checks, meaningful error codes.
- Performance awareness: note complexity and query cost when they matter; avoid N+1.
- Naming and structure that read without comments; comments explain WHY, not WHAT.
- Public APIs and modules documented; non-obvious decisions get an ADR.
- When unsure about requirements, ask instead of guessing.

## Workflow for Claude Code
- For any non-trivial task: plan first, show the plan, wait for approval, then implement.
- Write or update tests in the same change as the code.
- Run lint, typecheck and tests before declaring a step done, and report the results.
- End every step with the commit proposal described in the Git policy, then wait.
- If a rule above needs to change, propose an ADR instead of silently breaking it.

## Commands
Requires Node >= 24 (`.nvmrc`), pnpm 12 and Docker.
- `pnpm install`
- `cp .env.example .env` (set `POSTGRES_PORT` / `REDIS_PORT` and the URLs if 5432/6379 are taken)
- `docker compose up -d --wait db redis`   PostgreSQL 16 + Redis 7
- `pnpm dev`        web :3000, api :3001, worker health :3002 (watch mode, all apps)
- `pnpm build`      build every package and app
- `pnpm test`       Vitest in every workspace that has tests
- `pnpm lint && pnpm typecheck`
- `pnpm format` / `pnpm format:check`   Prettier (Markdown is excluded)
- Single workspace: `pnpm --filter @cuckoo/<name> <script>` (e.g. `pnpm --filter @cuckoo/core test:watch`)

Health endpoints: `GET http://localhost:3000/api/health`, `GET http://localhost:3001/health`,
`GET http://localhost:3002/health` (503 when Redis is down).

Notes:
- Internal packages compile to `dist/`; Turbo builds dependencies first (`^build`).
- The api and worker load `../../.env` with `node --env-file-if-exists`. Turbo runs in strict
  env mode: a new runtime env var must be added to `passThroughEnv` in `turbo.json`.
- Install scripts are opt-in via `allowBuilds` in `pnpm-workspace.yaml`.

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
