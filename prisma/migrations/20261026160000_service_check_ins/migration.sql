-- Check-ins per environment, so the drift rule can tell whether a service read an environment after a flag changed
-- there. The old check-in times had no environment and are dropped: services record new ones with their next read.
-- The static per-binding lastCheckInAt and driftSuspected (demo data only) are replaced by the computed rule.

-- AlterTable
ALTER TABLE "FlagServiceBinding" DROP COLUMN "driftSuspected",
DROP COLUMN "lastCheckInAt";

-- AlterTable
ALTER TABLE "Service" DROP COLUMN "lastCheckInAt";

-- CreateTable
CREATE TABLE "ServiceCheckIn" (
    "serviceId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceCheckIn_pkey" PRIMARY KEY ("serviceId","environment")
);

-- AddForeignKey
ALTER TABLE "ServiceCheckIn" ADD CONSTRAINT "ServiceCheckIn_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

