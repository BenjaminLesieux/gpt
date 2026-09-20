-- Both columns are NOT NULL with no sensible default, which SQLite cannot add
-- to an existing table — so both tables are recreated and their rows carried
-- across. Nothing references either one, so this needs no foreign key dance.
--
-- The backfill reads `scores.account_id`, and that is correct for every row
-- that exists today: `score_members` was backfilled the same way, so before
-- this migration the owner is the only person a score has ever had.
CREATE TABLE `__new_score_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`score_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`last_pushed_at` integer,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_score_tokens` (`id`, `score_id`, `account_id`, `name`, `token_hash`, `created_at`, `last_used_at`, `last_pushed_at`)
SELECT `score_tokens`.`id`, `score_tokens`.`score_id`, `scores`.`account_id`, `score_tokens`.`name`, `score_tokens`.`token_hash`, `score_tokens`.`created_at`, `score_tokens`.`last_used_at`, `score_tokens`.`last_pushed_at`
FROM `score_tokens` INNER JOIN `scores` ON `scores`.`id` = `score_tokens`.`score_id`;
--> statement-breakpoint
DROP TABLE `score_tokens`;--> statement-breakpoint
ALTER TABLE `__new_score_tokens` RENAME TO `score_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `score_tokens_token_hash_unique` ON `score_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `score_tokens_score_id_idx` ON `score_tokens` (`score_id`);--> statement-breakpoint
CREATE INDEX `score_tokens_account_id_idx` ON `score_tokens` (`account_id`);--> statement-breakpoint
CREATE TABLE `__new_clone_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`score_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_clone_claims` (`id`, `code_hash`, `score_id`, `created_by`, `created_at`, `expires_at`, `redeemed_at`)
SELECT `clone_claims`.`id`, `clone_claims`.`code_hash`, `clone_claims`.`score_id`, `scores`.`account_id`, `clone_claims`.`created_at`, `clone_claims`.`expires_at`, `clone_claims`.`redeemed_at`
FROM `clone_claims` INNER JOIN `scores` ON `scores`.`id` = `clone_claims`.`score_id`;
--> statement-breakpoint
DROP TABLE `clone_claims`;--> statement-breakpoint
ALTER TABLE `__new_clone_claims` RENAME TO `clone_claims`;--> statement-breakpoint
CREATE UNIQUE INDEX `clone_claims_code_hash_unique` ON `clone_claims` (`code_hash`);--> statement-breakpoint
CREATE INDEX `clone_claims_score_id_idx` ON `clone_claims` (`score_id`);--> statement-breakpoint
CREATE INDEX `clone_claims_created_by_idx` ON `clone_claims` (`created_by`);--> statement-breakpoint
CREATE INDEX `clone_claims_expires_at_idx` ON `clone_claims` (`expires_at`);
