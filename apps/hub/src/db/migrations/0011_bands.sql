CREATE TABLE `band_members` (
	`id` text PRIMARY KEY NOT NULL,
	`band_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `band_members_band_id_account_id_idx` ON `band_members` (`band_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `band_members_account_id_idx` ON `band_members` (`account_id`);--> statement-breakpoint
CREATE TABLE `bands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
-- Nothing is deployed (ADR 0012): a score has no band to move to, so it goes,
-- and the cascades take its tokens, claims and invites with it.
DELETE FROM `scores`;--> statement-breakpoint
DROP TABLE `score_members`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`band_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `scores`;--> statement-breakpoint
ALTER TABLE `__new_scores` RENAME TO `scores`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scores_band_id_idx` ON `scores` (`band_id`);