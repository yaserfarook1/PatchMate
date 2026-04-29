import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding AutoPack database...");

  // Default organisation
  await prisma.organisation.upsert({
    where: { id: "org_default" },
    update: {},
    create: { id: "org_default", name: "My Organisation" },
  });

  // Admin user — update role/name but keep id stable
  await prisma.user.upsert({
    where: { id: "user_admin_seed" },
    update: {},
    create: {
      id: "user_admin_seed",
      email: "admin@autopack.dev",
      name: "Admin",
      role: "Admin",
    },
  });

  console.log("✅ Seed complete — connect your Intune tenant to load real data.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
