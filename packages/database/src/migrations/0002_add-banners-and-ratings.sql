CREATE TABLE "product_service"."banners" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" varchar(200) NOT NULL,
	"subtitle" varchar(200),
	"image_url" text NOT NULL,
	"link_type" varchar(20) DEFAULT 'product' NOT NULL,
	"link_value" varchar(200),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "product_service"."products" ADD COLUMN "avg_rating" numeric(2, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_service"."products" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_banners_active_sort" ON "product_service"."banners" USING btree ("is_active","sort_order");