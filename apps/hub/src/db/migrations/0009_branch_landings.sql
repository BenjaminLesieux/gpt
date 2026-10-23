CREATE TABLE `branch_landings` (
	`score_id` text NOT NULL,
	`branch` text NOT NULL,
	`ask_first` integer DEFAULT false NOT NULL,
	`status` text,
	`tip` text,
	`conflicts` text,
	`clean_bars` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`score_id`, `branch`),
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
