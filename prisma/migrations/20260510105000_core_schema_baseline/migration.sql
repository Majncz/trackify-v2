-- Bring master-era DBs (init + password_reset + event from/to only, plus any
-- historical db-push drift) up to the core schema expected by the app before
-- billing / groups / AI subscription migrations run.
-- Fully idempotent: safe if Conversation / timers / Task timestamps already exist.

-- Task timestamps (present in schema for a long time; often applied via db push)
ALTER TABLE "trackify_task" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "trackify_task" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "trackify_task_userId_hidden_idx"
  ON "trackify_task"("userId", "hidden");

-- Conversations / chat
CREATE TABLE IF NOT EXISTS "trackify_conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trackify_conversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trackify_conversation_userId_updatedAt_idx"
  ON "trackify_conversation"("userId", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trackify_conversation_userId_fkey'
  ) THEN
    ALTER TABLE "trackify_conversation"
      ADD CONSTRAINT "trackify_conversation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "trackify_user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "trackify_chat_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trackify_chat_message_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trackify_chat_message_conversationId_fkey'
  ) THEN
    ALTER TABLE "trackify_chat_message"
      ADD CONSTRAINT "trackify_chat_message_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "trackify_conversation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Active timer
CREATE TABLE IF NOT EXISTS "trackify_active_timer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trackify_active_timer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trackify_active_timer_userId_key"
  ON "trackify_active_timer"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trackify_active_timer_userId_fkey'
  ) THEN
    ALTER TABLE "trackify_active_timer"
      ADD CONSTRAINT "trackify_active_timer_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "trackify_user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trackify_active_timer_taskId_fkey'
  ) THEN
    ALTER TABLE "trackify_active_timer"
      ADD CONSTRAINT "trackify_active_timer_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "trackify_task"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- API tokens
CREATE TABLE IF NOT EXISTS "trackify_api_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Mobile App',
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "trackify_api_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trackify_api_token_token_key"
  ON "trackify_api_token"("token");

CREATE INDEX IF NOT EXISTS "trackify_api_token_token_idx"
  ON "trackify_api_token"("token");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trackify_api_token_userId_fkey'
  ) THEN
    ALTER TABLE "trackify_api_token"
      ADD CONSTRAINT "trackify_api_token_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "trackify_user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
