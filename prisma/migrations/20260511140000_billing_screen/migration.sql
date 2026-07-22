-- CreateTable
CREATE TABLE "trackify_billing_task" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "roundingMins" INTEGER NOT NULL DEFAULT 0,
    "minSessionMins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trackify_billing_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trackify_payment_record" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trackify_payment_record_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "trackify_event" ADD COLUMN "paymentRecordId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "trackify_billing_task_taskId_key" ON "trackify_billing_task"("taskId");

-- CreateIndex
CREATE INDEX "trackify_billing_task_userId_idx" ON "trackify_billing_task"("userId");

-- CreateIndex
CREATE INDEX "trackify_payment_record_userId_paidAt_idx" ON "trackify_payment_record"("userId", "paidAt");

-- CreateIndex
CREATE INDEX "trackify_event_paymentRecordId_idx" ON "trackify_event"("paymentRecordId");

-- AddForeignKey
ALTER TABLE "trackify_billing_task" ADD CONSTRAINT "trackify_billing_task_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "trackify_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackify_billing_task" ADD CONSTRAINT "trackify_billing_task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackify_payment_record" ADD CONSTRAINT "trackify_payment_record_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackify_event" ADD CONSTRAINT "trackify_event_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "trackify_payment_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;
