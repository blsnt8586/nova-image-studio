CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb,
	"error" text,
	"warning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_items" (
	"task_id" text NOT NULL,
	"item_index" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"object_keys" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "task_items_task_id_item_index_pk" PRIMARY KEY("task_id","item_index")
);
--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_expires_idx" ON "tasks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "task_items_user_idx" ON "task_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_items_task_idx" ON "task_items" USING btree ("task_id");