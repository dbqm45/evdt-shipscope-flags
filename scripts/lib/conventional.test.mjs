import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bump, bumpKind, changelogEntry, compareVersions, insertEntry, lintMessage, nextVersion, releaseNotes } from "./conventional.mjs";

// Expected values come from Conventional Commits 1.0.0 and SemVer 2.0.0 (RELEASING.md). Ported from
// dbqm45/evdt-service-shipscope's test/conventional.test.js.

describe("CC: lintMessage", () => {
  for (const ok of [
    "feat(frontend): zoom the flag matrix",
    "fix: reject an unknown environment",
    "feat(api)!: drop the legacy settings format",
    "build(deps-dev): Bump vitest from 5.0.3 to 5.1.0",
    "ci(deps): bump the actions group with 6 updates (#13)",
    "chore(release): 0.2.0",
    "fix(api): handle a missing state file\n\nThe file is created on first write.\n\nRefs: #20",
    "refactor(core): rename read mode\n\nBREAKING CHANGE: Binding.mode removed; read readMode",
    "Merge branch 'main' into feature",
    "fixup! feat(frontend): zoom",
    "# Please enter the commit message\nfeat(frontend): zoom the matrix\n# Lines starting with # are ignored",
    // The project key as an uppercase scope, as in the existing history.
    "feat(SHPFL): Initial commit",
  ])
    it(`CC-OK: ${JSON.stringify(ok.split("\n")[0])}`, () => assert.deepEqual(lintMessage(ok), []));

  for (const [bad, why] of [
    ["Czytelniejsza tabela flag", /not "<type>/],
    ["feature(frontend): zoom", /unknown type "feature"/],
    ["Feat(frontend): zoom", /not "<type>/],
    ["feat(my scope): zoom", /scope "my scope"/],
    ["feat(-x): zoom", /scope "-x"/],
    ["feat(frontend):zoom", /not "<type>/],
    // The trailing space is trimmed, so this is reported as a malformed header, not an empty description.
    ["feat(frontend): ", /not "<type>/],
    ["fix: add the thing.", /period/],
    [`feat: ${"x".repeat(73)}`, /73 characters/],
    ["fix: a\nbody without a blank line", /empty line/],
    ["fix: a\n\nbreaking change: lowercase footer", /uppercase/],
    ["", /empty/],
  ])
    it(`CC-BAD: ${JSON.stringify(bad)}`, () => assert.match(lintMessage(bad).join("\n"), why));

  it('CC-LEN: 72 characters is the limit and the "(#NN)" GitHub adds does not count', () => {
    assert.deepEqual(lintMessage(`feat: ${"x".repeat(72)} (#123)`), []);
  });
});

describe("SV: bump and next version", () => {
  it("SV-01: bumpKind takes the most serious change", () => {
    assert.equal(bumpKind(["docs: readme", "test: more"]), null);
    assert.equal(bumpKind(["fix: a", "perf: b"]), "patch");
    assert.equal(bumpKind(["fix: a", "feat: b", "chore: c"]), "minor");
    assert.equal(bumpKind(["feat: b", "fix(x)!: a"]), "major");
    assert.equal(bumpKind(["refactor: a\n\nBREAKING CHANGE: gone"]), "major");
    assert.equal(bumpKind(["refactor: a\n\nBREAKING-CHANGE: gone"]), "major");
  });

  it("SV-02: plain bumps reset the lower parts (rules 7, 8)", () => {
    assert.equal(bump("1.4.2", "major"), "2.0.0");
    assert.equal(bump("1.4.2", "minor"), "1.5.0");
    assert.equal(bump("1.4.2", "patch"), "1.4.3");
    assert.equal(bump("0.9.3", "major"), "1.0.0");
    assert.throws(() => bump("1.0.0-rc.1", "patch"));
  });

  it("SV-03: from 1.0.0 the commits map straight onto the version", () => {
    assert.equal(nextVersion("1.4.2", "major"), "2.0.0");
    assert.equal(nextVersion("1.4.2", "minor"), "1.5.0");
    assert.equal(nextVersion("1.4.2", "patch"), "1.4.3");
  });

  it("SV-04: in 0.y.z a breaking change bumps the minor, everything else the patch (rule 4)", () => {
    assert.equal(nextVersion("0.1.0", "major"), "0.2.0");
    assert.equal(nextVersion("0.1.0", "minor"), "0.1.1");
    assert.equal(nextVersion("0.1.0", "patch"), "0.1.1");
  });

  it("SV-05: versions compare numerically, not as text", () => {
    assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
    assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  });
});

describe("CL: changelogEntry", () => {
  it("CL-01: groups user-visible commits into sections and skips the rest", () => {
    const commits = [
      "feat(frontend): zoom the flag matrix (#21)",
      "fix(api): reject an unknown environment (#20)",
      "feat(api)!: drop the legacy settings format",
      "docs: readme",
      "Czytelniejsza tabela",
    ];
    assert.equal(
      changelogEntry("0.2.0", "2026-10-06", commits),
      [
        "## [0.2.0] - 2026-10-06",
        "",
        "### Breaking",
        "",
        "- **api:** drop the legacy settings format",
        "",
        "### Added",
        "",
        "- **frontend:** zoom the flag matrix (#21)",
        "",
        "### Fixed",
        "",
        "- **api:** reject an unknown environment (#20)",
        "",
      ].join("\n"),
    );
  });

  it("CL-02: an entry without user-visible changes says so", () => {
    assert.match(changelogEntry("0.1.1", "2026-10-06", ["ci: x"]), /No user-visible changes/);
  });
});

describe("IN: insertEntry", () => {
  const entry = "## [0.2.0] - 2026-10-20\n\n### Added\n\n- x\n";

  it("IN-1: goes above the previous version", () => {
    assert.equal(
      insertEntry("# C\n\nIntro.\n\n## [0.1.0] - 2026-10-16\n\n- a\n", entry),
      "# C\n\nIntro.\n\n## [0.2.0] - 2026-10-20\n\n### Added\n\n- x\n\n## [0.1.0] - 2026-10-16\n\n- a\n",
    );
  });

  it("IN-2: a changelog without entries gets it appended", () => {
    assert.equal(insertEntry("# Changelog\n", entry), `# Changelog\n\n${entry}`);
  });
});

describe("REL: releaseNotes", () => {
  const changelog = [
    "# Changelog",
    "",
    "Intro.",
    "",
    "## [0.2.0] - 2026-10-10",
    "",
    "### Added",
    "",
    "- **frontend:** zoom",
    "",
    "## [0.1.0] - 2026-10-06",
    "",
    "First version.",
    "",
    "### Added",
    "",
    "- MVP",
    "",
    "[0.2.0]: https://example.test/v0.2.0",
  ].join("\n");

  it("REL-1: the newest entry stops before the next heading", () => assert.equal(releaseNotes(changelog, "0.2.0"), "### Added\n\n- **frontend:** zoom"));
  it("REL-2: the last entry leaves out link definitions", () => assert.equal(releaseNotes(changelog, "0.1.0"), "First version.\n\n### Added\n\n- MVP"));
  it("REL-3: a missing version gives null", () => assert.equal(releaseNotes(changelog, "0.3.0"), null));
  it("REL-4: a prefix of another version does not match", () => assert.equal(releaseNotes(changelog, "0.2"), null));
  it("REL-5: CRLF line endings", () => assert.equal(releaseNotes(changelog.replace(/\n/g, "\r\n"), "0.2.0"), "### Added\n\n- **frontend:** zoom"));
});
