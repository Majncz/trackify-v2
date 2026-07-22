-- Email/account label for AI billing entries
ALTER TABLE "trackify_ai_subscription_period"
ADD COLUMN "billingEmail" TEXT;
