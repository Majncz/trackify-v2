-- Rename createdAt to from
ALTER TABLE trackify_event RENAME COLUMN "createdAt" TO "from";

-- Add new to column (initially nullable)
ALTER TABLE trackify_event ADD COLUMN "to" TIMESTAMP(3);

-- Populate to from existing data: to = from + duration
UPDATE trackify_event SET "to" = "from" + (duration * INTERVAL '1 millisecond');

-- Make to NOT NULL
ALTER TABLE trackify_event ALTER COLUMN "to" SET NOT NULL;

-- Drop duration column
ALTER TABLE trackify_event DROP COLUMN duration;

-- Update index name to reflect new column name
DROP INDEX IF EXISTS trackify_event_taskId_createdAt_idx;
CREATE INDEX trackify_event_taskId_from_idx ON trackify_event("taskId", "from");
