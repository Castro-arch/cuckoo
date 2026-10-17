# ADR-0002: Drizzle ORM and the Temporal API (via temporal-polyfill)

- Status: Accepted
- Date: 2026-10-16

## Context
`packages/db` needs a schema, migration and query layer, and `packages/core` needs a
date/time library for the slot engine. The choice is constrained by the domain rules:

- Booking time is a `tstzrange` protected by `EXCLUDE USING gist` (extension `btree_gist`),
  scoped to the owner and ignoring cancelled bookings. Double booking must be impossible at
  the DB level, so this constraint is the most important piece of SQL in the project.
- Every instant is `timestamptz` in UTC; user timezones are IANA names.
- The slot engine is a pure function with exhaustive DST and cross-timezone tests.
- Overlap queries (`&&`, `@>`, `lower()/upper()`) on ranges will be common: free/busy,
  slot calculation, daily limits.

Ecosystem state as of this ADR:

- Prisma: 7.10.1 is the latest stable; npm's `latest` tag currently points to 8.0.0-rc and
  "Prisma Next" is in early access, i.e. another major redesign is in flight.
- Drizzle: 0.45.x is the latest stable; 1.0 is in release candidate.
- Temporal is enabled by default in Node 26 (May 2026), Chrome 144 and Firefox 139, but not in
  stable Safari (Technology Preview only). This repo targets Node 24 (`.nvmrc`), where Temporal
  is behind `--harmony-temporal`.

## Options

### ORM: Prisma vs Drizzle

| Criterion | Prisma 7 | Drizzle 0.45 |
| --- | --- | --- |
| `tstzrange` column | Only as `Unsupported("tstzrange")`. Such fields are **excluded from the generated client**: they cannot be read or written through the Prisma API, only via raw SQL. | No built-in range type, but `customType` maps it to a typed TS value with our own `toDriver`/`fromDriver`. Fully usable in selects, inserts and `where`. |
| `EXCLUDE USING gist` | Prisma's feature matrix: schema "Not yet", Migrate "Not yet". Must be hand-written into a `--create-only` migration and is invisible to the schema. | Not expressible in the schema DSL either. Hand-written in a custom migration (`drizzle-kit generate --custom`). Same gap, same workaround. |
| Raw SQL ergonomics | `$queryRaw` tagged templates (untyped results) or TypedSQL (`.sql` files + `prisma generate --sql`, typed, but no dynamic queries). Two separate worlds: model API vs SQL. | `sql` template composes **inside** the typed query builder: `where(sql\`${bookings.during} && ${range}\`)` keeps column references typed and parameters bound. One world. |
| Migrations | Mature `migrate dev/deploy`, shadow DB drift detection. Drift detection fights hand-written objects it does not model (exclusion constraints, GiST on unsupported types) unless carefully managed. | `drizzle-kit generate` diffs schema snapshots (not the live DB), so hand-written constraints are not "corrected" away. `drizzle-kit migrate` or the runtime `migrate()` applies plain SQL files. Avoid `push` outside throwaway DBs. |
| Type safety | Excellent for modelled fields; none for `Unsupported` fields or `$queryRaw` results. | Types inferred from the TS schema, including custom types; `sql<T>` gives explicit typing for raw fragments. |
| Runtime / footprint | v7 dropped the Rust engine (TS query compiler + driver adapters), which closes most of the historical gap. Still a codegen step (`prisma generate`) and a separate schema language. | Plain TS, no codegen, thin layer over `pg`. Schema is TypeScript, so it lives naturally in a workspace package. |
| Churn risk | v8 RC and "Prisma Next" signal another major redesign soon. | 1.0 RC changes the migration folder layout and relational query API; `drizzle-kit up` upgrades migrations. |

The decisive point is the booking range. With Prisma, the single most important column in the
system is either invisible to the client or requires routing every booking query through raw
SQL, which removes most of Prisma's value exactly where we need it. With Drizzle, the range is
a typed column and raw SQL fragments compose with the typed builder.

### Date library: Luxon vs Temporal (polyfill)

| Criterion | Luxon 3.7 | Temporal + `temporal-polyfill` |
| --- | --- | --- |
| Model | One `DateTime` type carrying a zone. Wall-clock vs exact time is implicit. | Distinct types: `Instant` (exact, matches `timestamptz`), `ZonedDateTime`, `PlainDate`, `PlainTime`, `PlainDateTime`. Weekly availability ("Mon 09:00–17:00 in Europe/Berlin") maps to `PlainTime` + IANA zone without conversions. |
| DST gaps/overlaps | Handled with fixed internal behaviour (e.g. shifting forward in gaps); no per-call choice for ambiguous times. | Explicit `disambiguation: 'compatible' \| 'earlier' \| 'later' \| 'reject'` and `offset` options. The slot engine can state and test exactly what happens on transition days. |
| Arithmetic | Calendar-aware, good. | Calendar vs exact arithmetic is explicit (`ZonedDateTime.add({ days: 1 })` vs `Instant.add({ hours: 24 })`), the core distinction a scheduling engine needs. |
| Future | Mature, but effectively in maintenance (last release 2025-09). | TC39 standard, shipped in Node 26, Chrome, Firefox. The polyfill becomes removable once Node and Safari baselines allow it. |
| Immutability / API | Immutable, fluent. | Immutable, standard; types and docs from MDN. |
| Size (web) | Medium. | `temporal-polyfill` is the compact, spec-compliant polyfill (1.0, actively maintained); `@js-temporal/polyfill` is the larger reference polyfill (0.5, last release 2025-03). |

