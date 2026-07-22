-- AlterTable
ALTER TABLE "trackify_event" ADD COLUMN "paidAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "trackify_billing_task" DROP COLUMN "minSessionMins";
