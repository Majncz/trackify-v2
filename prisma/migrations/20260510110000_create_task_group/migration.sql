-- Create task groups (historically applied via schema/db push without a migration).
-- Safe for fresh master-era DBs and for DBs that already have this table.
CREATE TABLE IF NOT EXISTS "trackify_task_group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskIds" TEXT NOT NULL DEFAULT '[]',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trackify_task_group_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trackify_task_group_userId_idx"
  ON "trackify_task_group"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trackify_task_group_userId_fkey'
  ) THEN
    ALTER TABLE "trackify_task_group"
      ADD CONSTRAINT "trackify_task_group_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "trackify_user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
