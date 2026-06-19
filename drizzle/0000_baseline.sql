CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_member" (
	"user_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision,
	"unit" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"category" text DEFAULT 'Annet' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_category" (
	"name" text PRIMARY KEY NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_email" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "invite_from_to_uq" UNIQUE("from_user_id","to_email")
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_url" text,
	"image_url" text,
	"instructions" text,
	"servings" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_image" (
	"recipe_id" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_rating" (
	"recipe_id" text NOT NULL,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recipe_rating_recipe_id_user_id_pk" PRIMARY KEY("recipe_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shopping_check" (
	"user_id" text NOT NULL,
	"item_key" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"override_quantity" double precision,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "shopping_check_user_id_item_key_pk" PRIMARY KEY("user_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "shopping_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text NOT NULL,
	"item_key" text NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision,
	"unit" text,
	"note" text,
	"source_recipe_id" text,
	"source_title" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_image" ADD CONSTRAINT "recipe_image_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_rating" ADD CONSTRAINT "recipe_rating_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_rating" ADD CONSTRAINT "recipe_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_entry" ADD CONSTRAINT "shopping_entry_source_recipe_id_recipe_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_catalog_name_idx" ON "ingredient_catalog" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_catalog_stock_uq" ON "ingredient_catalog" USING btree ("name_key") WHERE scope_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_catalog_scope_uq" ON "ingredient_catalog" USING btree ("scope_id","name_key") WHERE scope_id is not null;--> statement-breakpoint
CREATE INDEX "recipe_rating_recipe_idx" ON "recipe_rating" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "shopping_entry_scope_idx" ON "shopping_entry" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "shopping_entry_source_idx" ON "shopping_entry" USING btree ("source_recipe_id");