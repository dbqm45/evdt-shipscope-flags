-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('release', 'feature');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('test', 'qa', 'prod');

-- CreateEnum
CREATE TYPE "ReadMode" AS ENUM ('build-time', 'runtime', 'both');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('active', 'rotating');

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registeredAt" TIMESTAMPTZ(3) NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "credentialStatus" "CredentialStatus" NOT NULL,
    "credentialLastRotated" TIMESTAMPTZ(3) NOT NULL,
    "lastCheckInAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "FlagType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "dependsOn" TEXT,
    "owner" TEXT,
    "reviewBy" TIMESTAMPTZ(3),
    "tags" TEXT[],

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagEnvironment" (
    "flagId" TEXT NOT NULL,
    "environment" "Environment" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "FlagEnvironment_pkey" PRIMARY KEY ("flagId","environment")
);

-- CreateTable
CREATE TABLE "FlagServiceBinding" (
    "flagId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "readMode" "ReadMode" NOT NULL,
    "lastCheckInAt" TIMESTAMPTZ(3) NOT NULL,
    "driftSuspected" BOOLEAN NOT NULL,
    "buildTimeValues" JSONB,
    "removedFromCode" BOOLEAN,

    CONSTRAINT "FlagServiceBinding_pkey" PRIMARY KEY ("flagId","serviceId")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "flagKey" TEXT,
    "serviceKey" TEXT,
    "environment" "Environment",
    "from" TEXT,
    "to" TEXT,
    "note" TEXT,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL,
    "webhookUrl" TEXT NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_seq_key" ON "Service"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Service_key_key" ON "Service"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_seq_key" ON "Flag"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_key_key" ON "Flag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLogEntry_seq_key" ON "AuditLogEntry"("seq");

-- CreateIndex
CREATE INDEX "AuditLogEntry_timestamp_idx" ON "AuditLogEntry"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLogEntry_flagKey_idx" ON "AuditLogEntry"("flagKey");

-- AddForeignKey
ALTER TABLE "FlagEnvironment" ADD CONSTRAINT "FlagEnvironment_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "Flag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagServiceBinding" ADD CONSTRAINT "FlagServiceBinding_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "Flag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagServiceBinding" ADD CONSTRAINT "FlagServiceBinding_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
