-- CreateTable
CREATE TABLE "instant_apps" (
    "id" TEXT NOT NULL,
    "wingetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "latestVersion" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUpdate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instant_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instant_apps_wingetId_key" ON "instant_apps"("wingetId");

-- CreateIndex
CREATE INDEX "instant_apps_name_idx" ON "instant_apps"("name");

-- CreateIndex
CREATE INDEX "instant_apps_publisher_idx" ON "instant_apps"("publisher");
