#!/usr/bin/env node
// Prepares a release on the current branch: computes the next SemVer version from Conventional Commits since
// the last tag vX.Y.Z, sets it in both package.json files and their lockfiles and adds an entry to CHANGELOG.md.
// It does not commit, tag or push: on main the Release workflow runs it with --ci after every push, commits
// "chore(release): X.Y.Z" and tags it (RELEASING.md). Run from the repository root.
//   npm run release                    # version from the commits
//   npm run release -- minor           # override: major | minor | patch | X.Y.Z (1.0.0 is always explicit)
//   npm run release -- --dry-run       # only print what would happen
//   npm run release -- --ci            # Release workflow on main: nothing to release is not an error, no hints
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { bump, bumpKind, changelogEntry, compareVersions, insertEntry, isVersion, nextVersion } from "./lib/conventional.mjs";

// One version for the whole application: the API and the frontend are released together.
const PACKAGE_FILES = ["package.json", "frontend/package.json"];
const LOCK_FILES = ["package-lock.json", "frontend/package-lock.json"];
const CHANGELOG = "CHANGELOG.md";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ci = args.includes("--ci");
const wanted = args.find((a) => !a.startsWith("--"));

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!dryRun && git("status", "--porcelain")) fail("the working tree has uncommitted changes — commit or stash them first");

const current = readJson("package.json").version;
const tags = git("tag", "--list", "v*")
  .split("\n")
  .map((t) => t.slice(1))
  .filter(isVersion)
  .sort(compareVersions);
const last = tags.at(-1);
if (!last) fail(`no tag vX.Y.Z yet — the first one (v${current}) is created on main by the Release workflow`);
if (last !== current) fail(`package.json has ${current}, the last tag is v${last} — release v${current} first`);

const log = git("log", "--format=%B%x00", `v${last}..HEAD`);
const messages = log
  .split("\0")
  .map((m) => m.trim())
  .filter(Boolean);
const kind = bumpKind(messages);

let version;
if (!wanted) {
  if (!kind && ci) {
    console.log(`No feat/fix/perf or breaking change since v${last} — nothing to release`);
    process.exit(0);
  }
  if (!kind) fail(`no feat/fix/perf or breaking change since v${last} — nothing to release (pass a version to force one)`);
  version = nextVersion(current, kind);
} else if (["major", "minor", "patch"].includes(wanted)) {
  version = bump(current, wanted); // explicit: `major` on 0.y.z gives 1.0.0
} else if (isVersion(wanted)) {
  version = wanted;
} else fail(`"${wanted}" is neither major/minor/patch nor X.Y.Z`);
if (compareVersions(version, current) <= 0) fail(`${version} is not newer than ${current}`);

const date = new Date().toISOString().slice(0, 10);
const entry = changelogEntry(version, date, messages);
console.log(`${messages.length} commit(s) since v${last}${kind ? ` call for a ${kind} change` : ""} → ${version}\n\n${entry}`);
if (dryRun) process.exit(0);

for (const file of PACKAGE_FILES) writeJson(file, { ...readJson(file), version });
for (const file of LOCK_FILES) {
  const lock = readJson(file);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeJson(file, lock);
}
writeFileSync(CHANGELOG, insertEntry(readFileSync(CHANGELOG, "utf8"), entry));

if (ci) {
  console.log(`✓ Version ${version} is set`);
  process.exit(0);
}
console.log(`
✓ Version ${version} is set. Next:
  1. Review CHANGELOG.md (reword entries for users if needed).
  2. git commit -am "chore(release): ${version}" and push it to main (or open a PR with that title).
  3. The Release workflow sees a version without a tag and releases v${version} as is.`);
