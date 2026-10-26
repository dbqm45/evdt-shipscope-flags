import { BadRequestException } from "@nestjs/common";
import { ENVIRONMENTS, type Environment, type FlagType, type ReadMode } from "./shared/types.js";

// Parses and validates request bodies of the management API. Anything unexpected is a 400 with a reason the dashboard
// can show as is; unknown fields are rejected rather than ignored, so a typo does not silently do nothing.

/** Same characters the dashboard allows in a flag key (CreateFlagModal); service keys follow the same rule. */
const FLAG_KEY = /^[A-Za-z0-9._-]{1,100}$/;
const FLAG_TYPES: FlagType[] = ["release", "feature"];
const READ_MODES: ReadMode[] = ["build-time", "runtime", "both"];
const MAX_TEXT = 500;
const MAX_TAGS = 20;

export interface CreateFlagInput {
  key: string;
  description: string;
  type: FlagType;
  serviceIds: string[];
  dependsOn?: string;
  owner?: string;
  reviewBy?: string;
  tags: string[];
}

export interface RegisterServiceInput {
  key: string;
  name: string;
}

export interface FlagPatch {
  description?: string;
  /** null or "" clears it. */
  owner?: string | null;
  /** ISO date; null or "" clears it. */
  reviewBy?: string | null;
  tags?: string[];
}

export interface BindingPatch {
  readMode?: ReadMode;
  buildTimeValues?: Partial<Record<Environment, boolean>>;
  removedFromCode?: boolean;
}

const bad = (message: string) => new BadRequestException(message);

function object(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function onlyFields(body: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw bad(`Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
}

function text(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string") throw bad(`"${field}" must be a string.`);
  if (value.length > max) throw bad(`"${field}" is longer than ${max} characters.`);
  return value.trim();
}

/** An optional string where "" means "not set". */
const optionalText = (value: unknown, field: string) => (value === undefined ? undefined : text(value, field) || undefined);

function isoDate(value: unknown, field: string): string {
  const s = text(value, field, 40);
  if (Number.isNaN(Date.parse(s))) throw bad(`"${field}" must be a date (YYYY-MM-DD).`);
  return s;
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad('"tags" must be a list of strings.');
  if (value.length > MAX_TAGS) throw bad(`"tags" can hold at most ${MAX_TAGS} entries.`);
  return [...new Set(value.map((t) => text(t, "tags", 50)).filter(Boolean))];
}

/** Who made the change. Taken from the body until the API has authentication (docs/TODO.md, P0). */
export function parseActor(body: unknown): string {
  const actor = body && typeof body === "object" ? (body as Record<string, unknown>).actor : undefined;
  return actor === undefined ? "api" : text(actor, "actor", 100) || "api";
}

export function parseCreateFlag(input: unknown): CreateFlagInput {
  const body = object(input);
  onlyFields(body, ["key", "description", "type", "serviceIds", "dependsOn", "owner", "reviewBy", "tags", "actor"]);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!FLAG_KEY.test(key)) throw bad("Flag key is required: 1–100 letters, digits, dots, dashes or underscores.");
  const type = body.type;
  if (!FLAG_TYPES.includes(type as FlagType)) throw bad('"type" must be "release" or "feature".');
  const serviceIds = body.serviceIds === undefined ? [] : body.serviceIds;
  if (!Array.isArray(serviceIds) || !serviceIds.every((id) => typeof id === "string")) throw bad('"serviceIds" must be a list of service ids.');
  return {
    key,
    description: body.description === undefined ? "" : text(body.description, "description"),
    type: type as FlagType,
    serviceIds: [...new Set(serviceIds as string[])],
    dependsOn: optionalText(body.dependsOn, "dependsOn"),
    owner: optionalText(body.owner, "owner"),
    reviewBy: body.reviewBy === undefined || body.reviewBy === "" ? undefined : isoDate(body.reviewBy, "reviewBy"),
    tags: body.tags === undefined ? [] : tags(body.tags),
  };
}

export function parseFlagPatch(input: unknown): FlagPatch {
  const body = object(input);
  onlyFields(body, ["description", "owner", "reviewBy", "tags", "actor"]);
  const patch: FlagPatch = {};
  if (body.description !== undefined) patch.description = text(body.description, "description");
  if (body.owner !== undefined) patch.owner = body.owner === null ? null : text(body.owner, "owner") || null;
  if (body.reviewBy !== undefined) patch.reviewBy = body.reviewBy === null || body.reviewBy === "" ? null : isoDate(body.reviewBy, "reviewBy");
  if (body.tags !== undefined) patch.tags = tags(body.tags);
  if (Object.keys(patch).length === 0) throw bad("Nothing to change: send description, owner, reviewBy or tags.");
  return patch;
}

export function parseBindingPatch(input: unknown): BindingPatch {
  const body = object(input);
  onlyFields(body, ["readMode", "buildTimeValues", "removedFromCode", "actor"]);
  const patch: BindingPatch = {};
  if (body.readMode !== undefined) {
    if (!READ_MODES.includes(body.readMode as ReadMode)) throw bad(`"readMode" must be one of: ${READ_MODES.join(", ")}.`);
    patch.readMode = body.readMode as ReadMode;
  }
  if (body.buildTimeValues !== undefined) {
    const values = object(body.buildTimeValues);
    onlyFields(values, ENVIRONMENTS);
    if (!Object.values(values).every((v) => typeof v === "boolean")) throw bad('"buildTimeValues" must map test, qa and prod to true or false.');
    patch.buildTimeValues = values as Partial<Record<Environment, boolean>>;
  }
  if (body.removedFromCode !== undefined) {
    if (typeof body.removedFromCode !== "boolean") throw bad('"removedFromCode" must be true or false.');
    patch.removedFromCode = body.removedFromCode;
  }
  if (Object.keys(patch).length === 0) throw bad("Nothing to change: send readMode, buildTimeValues or removedFromCode.");
  return patch;
}

export function parseRegisterService(input: unknown): RegisterServiceInput {
  const body = object(input);
  onlyFields(body, ["key", "name", "actor"]);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!FLAG_KEY.test(key)) throw bad("Service key is required: 1–100 letters, digits, dots, dashes or underscores.");
  return { key, name: (body.name === undefined ? "" : text(body.name, "name", 100)) || key };
}

/** `revokePrevious`: end the replaced credential at once instead of after the grace period. */
export function parseRotateCredential(input: unknown): { revokePrevious: boolean } {
  const body = input === undefined ? {} : object(input);
  onlyFields(body, ["revokePrevious", "actor"]);
  if (body.revokePrevious !== undefined && typeof body.revokePrevious !== "boolean") throw bad('"revokePrevious" must be true or false.');
  return { revokePrevious: body.revokePrevious === true };
}

export function parseNotificationSettings(input: unknown): { enabled?: boolean; webhookUrl?: string } {
  const body = object(input);
  onlyFields(body, ["enabled", "webhookUrl"]);
  const settings: { enabled?: boolean; webhookUrl?: string } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw bad('"enabled" must be true or false.');
    settings.enabled = body.enabled;
  }
  if (body.webhookUrl !== undefined) settings.webhookUrl = text(body.webhookUrl, "webhookUrl", 2000);
  return settings;
}
