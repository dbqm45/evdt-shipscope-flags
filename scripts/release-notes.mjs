#!/usr/bin/env node
// Prints the release notes of a version: its CHANGELOG.md entry, used as the GitHub Release body (RELEASING.md).
//   node scripts/release-notes.mjs 0.2.0 > notes.md
import { readFileSync } from "node:fs";
import { isVersion, releaseNotes } from "./lib/conventional.mjs";

const version = process.argv[2] ?? "";
if (!isVersion(version)) {
  console.error(`✗ "${version}" is not X.Y.Z`);
  process.exit(1);
}
const notes = releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version);
if (!notes) {
  console.error(`✗ CHANGELOG.md has no entry "## [${version}]"`);
  process.exit(1);
}
console.log(notes);
