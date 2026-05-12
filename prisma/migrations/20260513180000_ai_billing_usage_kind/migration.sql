-- Token/credit depletion + recurring monthly billing mode for AI billing entries
ALTER TABLE "trackify_ai_subscription_period"
ADD COLUMN "depletedAt" TIMESTAMP(3),
ADD COLUMN "billingKind" TEXT NOT NULL DEFAULT 'purchase';
