CREATE TABLE "access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "access_grant_owner_email_uq" UNIQUE("owner_id","email")
);
--> statement-breakpoint
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
DROP TABLE "shopping_check";--> statement-breakpoint
CREATE TABLE "shopping_check" (
	"user_id" text NOT NULL,
	"item_key" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "shopping_check_user_id_item_key_pk" PRIMARY KEY("user_id","item_key")
);
--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_check" ADD CONSTRAINT "shopping_check_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
