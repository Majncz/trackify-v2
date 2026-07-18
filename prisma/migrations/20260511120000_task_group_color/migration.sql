-- AlterTable (idempotent for envs that gained color via earlier schema push)
ALTER TABLE "trackify_task_group" ADD COLUMN IF NOT EXISTS "color" TEXT;
