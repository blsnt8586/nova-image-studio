ALTER TABLE "generations" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "generations_user_hash_idx" ON "generations" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "assets_user_hash_idx" ON "assets" USING btree ("user_id","content_hash");