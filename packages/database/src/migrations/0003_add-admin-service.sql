CREATE SCHEMA IF NOT EXISTS "admin_service";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_service"."admins" (
  "id" varchar(21) PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "username" varchar(50) NOT NULL UNIQUE,
  "password" varchar(255) NOT NULL,
  "real_name" varchar(50),
  "phone" varchar(20),
  "email" varchar(255),
  "role" varchar(20) DEFAULT 'admin' NOT NULL,
  "is_super" boolean DEFAULT false NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "must_change_password" boolean DEFAULT true NOT NULL,
  "last_login_at" timestamp with time zone,
  "login_fail_count" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admins_username" ON "admin_service"."admins" ("username");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admins_status" ON "admin_service"."admins" ("status");
