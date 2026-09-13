CREATE TABLE `clone_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`score_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clone_claims_code_hash_unique` ON `clone_claims` (`code_hash`);--> statement-breakpoint
CREATE INDEX `clone_claims_score_id_idx` ON `clone_claims` (`score_id`);--> statement-breakpoint
CREATE INDEX `clone_claims_expires_at_idx` ON `clone_claims` (`expires_at`);