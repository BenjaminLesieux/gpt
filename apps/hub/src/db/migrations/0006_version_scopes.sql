CREATE TABLE `version_scopes` (
	`score_id` text NOT NULL,
	`commit` text NOT NULL,
	`tracks` text NOT NULL,
	`bars` integer NOT NULL,
	`track_count` integer NOT NULL,
	`meta` integer NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`score_id`, `commit`),
	FOREIGN KEY (`score_id`) REFERENCES `scores`(`id`) ON UPDATE no action ON DELETE cascade
);
