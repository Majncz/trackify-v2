-- CreateTable
CREATE TABLE "trackify_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "trackify_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trackify_task" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,

    CONSTRAINT "trackify_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trackify_event" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Time entry',
    "taskId" TEXT NOT NULL,

    CONSTRAINT "trackify_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trackify_user_email_key" ON "trackify_user"("email");

-- AddForeignKey
ALTER TABLE "trackify_task" ADD CONSTRAINT "trackify_task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackify_event" ADD CONSTRAINT "trackify_event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "trackify_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
