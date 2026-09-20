CREATE TABLE `score_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`score_id` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_invites_code_hash_unique` ON `score_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `score_invites_score_id_idx` ON `score_invites` (`score_id`);--> statement-breakpoint
CREATE INDEX `score_invites_invited_by_idx` ON `score_invites` (`invited_by`);--> statement-breakpoint
CREATE INDEX `score_invites_expires_at_idx` ON `score_invites` (`expires_at`);