## Decision

1. **ORM: Drizzle ORM** (latest stable 0.45.x) with **drizzle-kit** for migrations and
   **`pg`** (node-postgres) as the driver.
   - Start on the stable line. Move to 1.0 in a follow-up change once it is released
     (expected to be mechanical via `drizzle-kit up`).
   - `pg` over `postgres.js`: the most widely used Postgres driver for Node, the one Drizzle
     documents first, and the same family BullMQ 6's optional Postgres backend uses.
2. **Bookings range modelling:** store `start_at` and `end_at` as `timestamptz` columns and
   derive the range from them:
   ```sql
   during tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
   CONSTRAINT bookings_valid_range CHECK (end_at > start_at)
   -- custom migration:
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
     EXCLUDE USING gist (owner_id WITH =, during WITH &&)
     WHERE (status <> 'cancelled');
   ```
   - The range is always half-open, `'[)'`: a booking ending at 10:00 and one starting at
     10:00 do not overlap, so back-to-back bookings never conflict.
   - `CHECK (end_at > start_at)` rejects zero-length bookings (`23514`, constraint
     `bookings_valid_range`). A reversed booking (`end_at < start_at`) is already rejected by
     the `tstzrange` constructor before the CHECK runs (`22000`, "range lower bound must be
     less than or equal to range upper bound"). Both are rejected; the API validates the order
     with Zod first so users never see either error.
   - Application code reads and writes two plain typed `Date` columns. The range exists for
     the constraint and for overlap queries (`sql` fragments on `during`), so there is no custom
     range parsing in the hot path. This satisfies the domain rule: booking time is a
     `tstzrange` under an `EXCLUDE USING gist` constraint, and the range cannot drift from
     `start_at`/`end_at` because Postgres computes it.
   - The exclusion constraint's GiST index on `(owner_id, during)` also serves overlap queries
     scoped to an owner, so no separate index is needed for them.

   **Buffers are not part of the stored range.** Event-type buffers (before/after) are
   enforced by the slot engine, not by the database. Trade-off:
   - For: the stored range is exactly the meeting, the true fact. Buffers are a per-event-type
     policy that can change after a booking exists; baking them into the constrained range
     would freeze one buffer semantics into the schema and require rewriting rows when an
     owner edits their event types. External calendar busy times (Google, CalDAV) are never
     in this constraint either, so the slot engine is the place where availability is
     decided anyway.
   - Against: the database guarantees no overlapping meetings, but not respected buffers. Two
     concurrent requests could each pass the slot check and create bookings that do not
     overlap but violate a buffer between them. The booking flow must therefore re-check
     availability inside the insert transaction, serialized per owner (e.g. a transaction-level
     advisory lock); that is decided when the booking flow is built.
3. **Constraints Drizzle cannot model** (extensions, exclusion constraints, partial GiST
   indexes) live in custom migrations created with `drizzle-kit generate --custom`, with a
   comment pointing to this ADR. Integration tests assert they exist and reject overlaps.
4. **Date library: the Temporal API from `temporal-polyfill`**, never from the global, so every
   runtime (Node 24, Safari, Vitest) runs the same implementation and DST tests stay
   deterministic. Luxon is not used.
   - `temporal-polyfill` is a dependency of `packages/core` only, and is imported in exactly one
     module, `packages/core/src/temporal.ts`, which re-exports `Temporal`.
   - Everything else, inside core and in other packages, imports `Temporal` from that module
     (`@cuckoo/core`), never from `temporal-polyfill` directly. An ESLint
     `no-restricted-imports` rule enforces this when the module is added.
5. **Boundary rule:** `packages/db` speaks `Date` (what `pg` returns for `timestamptz`).
   Conversion to `Temporal.Instant` happens at the edge of `packages/core`
   (`Temporal.Instant.fromEpochMilliseconds(date.getTime())`); core never sees `Date`.

## Consequences
- The most important invariant (no double booking) is enforced by hand-written SQL that the
  ORM does not know about. It must be covered by integration tests against real Postgres,
  which `docker compose` already provides.
- `drizzle-kit push` must not be used against shared or production databases; only
  `generate` + `migrate`. Documented in `packages/db/README.md`.
- An upgrade to Drizzle 1.0 is expected soon and is tracked as a follow-up.
- Buffer correctness depends on application code (slot engine + transactional re-check), not
  on the database. The booking-flow tests must cover concurrent bookings around a buffer.
- Only `packages/core` depends on `temporal-polyfill`. When the Node baseline is 26+ and stable
  Safari ships Temporal, a later ADR can switch to the native global by changing one file,
  `packages/core/src/temporal.ts`, and dropping the dependency.
- Team members unfamiliar with Temporal face a learning curve; it is offset by MDN
  documentation and by Temporal being the platform's future date API.
- Reversibility: the schema is plain SQL migrations, so moving off Drizzle later would not
  require a data migration.

## References
- Prisma ORM v7 database features matrix: https://www.prisma.io/docs/orm/v7/reference/database-features
- Prisma TypedSQL: https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql
- Drizzle: range types request https://github.com/drizzle-team/drizzle-orm/issues/2700,
  exclusion constraints request https://github.com/drizzle-team/drizzle-orm/issues/3388
- Drizzle generated columns: https://orm.drizzle.team/docs/generated-columns
- Node.js 26 enables Temporal by default: https://www.infoq.com/news/2026/07/nodejs-26-temporal/
- Temporal browser support: https://caniuse.com/mdn-javascript_builtins_temporal_instant
