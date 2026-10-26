import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Runs the release scripts against throwaway git repos shaped like this repository's release surface.
// Ported from dbqm45/evdt-service-shipscope's test/release.test.js.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(ROOT, "scripts", "release.mjs");
const NOTES = join(ROOT, "scripts", "release-notes.mjs");
const CHECK = join(ROOT, "scripts", "check-commit-message.mjs");

const CHANGELOG = "# Changelog\n\nIntro.\n\n## [0.1.0] - 2026-10-16\n\n- First.\n";

let TMP;
let seq = 0;

/** A throwaway git repo shaped like the workspace (three package.json files, one lockfile), tagged v0.1.0, plus the given commits. */
function makeRepo(commits) {
  const dir = join(TMP, `repo-${seq++}`);
  mkdirSync(join(dir, "frontend"), { recursive: true });
  mkdirSync(join(dir, "packages", "shared"), { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  const write = (file, value) => writeFileSync(join(dir, file), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  write("package.json", { name: "api", version: "0.1.0", private: true, workspaces: ["packages/shared", "frontend"] });
  write("frontend/package.json", { name: "web", version: "0.1.0", private: true });
  write("packages/shared/package.json", { name: "@x/shared", version: "0.1.0", private: true });
  write("package-lock.json", {
    name: "api",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "api", version: "0.1.0" },
      frontend: { name: "web", version: "0.1.0" },
      "packages/shared": { name: "@x/shared", version: "0.1.0" },
      "node_modules/web": { resolved: "frontend", link: true },
    },
  });
  write("CHANGELOG.md", CHANGELOG);
  git("add", "-A");
  git("commit", "-qm", "chore(release): 0.1.0");
  git("tag", "-a", "v0.1.0", "-m", "Release 0.1.0");
  for (const message of commits) git("commit", "-q", "--allow-empty", "-m", message);
  return {
    dir,
    git,
    read: (file) => readFileSync(join(dir, file), "utf8"),
    json: (file) => JSON.parse(readFileSync(join(dir, file), "utf8")),
  };
}

const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

before(() => {
  TMP = mkdtempSync(join(tmpdir(), "shipscope-flags-release-"));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

describe("release.mjs", () => {
  it("REL-CI-1: a feat after v0.1.0 sets 0.1.1 in every package and the lockfile and adds the changelog entry on top", () => {
    const repo = makeRepo(["feat(SHPFL): retire a flag from the API (#8)", "fix(api): reject empty keys", "docs: readme"]);
    const res = run(RELEASE, ["--ci"], repo.dir);
    assert.equal(res.status, 0, res.stderr);

    for (const pkg of ["package.json", "frontend/package.json", "packages/shared/package.json"]) assert.equal(repo.json(pkg).version, "0.1.1", pkg);
    const lock = repo.json("package-lock.json");
    assert.equal(lock.version, "0.1.1");
    for (const dir of ["", "frontend", "packages/shared"]) assert.equal(lock.packages[dir].version, "0.1.1", dir);
    assert.deepEqual(lock.packages["node_modules/web"], { resolved: "frontend", link: true });

    const changelog = repo.read("CHANGELOG.md");
    assert.match(
      changelog,
      /^# Changelog\n\nIntro\.\n\n## \[0\.1\.1\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- \*\*SHPFL:\*\* retire a flag from the API \(#8\)\n\n### Fixed\n\n- \*\*api:\*\* reject empty keys\n\n## \[0\.1\.0\]/,
    );
    assert.ok(changelog.endsWith("## [0.1.0] - 2026-10-16\n\n- First.\n"), "older entries untouched");
  });

  it("REL-CI-2: only docs/test/ci commits release nothing and change nothing", () => {
    const repo = makeRepo(["docs: readme", "ci: workflow", "test: more"]);
    const res = run(RELEASE, ["--ci"], repo.dir);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /nothing to release/);
    assert.equal(repo.git("status", "--porcelain"), "");
  });

  it("REL-CI-3: a breaking change in 0.y.z bumps the minor", () => {
    const repo = makeRepo(["feat(api)!: require a token for /api/sdk/flags"]);
    assert.equal(run(RELEASE, ["--ci"], repo.dir).status, 0);
    assert.equal(repo.json("package.json").version, "0.2.0");
    assert.match(repo.read("CHANGELOG.md"), /### Breaking\n\n- \*\*api:\*\* require a token/);
  });

  it("REL-MAN-1: an explicit version overrides the commits; --dry-run writes nothing", () => {
    const repo = makeRepo(["fix: a"]);
    const dry = run(RELEASE, ["1.0.0", "--dry-run"], repo.dir);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /→ 1\.0\.0/);
    assert.equal(repo.git("status", "--porcelain"), "");

    assert.equal(run(RELEASE, ["1.0.0"], repo.dir).status, 0);
    assert.equal(repo.json("frontend/package.json").version, "1.0.0");
  });

  it("REL-ERR-1: refuses a dirty tree, an untagged package.json version, and an older version", () => {
    const dirty = makeRepo(["fix: a"]);
    writeFileSync(join(dirty.dir, "x.txt"), "x");
    assert.match(run(RELEASE, ["--ci"], dirty.dir).stderr, /uncommitted changes/);

    const untagged = makeRepo([]);
    writeFileSync(join(untagged.dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
    untagged.git("commit", "-qam", "chore(release): 0.2.0");
    assert.match(run(RELEASE, ["--ci"], untagged.dir).stderr, /release v0\.2\.0 first/);

    const older = makeRepo(["fix: a"]);
    assert.match(run(RELEASE, ["0.0.9"], older.dir).stderr, /not newer/);
  });
});

describe("release-notes.mjs and check-commit-message.mjs", () => {
  it("NOTES-1: prints one version's entry, fails without one", () => {
    const repo = makeRepo([]);
    const ok = run(NOTES, ["0.1.0"], repo.dir);
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, "- First.\n");
    assert.equal(run(NOTES, ["0.9.0"], repo.dir).status, 1);
    assert.equal(run(NOTES, ["latest"], repo.dir).status, 1);
  });

  it("CHECK-1: accepts a Conventional Commit title and rejects a plain one, also from a file (commit-msg hook)", () => {
    assert.equal(run(CHECK, ["feat(SHPFL): retire a flag from the API"], ROOT).status, 0);
    const bad = run(CHECK, ["Update flags"], ROOT);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Not a Conventional Commit/);

    const file = join(TMP, "COMMIT_EDITMSG");
    writeFileSync(file, "fix: a.\n# comment\n");
    assert.match(run(CHECK, ["--file", file], ROOT).stderr, /period/);
  });
});

describe("repository version", () => {
  it("VER-1: every package.json of the workspace and the lockfile carry the same X.Y.Z, and CHANGELOG.md has its entry", () => {
    const read = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
    const { version } = read("package.json");
    assert.match(version, /^\d+\.\d+\.\d+$/);
    for (const pkg of ["frontend/package.json", "packages/shared/package.json"]) assert.equal(read(pkg).version, version, pkg);
    const lock = read("package-lock.json");
    assert.equal(lock.version, version);
    for (const dir of ["", "frontend", "packages/shared"]) assert.equal(lock.packages[dir].version, version, dir);
    assert.ok(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").includes(`## [${version}]`), `CHANGELOG.md has ## [${version}]`);
  });
});
