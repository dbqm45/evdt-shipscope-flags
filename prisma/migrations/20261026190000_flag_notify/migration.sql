-- Per-flag notifications (PRD FR-016): a flag can be notified about on its own, without notifications for all flags.

-- AlterTable
ALTER TABLE "Flag" ADD COLUMN     "notify" BOOLEAN NOT NULL DEFAULT false;

