ALTER TABLE `walletConnections` ADD `monitorTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `walletConnections` ADD `monitorEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `walletConnections` ADD `monitorStatus` varchar(32) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `walletConnections` ADD `lastHeartbeatAt` timestamp;