CREATE TABLE `historicalDataRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`symbol` varchar(40) NOT NULL,
	`fromDate` varchar(10) NOT NULL,
	`toDate` varchar(10) NOT NULL,
	`timespan` varchar(16) NOT NULL,
	`adjusted` boolean NOT NULL,
	`barsCount` int NOT NULL,
	`provenance` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historicalDataRuns_id` PRIMARY KEY(`id`)
);
