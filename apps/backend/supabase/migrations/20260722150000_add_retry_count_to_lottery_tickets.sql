-- Tracks how many times a lottery ticket's purchase has been auto-retried after landing in
-- 'failed' status, so the auto-retry cron can cap attempts instead of retrying a genuinely,
-- permanently broken ticket forever. See LotteryService.autoRetryFailedTickets /
-- reconcileOrRetryFailedTicket.
ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0;
