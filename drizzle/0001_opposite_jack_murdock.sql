CREATE TABLE `agentOutputs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`role` varchar(64) NOT NULL,
	`instrumentId` int,
	`stance` varchar(32) NOT NULL,
	`confidence` int NOT NULL,
	`rationale` text NOT NULL,
	`evidenceRefs` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentOutputs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` int,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`assetClass` varchar(32) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `instruments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`credentialRef` text,
	`isConnected` boolean NOT NULL DEFAULT false,
	`isReadOnly` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intelligenceItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`sourceName` varchar(128) NOT NULL,
	`sourceUrl` text NOT NULL,
	`headline` text NOT NULL,
	`entities` json,
	`affectedMarkets` json,
	`sentiment` decimal(5,3),
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intelligenceItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskControls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`positionSizeLimit` decimal(8,4) NOT NULL DEFAULT '0.5000',
	`dailyLossLimit` decimal(8,4) NOT NULL DEFAULT '2.0000',
	`exposureCap` decimal(8,4) NOT NULL DEFAULT '10.0000',
	`killSwitchArmed` boolean NOT NULL DEFAULT true,
	`liveTradingEnabled` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `riskControls_id` PRIMARY KEY(`id`),
	CONSTRAINT `riskControls_ownerId_unique` UNIQUE(`ownerId`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`instrumentId` int NOT NULL,
	`direction` varchar(32) NOT NULL,
	`confidence` int NOT NULL,
	`rationale` text NOT NULL,
	`invalidationLevel` decimal(20,8),
	`riskReward` decimal(8,3),
	`status` enum('research','paper_approved','archived') NOT NULL DEFAULT 'research',
	`reasoningRefs` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `simulations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`universe` json,
	`lookbackSessions` int NOT NULL,
	`status` enum('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
	`returnPct` decimal(10,4),
	`maxDrawdownPct` decimal(10,4),
	`winRatePct` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `simulations_id` PRIMARY KEY(`id`)
);
