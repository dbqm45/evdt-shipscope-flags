-- Rule thresholds an Admin can change in Settings (PRD FR-006: the stale threshold). No row = the defaults.

-- CreateTable
CREATE TABLE "RuleSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "staleThresholdDays" INTEGER NOT NULL,

    CONSTRAINT "RuleSettings_pkey" PRIMARY KEY ("id")
);

