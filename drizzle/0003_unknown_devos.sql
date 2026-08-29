CREATE TABLE `historicalDatasets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`format` enum('csv','ndjson') NOT NULL,
	`storageKey` text NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`byteSize` int NOT NULL,
	`rowCount` int NOT NULL,
	`symbol` varchar(40) NOT NULL,
	`timezone` varchar(64) NOT NULL,
	`firstTimestamp` timestamp,
	`lastTimestamp` timestamp,
	`status` enum('uploaded','validated','rejected') NOT NULL DEFAULT 'uploaded',
	`warnings` json,
	`errors` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historicalDatasets_id` PRIMARY KEY(`id`)
);
