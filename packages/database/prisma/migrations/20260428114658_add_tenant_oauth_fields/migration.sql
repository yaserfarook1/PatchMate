-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "azureTenantId" TEXT,
ADD COLUMN     "clientSecret" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);
