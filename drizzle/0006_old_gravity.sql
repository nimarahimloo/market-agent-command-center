CREATE TABLE `agentRunEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`runId` int NOT NULL,
	`eventId` varchar(160) NOT NULL,
	`status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`consensus` json,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentRunEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`mode` enum('single','batch') NOT NULL,
	`status` enum('queued','running','completed','partial','failed','cancelled') NOT NULL DEFAULT 'queued',
	`requestedCount` int NOT NULL,
	`completedCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`maxCalls` int NOT NULL,
	`budgetUnits` int NOT NULL,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agentOutputs` ADD `runId` int;--> statement-breakpoint
ALTER TABLE `agentOutputs` ADD `eventId` varchar(160);