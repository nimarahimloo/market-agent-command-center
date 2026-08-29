CREATE TABLE `opportunityHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`opportunityId` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunityHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunityRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`externalKey` varchar(64) NOT NULL,
	`title` varchar(180) NOT NULL,
	`url` text NOT NULL,
	`source` varchar(180) NOT NULL,
	`verification` text NOT NULL,
	`status` enum('new','reviewing','verified','dismissed') NOT NULL DEFAULT 'new',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `opportunityRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`warningId` varchar(160) NOT NULL,
	`headline` text NOT NULL,
	`severity` varchar(16) NOT NULL,
	`confidence` int NOT NULL,
	`reason` text NOT NULL,
	`triggeredAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledged` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperAlerts_id` PRIMARY KEY(`id`)
);
