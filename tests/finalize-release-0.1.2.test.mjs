import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/finalize-release-0.1.2.yml", import.meta.url),
  "utf8",
);

test("0.1.2 finalizer is bound to the exact trusted cleanup PR", () => {
  assert.match(workflow, /^\s*pull_request_target:\s*$/m);
  assert.match(workflow, /^\s*types:\s*\[opened, synchronize, reopened, ready_for_review\]\s*$/m);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-55-retire-release-helpers'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.pull_request\.title == '\[#55\] Retire temporary release helpers after 0\.1\.2'/);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/);
});

test("finalizer admits only the exact deletion-only temporary helper cleanup", () => {
  for (const path of [
    ".github/workflows/cut-release-0.1.1-arc.yml",
    ".github/workflows/cut-release-0.1.1-pr.yml",
    ".github/workflows/cut-release-0.1.1-tag.yml",
    ".github/workflows/release-existing-tag-0.1.1.yml",
    ".github/workflows/cut-release-0.1.2.yml",
    ".github/workflows/finalize-release-0.1.2.yml",
    "tests/release-tag-cut.test.mjs",
    "tests/release-0.1.2-cut.test.mjs",
    "tests/finalize-release-0.1.2.test.mjs",
  ]) {
    assert.match(workflow, new RegExp(path.replaceAll(".", "\\.")));
  }
  assert.match(workflow, /filenames != expected_files/);
  assert.match(workflow, /row\.get\("status"\) != "removed"/);
  assert.match(workflow, /finalizer_cleanup_requires_deletions_only/);
});

test("finalizer binds corrected 0.1.2 source and requires green zero-artifact main validation", () => {
  assert.match(workflow, /^\s*RELEASE_TAG:\s*0\.1\.2\s*$/m);
  assert.match(workflow, /^\s*RELEASE_SOURCE_SHA:\s*3187db893f5629d8703897a83245df46b62b6f7d\s*$/m);
  assert.match(workflow, /package\.get\("version"\) != release_tag/);
  assert.match(workflow, /finalizer_chart_version_mismatch/);
  assert.match(workflow, /finalizer_chart_app_version_mismatch/);
  assert.match(workflow, /release_source_sha}\.\.\.\{pr_base_sha/);
  assert.match(workflow, /actions\/workflows\/validation\.yml\/runs/);
  assert.match(workflow, /run\.get\("head_branch"\) == "main"/);
  assert.match(workflow, /run\.get\("conclusion"\) == "success"/);
  assert.match(workflow, /artifacts\.get\("total_count"\) != 0/);
  assert.match(workflow, /source_validation_run = successful_main_validation\(release_source_sha\)/);
  assert.match(workflow, /base_validation_run = successful_main_validation\(pr_base_sha\)/);
});

test("maintenance credential is scoped to immutable tag creation", () => {
  assert.match(workflow, /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/);
  assert.match(workflow, /organization_maintenance_token_required/);
  assert.match(workflow, /request\("POST", "\/git\/refs", \{"ref": f"refs\/tags\/\{release_tag\}", "sha": release_source_sha\}\)/);
  assert.match(workflow, /finalizer_existing_tag_conflict/);
  assert.match(workflow, /finalizer_tag_readback_mismatch/);
  assert.doesNotMatch(workflow, /FORGEJO_REGISTRY_(?:USERNAME|TOKEN)/);
});

test("finalizer consumes normal tag-push publisher and waits for final cleanup validation", () => {
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs/);
  assert.match(workflow, /Publish tagged dashboard image and chart/);
  assert.match(workflow, /finalizer_release_failed/);
  assert.match(workflow, /release-ready to merge/);
  assert.match(workflow, /pull\.get\("merged"\) is True/);
  assert.match(workflow, /merge_commit_sha/);
  assert.match(workflow, /finalizer_cleanup_merge_not_current_main/);
  assert.match(workflow, /finalizer_cleanup_validation_not_green/);
  assert.match(workflow, /agent-state-dashboard-finalize-release-0\.1\.2-complete/);
  assert.doesNotMatch(workflow, /buildah\s+(?:bud|build|push)|helm\s+push|skopeo\s+copy/);
});
