CREATE SCHEMA IF NOT EXISTS "order_service";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "product_service";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "user_service";
--> statement-breakpoint
CREATE TABLE "product_service"."categories" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" varchar(21),
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"icon_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "order_service"."order_addresses" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"order_id" varchar(21) NOT NULL,
	"recipient" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"province" varchar(50) NOT NULL,
	"city" varchar(50) NOT NULL,
	"district" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"postal_code" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_addresses_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_service"."order_items" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"order_id" varchar(21) NOT NULL,
	"product_id" varchar(21) NOT NULL,
	"sku_id" varchar(21) NOT NULL,
	"product_title" varchar(200) NOT NULL,
	"sku_attrs" jsonb NOT NULL,
	"image_url" text,
	"unit_price" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_service"."orders" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_no" varchar(32) NOT NULL,
	"user_id" varchar(21) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pay_amount" numeric(12, 2) NOT NULL,
	"payment_method" varchar(20),
	"payment_no" varchar(100),
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"remark" text,
	"idempotency_key" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "order_service"."payment_records" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" varchar(21) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"transaction_id" varchar(100),
	"raw_notify" jsonb,
	"idempotency_key" varchar(64),
	CONSTRAINT "payment_records_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "product_service"."product_categories" (
	"product_id" varchar(21) NOT NULL,
	"category_id" varchar(21) NOT NULL,
	CONSTRAINT "product_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_service"."product_images" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"product_id" varchar(21) NOT NULL,
	"url" text NOT NULL,
	"alt_text" varchar(200),
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_service"."products" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"description" text,
	"brand" varchar(100),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"attributes" jsonb,
	"min_price" numeric(12, 2),
	"max_price" numeric(12, 2),
	"total_sales" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_service"."refresh_tokens" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"user_id" varchar(21) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "product_service"."skus" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" varchar(21) NOT NULL,
	"sku_code" varchar(50) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"compare_price" numeric(12, 2),
	"cost_price" numeric(12, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"low_stock" integer DEFAULT 5 NOT NULL,
	"weight" numeric(8, 2),
	"attributes" jsonb,
	"barcode" varchar(50),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skus_sku_code_unique" UNIQUE("sku_code")
);
--> statement-breakpoint
CREATE TABLE "order_service"."stock_operations" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"sku_id" varchar(21) NOT NULL,
	"order_id" varchar(21),
	"type" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_service"."user_addresses" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" varchar(21) NOT NULL,
	"label" varchar(50),
	"recipient" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"province" varchar(50) NOT NULL,
	"city" varchar(50) NOT NULL,
	"district" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"postal_code" varchar(10),
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_service"."users" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"nickname" varchar(50),
	"avatar_url" text,
	"phone" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_login" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "order_service"."order_addresses" ADD CONSTRAINT "order_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order_service"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order_service"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service"."payment_records" ADD CONSTRAINT "payment_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "order_service"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_service"."product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "product_service"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_service"."product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "product_service"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_service"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "product_service"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_service"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "user_service"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_service"."skus" ADD CONSTRAINT "skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "product_service"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_service"."user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "user_service"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_categories_parent" ON "product_service"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_categories_slug" ON "product_service"."categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_order_addresses_order" ON "order_service"."order_addresses" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_service"."order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_sku" ON "order_service"."order_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "order_service"."orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user_status" ON "order_service"."orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "order_service"."orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_orders_no" ON "order_service"."orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "idx_orders_idempotency" ON "order_service"."orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_payment_records_order" ON "order_service"."payment_records" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_product_images_product" ON "product_service"."product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_products_status" ON "product_service"."products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_products_slug" ON "product_service"."products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_products_brand" ON "product_service"."products" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "user_service"."refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires" ON "user_service"."refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_skus_product" ON "product_service"."skus" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_skus_code" ON "product_service"."skus" USING btree ("sku_code");--> statement-breakpoint
CREATE INDEX "idx_stock_ops_sku" ON "order_service"."stock_operations" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_stock_ops_order" ON "order_service"."stock_operations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_user_addresses_user" ON "user_service"."user_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "user_service"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "user_service"."users" USING btree ("status");