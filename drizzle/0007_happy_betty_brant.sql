CREATE TABLE `walletConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`network` enum('ethereum','base','arbitrum','polygon','solana') NOT NULL,
	`publicAddress` varchar(64) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastReadAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletConnections_ownerId_unique` UNIQUE(`ownerId`)
);
