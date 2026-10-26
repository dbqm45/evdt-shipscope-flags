// Loads flags, services, the audit log and notification settings into the database, from the demo seed data or
// from a JSON state file written by versions before 0.2.0 (FLAGS_DATA_FILE, default data/state.json).
// Run after `npm run build` and `npm run db:deploy`:
//   node dist/db/load-state.js --seed [--if-empty]          # demo data (npm run db:seed adds --if-empty)
//   node dist/db/load-state.js --file data/state.json       # import an old state file (npm run db:import -- <file>)
// Without --if-empty it refuses to touch a database that already holds flags or services.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "../generated/prisma/client.js";
import { toDbReadMode } from "../flags/flag-mapper.js";
import { auditLog as seedAudit, flags as seedFlags, services as seedServices } from "../flags/shared/seed.js";
import { ENVIRONMENTS, type AuditLogEntry, type Environment, type Flag, type NotificationSettings, type Service } from "../flags/shared/types.js";
import { prismaOptions } from "../prisma/prisma.service.js";

export interface State {
  flags: Flag[];
  services: Service[];
  auditLog: AuditLogEntry[];
  notifications?: NotificationSettings;
}

export const seedState = (): State => ({ flags: seedFlags, services: seedServices, auditLog: seedAudit });

/** Writes `state` into an empty database in one transaction. Returns false (and writes nothing) when it is not empty. */
export async function loadState(prisma: PrismaClient, state: State): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.flag.count()) + (await tx.service.count()) > 0) return false;

    // Sequence columns keep the order of the arrays: services ascending, flags and audit entries newest first.
    // Credentials are never part of a state file: services get theirs from an Admin ("Rotate credential").
    for (const s of state.services)
      await tx.service.create({
        data: {
          id: s.id,
          key: s.key,
          name: s.name,
          registeredAt: s.registeredAt,
          registeredBy: s.registeredBy,
          credentialLastRotated: s.credentialLastRotated,
          // State files from before 0.5 have no per-environment check-ins.
          checkIns: { create: Object.entries(s.checkIns ?? {}).map(([environment, at]) => ({ environment: environment as Environment, at })) },
        },
      });
    for (const f of [...state.flags].reverse()) {
      await tx.flag.create({
        data: {
          id: f.id,
          key: f.key,
          description: f.description,
          type: f.type,
          createdAt: f.createdAt,
          createdBy: f.createdBy,
          dependsOn: f.dependsOn ?? null,
          owner: f.owner ?? null,
          reviewBy: f.reviewBy ?? null,
          tags: f.tags ?? [],
          environments: { create: ENVIRONMENTS.map((environment) => ({ environment, ...f.environments[environment] })) },
          services: {
            create: f.services.map((b, position) => ({
              serviceId: b.serviceId,
              position,
              readMode: toDbReadMode(b.readMode),
              buildTimeValues: b.buildTimeValues ?? undefined,
              removedFromCode: b.removedFromCode ?? null,
            })),
          },
        },
      });
    }
    await tx.auditLogEntry.createMany({ data: [...state.auditLog].reverse() });
    if (state.notifications) await tx.notificationSettings.create({ data: { id: 1, ...state.notifications } });
    return true;
  });
}

async function main(args: string[]): Promise<void> {
  const fileAt = args.indexOf("--file");
  const file = fileAt >= 0 ? args[fileAt + 1] : undefined;
  if (!args.includes("--seed") && !file) throw new Error("Pass --seed or --file <path>.");
  const state: State = file ? (JSON.parse(readFileSync(file, "utf8")) as State) : seedState();

  const prisma = new PrismaClient(prismaOptions());
  try {
    const loaded = await loadState(prisma, state);
    const what = file ?? "the demo seed data";
    if (loaded) console.log(`✓ Loaded ${state.flags.length} flags, ${state.services.length} services and ${state.auditLog.length} audit entries from ${what}`);
    else if (args.includes("--if-empty")) console.log(`The database already holds data — ${what} not loaded`);
    else throw new Error(`The database already holds flags or services — refusing to load ${what} on top of them.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err: Error) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
