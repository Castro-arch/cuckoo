CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'caldav');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'needs_reauth', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('jitsi', 'google_meet', 'in_person', 'phone', 'link');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"account_identifier" text NOT NULL,
	"display_name" text NOT NULL,
	"caldav_url" text,
	"credentials" "bytea" NOT NULL,
	"credentials_key_version" smallint NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_owner_account_unique" UNIQUE("owner_id","provider","account_identifier"),
	CONSTRAINT "calendar_connections_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "calendar_connections_caldav_url" CHECK (("calendar_connections"."provider" = 'caldav') = ("calendar_connections"."caldav_url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"check_conflicts" boolean DEFAULT true NOT NULL,
	"is_booking_target" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendars_connection_external_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "date_override_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"override_id" uuid NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "date_override_ranges_valid_range" CHECK ("date_override_ranges"."end_time" > "date_override_ranges"."start_time")
);
--> statement-breakpoint
CREATE TABLE "date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "date_overrides_schedule_date_unique" UNIQUE("schedule_id","date")
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_notice_minutes" integer DEFAULT 0 NOT NULL,
	"daily_limit" integer,
	"slot_interval_minutes" integer,
	"location_kind" "location_kind" NOT NULL,
	"location_details" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_owner_slug_unique" UNIQUE("owner_id","slug"),
	CONSTRAINT "event_types_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "event_types_slug_format" CHECK ("event_types"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
	CONSTRAINT "event_types_duration" CHECK ("event_types"."duration_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "event_types_buffer_before" CHECK ("event_types"."buffer_before_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "event_types_buffer_after" CHECK ("event_types"."buffer_after_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "event_types_minimum_notice" CHECK ("event_types"."minimum_notice_minutes" >= 0),
	CONSTRAINT "event_types_daily_limit" CHECK ("event_types"."daily_limit" > 0),
	CONSTRAINT "event_types_slot_interval" CHECK ("event_types"."slot_interval_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "event_types_location_details" CHECK ("event_types"."location_kind" IN ('jitsi', 'google_meet') OR "event_types"."location_details" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "schedule_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "schedule_rules_weekday" CHECK ("schedule_rules"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "schedule_rules_valid_range" CHECK ("schedule_rules"."end_time" > "schedule_rules"."start_time")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_owner_name_unique" UNIQUE("owner_id","name"),
	CONSTRAINT "schedules_id_owner_unique" UNIQUE("id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"username" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$')
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "event_type_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "guest_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "guest_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "guest_time_zone" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "manage_token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "rescheduled_from_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_connection_same_owner_fk" FOREIGN KEY ("connection_id","owner_id") REFERENCES "public"."calendar_connections"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_override_ranges" ADD CONSTRAINT "date_override_ranges_override_id_date_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."date_overrides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_overrides" ADD CONSTRAINT "date_overrides_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_schedule_same_owner_fk" FOREIGN KEY ("schedule_id","owner_id") REFERENCES "public"."schedules"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_one_booking_target_per_owner" ON "calendars" USING btree ("owner_id") WHERE "calendars"."is_booking_target";--> statement-breakpoint
CREATE INDEX "date_override_ranges_override_id_idx" ON "date_override_ranges" USING btree ("override_id");--> statement-breakpoint
CREATE INDEX "event_types_schedule_idx" ON "event_types" USING btree ("schedule_id","owner_id");--> statement-breakpoint
CREATE INDEX "schedule_rules_schedule_weekday_idx" ON "schedule_rules" USING btree ("schedule_id","weekday");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "verifications" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rescheduled_from_id_bookings_id_fk" FOREIGN KEY ("rescheduled_from_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_same_owner_fk" FOREIGN KEY ("event_type_id","owner_id") REFERENCES "public"."event_types"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_event_type_start_idx" ON "bookings" USING btree ("event_type_id","start_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_manage_token_hash_unique" UNIQUE("manage_token_hash");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_at" CHECK (("bookings"."status" = 'cancelled') = ("bookings"."cancelled_at" IS NOT NULL));