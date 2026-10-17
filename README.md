# Cuckoo

[![CI](https://github.com/Castro-arch/cuckoo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Castro-arch/cuckoo/actions/workflows/ci.yml)

Open-source scheduling that will never close its code.
A self-hostable alternative to Calendly and Cal.com: CalDAV-native, EU-first, AGPL-3.0.

> Status: early development (Phase 1 / MVP). Not ready for production.

## Goals
- Public booking links with real availability across Google Calendar and CalDAV
- Reminders, rescheduling and cancellation that just work
- One-command self-hosting with Docker Compose
- Your data stays where you choose (including 100% in the EU)

## Development
Requires Node >= 24, pnpm 12 and Docker.

```sh
pnpm install
cp .env.example .env
docker compose up -d --wait db redis
pnpm dev
```

- Web: http://localhost:3000 (health: `/api/health`)
- API: http://localhost:3001 (health: `/health`)
- Worker health: http://localhost:3002/health

Run `pnpm test`, `pnpm lint` and `pnpm typecheck` before opening a PR.

## Repository layout
| Path | What |
| --- | --- |
| `apps/web` | Next.js (App Router) + Tailwind: booking pages and dashboard |
| `apps/api` | NestJS REST API |
| `apps/worker` | BullMQ workers: calendar sync, reminders, emails |
| `packages/core` | Pure domain logic (slot engine, timezones) |
| `packages/db` | Schema, migrations, DB client |
| `packages/shared` | Zod schemas and types shared across apps |
| `packages/config` | Shared tsconfig / ESLint / Prettier |

## Decisions
Architecture decisions are recorded in [`docs/adr`](docs/adr).

## License
[AGPL-3.0](LICENSE)
