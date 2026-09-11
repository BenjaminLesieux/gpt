CREATE TABLE `score_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`score_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_tokens_token_hash_unique` ON `score_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `score_tokens_score_id_idx` ON `score_tokens` (`score_id`);--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scores_account_id_idx` ON `scores` (`account_id`);