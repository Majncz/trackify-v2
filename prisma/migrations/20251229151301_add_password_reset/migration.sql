-- CreateTable
CREATE TABLE "trackify_password_reset" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trackify_password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trackify_password_reset_token_key" ON "trackify_password_reset"("token");

-- AddForeignKey
ALTER TABLE "trackify_password_reset" ADD CONSTRAINT "trackify_password_reset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trackify_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
