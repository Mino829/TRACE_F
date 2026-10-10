-- How the truth was marked: 'campus-plan' (the Toyosu drawings) or 'map' (a street map, anywhere).
-- truth_confidence from 0001 is no longer filled: people are no longer asked how sure they were;
-- the zoom they marked at (in payload) stands in for it.
ALTER TABLE records ADD COLUMN truth_method TEXT;
