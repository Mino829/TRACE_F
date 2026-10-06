-- Phones that asked to be pinged. Kept only until they stop or the day ends.
CREATE TABLE subscriptions (
  key TEXT PRIMARY KEY,            -- sha256(endpoint), hex
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_id TEXT NOT NULL,         -- the anonymous id the page made, not a hardware id
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One row per answer to a ping (or a record taken by hand).
-- The columns are what an analysis reaches for first; `payload` is the whole
-- record as the phone sent it plus what the worker saw, so nothing the phone
-- measured is lost to the choice of columns.
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'ping' | 'manual'
  consent_version TEXT NOT NULL,
  prompted_at TEXT,
  taken_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  fix_count INTEGER NOT NULL,
  latitude REAL,                   -- the last fix before sending
  longitude REAL,
  accuracy REAL,
  altitude REAL,
  altitude_accuracy REAL,
  source_guess TEXT,               -- 'gnss' | 'wifi' | 'cell', guessed on the phone
  truth_latitude REAL,             -- where the person said they were standing
  truth_longitude REAL,
  truth_level INTEGER,
  truth_buildings TEXT,            -- comma-separated structure ids
  truth_confidence TEXT,
  error_m REAL,                    -- last fix to truth, metres
  photo_key TEXT,                  -- KV key of the photo, when one was attached
  connection_type TEXT,            -- navigator.connection.type (Android only)
  asn INTEGER,                     -- network the record arrived from
  as_organization TEXT,
  payload TEXT NOT NULL
);

CREATE INDEX records_device ON records (device_id);
CREATE INDEX records_taken ON records (taken_at);
