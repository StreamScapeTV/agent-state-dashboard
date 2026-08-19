import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/finalize-release-0.1.2.yml", import.meta.url),
  "utf8",
);

test("0.1.2 finalizer uses the repository-proven pull_request event and exact phase-1 PR", () => {
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:\s*$/m);
  assert.match(workflow, /^\s*types:\s*\[opened, synchronize, reopened, ready_for_review\]\s*$/m);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-55-retire-release-helpers'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.pull_request\.title == '\[#55\] Retire temporary release helpers after 0\.1\.2'/);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/);
});

test("phase-1 cleanup keeps only the finalizer while removing obsolete helpers", () => {
  for (const path of [
    ".github/workflows/cut-release-0.1.1-arc.yml",
    ".github/workflows/cut-release-0.1.1-pr.yml",
    ".github/workflows/cut-release-0.1.1-tag.yml",
    ".github/workflows/release-existing-tag-0.1.1.yml",
    ".github/workflows/cut-release-0.1.2.yml",
    "tests/release-tag-cut.test.mjs",
    "tests/release-0.1.2-cut.test.mjs",
  ]) {
    assert.match(workflow, new RegExp(path.replaceAll(".", "\\.")));
  }
  assert.match(workflow, /finalizer_phase1_file_set_mismatch/);
  assert.match(workflow, /finalizer_phase1_requires_deletions_only/);
});

test("finalizer binds corrected release source and requires green zero-artifact main validation", () => {
  assert.match(workflow, /^\s*RELEASE_TAG:\s*0\.1\.2\s*$/m);
  assert.match(workflow, /^\s*RELEASE_SOURCE_SHA:\s*3187db893f5629d8703897a83245df46b62b6f7d\s*$/m);
  assert.match(workflow, /package\.get\("version"\) != release_tag/);
  assert.match(workflow, /finalizer_chart_version_mismatch/);
  assert.match(workflow, /finalizer_chart_app_version_mismatch/);
  assert.match(workflow, /successful_validation\(release_source_sha, "push", "main"\)/);
  assert.match(workflow, /successful_validation\(pr_base_sha, "push", "main"\)/);
  assert.match(workflow, /artifacts\.get\("total_count"\) != 0/);
});

test("maintenance credential is scoped only to immutable tag creation", () => {
  assert.match(workflow, /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/);
  assert.match(workflow, /organization_maintenance_token_required/);
  assert.match(workflow, /request\("POST", "\/git\/refs", \{"ref": f"refs\/tags\/\{release_tag\}", "sha": release_source_sha\}\)/);
  assert.match(workflow, /finalizer_existing_tag_conflict/);
  assert.match(workflow, /finalizer_tag_readback_mismatch/);
  assert.doesNotMatch(workflow, /FORGEJO_REGISTRY_(?:USERNAME|TOKEN)/);
});

test("normal tag-push publisher must succeed before phase-1 cleanup merges", () => {
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs/);
  assert.match(workflow, /Publish tagged dashboard image and chart/);
  assert.match(workflow, /finalizer_release_failed/);
  assert.match(workflow, /Phase-1 cleanup PR .*release-ready to merge/);
  assert.doesNotMatch(workflow, /buildah\s+(?:bud|build|push)|helm\s+push|skopeo\s+copy/);
});

test("running finalizer verifies phase-1 main then admits exact phase-2 self-removal", () => {
  assert.match(workflow, /^\s*PHASE2_HEAD_REF:\s*orchestrator\/issue-55-retire-finalizer\s*$/m);
  assert.match(workflow, /\[#55\] Remove final 0\.1\.2 release finalizer/);
  assert.match(workflow, /finalizer_phase1_merge_not_current_main/);
  assert.match(workflow, /finalizer_phase1_validation_not_green/);
  assert.match(workflow, /\.github\/workflows\/finalize-release-0\.1\.2\.yml/);
  assert.match(workflow, /tests\/finalize-release-0\.1\.2\.test\.mjs/);
  assert.match(workflow, /finalizer_phase2_file_set_mismatch/);
  assert.match(workflow, /finalizer_phase2_requires_deletions_only/);
  assert.match(workflow, /"event": "pull_request"/);
  assert.match(workflow, /run\.get\("head_branch"\) == phase2_ref/);
  assert.match(workflow, /phase2-ready/);
});

test("finalizer survives its own deletion and proves final main validation", () => {
  assert.match(workflow, /finalizer_phase2_merge_not_current_main/);
  assert.match(workflow, /finalizer_phase2_main_validation_not_green/);
  assert.match(workflow, /finalizer_phase2_main_validation_artifacts_present/);
  assert.match(workflow, /agent-state-dashboard-finalize-release-0\.1\.2-complete/);
  assert.match(workflow, /all temporary release helpers are removed/);
});
