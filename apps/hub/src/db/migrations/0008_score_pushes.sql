CREATE TABLE `score_pushes` (
	`id` text PRIMARY KEY NOT NULL,
	`score_id` text NOT NULL,
	`token_id` text,
	`ref` text NOT NULL,
	`old_oid` text,
	`new_oid` text NOT NULL,
	`pushed_at` integer NOT NULL,
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `score_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `score_pushes_score_id_pushed_at_idx` ON `score_pushes` (`score_id`,`pushed_at`);--> statement-breakpoint
CREATE INDEX `score_pushes_token_id_idx` ON `score_pushes` (`token_id`);