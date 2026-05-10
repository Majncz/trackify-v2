-- Default new billing rows to Czech crowns (existing rows unchanged).
ALTER TABLE "trackify_billing_task" ALTER COLUMN "currency" SET DEFAULT 'CZK';
ALTER TABLE "trackify_payment_record" ALTER COLUMN "currency" SET DEFAULT 'CZK';
