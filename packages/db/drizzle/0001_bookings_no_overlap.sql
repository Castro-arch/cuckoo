-- Hand-written: Drizzle cannot express extensions or exclusion constraints (ADR-0002).
-- Makes double booking impossible at the DB level: for one owner, no two
-- non-cancelled bookings may have overlapping [start_at, end_at) ranges.
-- btree_gist lets the GiST index combine equality on owner_id with range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("owner_id" WITH =, "during" WITH &&)
  WHERE ("status" <> 'cancelled');
