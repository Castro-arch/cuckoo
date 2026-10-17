# ADR-0003: Slot grid anchoring and BullMQ job ID format

- Status: Accepted
- Date: 2026-10-16

Two small decisions found while building the slot engine and the worker.

## 1. Slot grid anchoring

### Context
The slot engine (ADR-0002, `packages/core`) offers slots every `slotIntervalMinutes` from an
anchor, inside continuous availability. Hours that touch at midnight (e.g. Tue 22:30–00:00 and
Wed 00:00–01:30) merge, so a slot can span midnight.

The first version anchored the grid at the start of the merged availability *as seen from the
requested range* (built from one day before the range). For around-the-clock availability that
start moves with the range, so asking for "Wednesday" and for "this week" could return different
Wednesday slots whenever the step does not divide the day (e.g. 50 minutes, or 45 minutes on a
23-hour DST day). A guest paging through days would see slots shift.

### Decision
The anchor depends only on the schedule, never on the range. For a slot on owner-local day D:

- if its continuous availability began at or after owner-local midnight `GRID_LOOKBACK_DAYS`
  (1) day before D, the grid is anchored where that availability began;
- otherwise (availability running for more than a day, e.g. around the clock), the grid restarts
  at owner-local midnight of D.

The engine builds availability from a fixed lookback before the range (`GRID_LOOKBACK_DAYS + 1`
days), enough to tell which case applies. Guarded by tests:

- a property test asserts that two overlapping ranges return identical slots in their
  intersection;
- a property test asserts exact equality with a deliberately naive minute-by-minute reference
  implementation (`packages/core/test/reference-slots.ts`) that encodes this rule directly.

### Consequences
- Overnight hours (crossing one midnight) keep one grid: Tue 22:30 → slots 22:30, 23:30, 00:30.
- Around-the-clock availability gets a predictable grid starting at 00:00 every owner-local
  day. When the step does not divide the day, the last slot of a day can overlap the first slot
  of the next (e.g. 23:20–00:10 and 00:00–00:50 with 50-minute slots). Offered slots may
  already overlap when `slotIntervalMinutes < durationMinutes`, so this is not a new kind of
  output, and booking either one is still protected by the exclusion constraint.
- Availability that runs continuously across two or more midnights restarts its grid at the
  second midnight. Raising `GRID_LOOKBACK_DAYS` would extend the carried-over grid at the cost of
  building more days per query.

## 2. BullMQ job ID format

### Context
CLAUDE.md required deterministic job IDs such as `reminder:<bookingId>:<offset>`. BullMQ rejects
custom job IDs containing `:` ("Custom Id cannot contain :"), because it uses `:` as the
separator in its Redis keys. This was confirmed against BullMQ 6 while building the worker.

### Decision
Job IDs use `-` as the separator: `<kind>-<entityId>-<detail>`, e.g.
`reminder-<bookingId>-<offset>`. They stay deterministic, so jobs remain idempotent and
rescheduling removes old jobs by recomputing their IDs.

### Consequences
- Every job ID is built by a helper per job kind, never by ad-hoc string concatenation, and
  tested against BullMQ's validation.
- `-` also appears inside UUIDs. IDs are only ever recomputed from their parts and never parsed
  back, so this is not ambiguous in practice.
