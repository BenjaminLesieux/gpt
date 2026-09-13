CREATE TABLE `score_members` (
	`id` text PRIMARY KEY NOT NULL,
	`score_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_members_score_id_account_id_idx` ON `score_members` (`score_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `score_members_account_id_idx` ON `score_members` (`account_id`);--> statement-breakpoint
-- Every score that exists today has exactly one person, and authorization is
-- this table from here on: without this statement the migration would hide
-- every score in the database from the only account that can reach it.
--
-- The id is hex rather than the base32 `newId()` mints, because SQLite has no
-- base32 and a membership id is never a path segment — it is 128 random bits
-- either way. `created_at` comes from the score so the owner's membership is
-- as old as the thing it owns, rather than dated to whenever this ran.
INSERT INTO `score_members` (`id`, `score_id`, `account_id`, `role`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `account_id`, 'owner', `created_at` FROM `scores`;