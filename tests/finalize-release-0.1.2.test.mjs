import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, driver] = await Promise.all([
  readFile(new URL("../.github/workflows/finalize-release-0.1.2.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/scripts/finalize_release_0_1_2.py", import.meta.url), "utf8"),
]);

test("finalizer uses the proven exact same-repository PR event", () => {
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:\s*$/m);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-55-retire-release-helpers'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.pull_request\.title == '\[#55\] Retire temporary release helpers after 0\.1\.2'/);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/);
});

test("finalizer has branch-scoped concurrency and uses the reviewed ARC lane", () => {
  assert.match(
    workflow,
    /group: agent-state-dashboard-finalize-release-0\.1\.2-\$\{\{ github\.event\.pull_request\.head\.ref \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /runs-on: \[linux, amd64, general, tiny\]/);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test("maintenance authority is exposed only to the bounded tag step", () => {
  assert.equal((workflow.match(/secrets\.ORGANIZATION_MAINTENANCE_TOKEN/g) ?? []).length, 1);
  assert.match(workflow, /MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/);
  assert.match(workflow, /finalize_release_0_1_2\.py tag/);
  assert.doesNotMatch(workflow, /FORGEJO_REGISTRY_(?:USERNAME|TOKEN)/);
  assert.match(driver, /api_request\(\s*token,\s*"POST",\s*"\/git\/refs"/);
  assert.match(driver, /"ref": f"refs\/tags\/\{RELEASE_TAG\}"/);
  assert.match(driver, /tag_readback_mismatch/);
});

test("driver binds the corrected immutable release identity", () => {
  assert.match(driver, /RELEASE_TAG = "0\.1\.2"/);
  assert.match(driver, /RELEASE_SOURCE_SHA = "3187db893f5629d8703897a83245df46b62b6f7d"/);
  assert.match(driver, /release_package_version_mismatch/);
  assert.match(driver, /release_chart_version_mismatch/);
  assert.match(driver, /release_chart_app_version_mismatch/);
  assert.match(driver, /release_source_not_ancestor/);
  assert.match(driver, /release_source_merge_base_mismatch/);
});

test("phase-1 admission is deletion-only and retains the finalizer", () => {
  for (const path of [
    ".github/workflows/cut-release-0.1.1-arc.yml",
    ".github/workflows/cut-release-0.1.1-pr.yml",
    ".github/workflows/cut-release-0.1.1-tag.yml",
    ".github/workflows/release-existing-tag-0.1.1.yml",
    ".github/workflows/cut-release-0.1.2.yml",
    "tests/release-tag-cut.test.mjs",
    "tests/release-0.1.2-cut.test.mjs",
  ]) {
    assert.match(driver, new RegExp(path.replaceAll(".", "\\.")));
  }
  assert.match(driver, /assert_deleted_file_set\(token, pr_number, PHASE1_FILES, "phase1"\)/);
  assert.match(driver, /phase1_requires_deletions_only/);
  assert.doesNotMatch(driver.match(/PHASE1_FILES = \{[\s\S]*?\n\}/)?.[0] ?? "", /finalize-release-0\.1\.2/);
});

test("phase-2 removes exactly the finalizer workflow script and contract test", () => {
  const phase2 = driver.match(/PHASE2_FILES = \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(phase2, /\.github\/workflows\/finalize-release-0\.1\.2\.yml/);
  assert.match(phase2, /\.github\/scripts\/finalize_release_0_1_2\.py/);
  assert.match(phase2, /tests\/finalize-release-0\.1\.2\.test\.mjs/);
  assert.equal((phase2.match(/"[^\n]+"/g) ?? []).length, 3);
  assert.match(driver, /assert_deleted_file_set\(token, number, PHASE2_FILES, "phase2"\)/);
  assert.match(driver, /phase2_requires_deletions_only/);
});

test("driver requires green zero-artifact validation for every release and cleanup boundary", () => {
  assert.match(driver, /wait_validation\(token, RELEASE_SOURCE_SHA, "push", "main"\)/);
  assert.match(driver, /wait_validation\(token, base_sha, "push", "main"\)/);
  assert.match(driver, /wait_validation\(token, phase1_merge, "push", "main"\)/);
  assert.match(driver, /wait_validation\(token, phase2_head, "pull_request", PHASE2_REF\)/);
  assert.match(driver, /wait_validation\(token, final_merge, "push", "main"\)/);
  assert.match(driver, /validation_artifacts_present/);
});

test("driver only observes the normal publisher and reports bounded evidence", () => {
  assert.match(driver, /actions\/workflows\/release\.yml\/runs/);
  assert.match(driver, /Publish tagged dashboard image and chart/);
  assert.match(driver, /release_artifacts_present/);
  assert.match(driver, /agent-state-dashboard-finalize-release-0\.1\.2-phase1-ready/);
  assert.match(driver, /agent-state-dashboard-finalize-release-0\.1\.2-phase2-ready/);
  assert.match(driver, /agent-state-dashboard-finalize-release-0\.1\.2-complete/);
  assert.match(driver, /agent-state-dashboard-finalize-release-0\.1\.2-failure/);
  assert.doesNotMatch(`${workflow}\n${driver}`, /buildah\s+(?:bud|build|push)|helm\s+push|skopeo\s+copy/);
});
