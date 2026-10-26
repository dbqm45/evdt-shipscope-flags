-- Per-service credentials (FR-003/005/011). Only hashes are stored. Services registered before this migration have
-- no credential until an Admin issues one ("Rotate credential"); until then they can only use the shared SDK_TOKEN.
-- credentialStatus is derived from previousTokenExpiresAt now, so its column and enum go.

-- AlterTable
ALTER TABLE "Service" DROP COLUMN "credentialStatus",
ADD COLUMN     "previousTokenExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "previousTokenHash" TEXT,
ADD COLUMN     "tokenHash" TEXT,
ALTER COLUMN "lastCheckInAt" DROP NOT NULL;

-- DropEnum
DROP TYPE "CredentialStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Service_tokenHash_key" ON "Service"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Service_previousTokenHash_key" ON "Service"("previousTokenHash");

