CREATE TABLE "product_service"."data_migrations" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"description" varchar(500),
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_service"."banners" ADD COLUMN "data_source" varchar(20) DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_service"."products" ADD COLUMN "data_source" varchar(20) DEFAULT 'seed' NOT NULL;