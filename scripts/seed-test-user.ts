/**
 * Creates or resets a minimal dev login (short email + password).
 * Login form requires a valid email → use a@a.com, password A.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

const EMAIL = "a@a.com";
const PASSWORD = "A";

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, password: hashed },
    update: { password: hashed },
  });
  console.log(`Test user ready → email: ${EMAIL}  password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
