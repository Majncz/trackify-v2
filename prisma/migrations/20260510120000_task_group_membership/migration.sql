-- Add nullable group link on tasks (FK added after backfill)
ALTER TABLE "trackify_task" ADD COLUMN "taskGroupId" TEXT;

-- One task can belong to at most one group: if legacy JSON listed a task in multiple groups,
-- keep the earliest group by createdAt.
WITH expanded AS (
  SELECT
    tg.id AS group_id,
    jsonb_array_elements_text(tg."taskIds"::jsonb) AS task_id,
    tg."createdAt"
  FROM "trackify_task_group" tg
  WHERE tg."taskIds" IS NOT NULL AND tg."taskIds" <> '' AND tg."taskIds" <> '[]'
),
first_group AS (
  SELECT DISTINCT ON (task_id) group_id, task_id
  FROM expanded
  ORDER BY task_id, "createdAt" ASC
)
UPDATE "trackify_task" t
SET "taskGroupId" = fg.group_id
FROM first_group fg
WHERE t.id = fg.task_id;

-- Drop legacy JSON column on groups
ALTER TABLE "trackify_task_group" DROP COLUMN "taskIds";

CREATE INDEX "trackify_task_taskGroupId_idx" ON "trackify_task"("taskGroupId");

ALTER TABLE "trackify_task" ADD CONSTRAINT "trackify_task_taskGroupId_fkey"
  FOREIGN KEY ("taskGroupId") REFERENCES "trackify_task_group"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
