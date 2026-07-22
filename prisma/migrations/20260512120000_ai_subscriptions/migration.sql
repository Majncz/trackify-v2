-- AI subscription tracking + optional effectiveness target on user

ALTER TABLE "trackify_user" ADD COLUMN "aiTargetHoursPer100Czk" DOUBLE PRECISION;

CREATE TABLE "trackify_ai_subscription_preset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerKey" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trackify_ai_subscription_preset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trackify_ai_subscription_period" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetId" TEXT,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trackify_ai_subscription_period_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trackify_task_ai_subscription" (
    "taskId" TEXT NOT NULL,
    "aiSubscriptionPeriodId" TEXT NOT NULL,

    CONSTRAINT "trackify_task_ai_subscription_pkey" PRIMARY KEY ("taskId","aiSubscriptionPeriodId")
);

CREATE INDEX "trackify_ai_subscription_preset_userId_sortOrder_idx" ON "trackify_ai_subscription_preset"("userId", "sortOrder");

CREATE INDEX "trackify_ai_subscription_period_userId_startsAt_idx" ON "trackify_ai_subscription_period"("userId", "startsAt");

CREATE INDEX "trackify_ai_subscription_period_userId_endsAt_idx" ON "trackify_ai_subscription_period"("userId", "endsAt");

CREATE INDEX "trackify_task_ai_subscription_aiSubscriptionPeriodId_idx" ON "trackify_task_ai_subscription"("aiSubscriptionPeriodId");

ALTER TABLE "trackify_ai_subscription_preset" ADD CONSTRAINT "trackify_ai_subscription_preset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trackify_ai_subscription_period" ADD CONSTRAINT "trackify_ai_subscription_period_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trackify_ai_subscription_period" ADD CONSTRAINT "trackify_ai_subscription_period_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "trackify_ai_subscription_preset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trackify_task_ai_subscription" ADD CONSTRAINT "trackify_task_ai_subscription_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "trackify_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trackify_task_ai_subscription" ADD CONSTRAINT "trackify_task_ai_subscription_aiSubscriptionPeriodId_fkey" FOREIGN KEY ("aiSubscriptionPeriodId") REFERENCES "trackify_ai_subscription_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;
