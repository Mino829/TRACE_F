-- What each subscription is for and how often it is pinged:
-- 'accuracy' (the team's accuracy run, every 10 minutes) or
-- 'photo' (a participant's photo reminder, every 15 or 30 minutes).
-- Every subscription made before this was the 10-minute accuracy ping.
ALTER TABLE subscriptions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'accuracy';
ALTER TABLE subscriptions ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 10;
