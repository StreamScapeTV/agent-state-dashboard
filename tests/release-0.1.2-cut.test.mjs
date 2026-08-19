import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/cut-release-0.1.2.yml", import.meta.url),
  "utf8",
);

test("0.1.2 tag cutter is owner-gated and issue-comment triggered", () => {
  assert.match(workflow, /^\s*issue_comment:\s*$/m);
  assert.match(workflow, /^\s*types:\s*\[created\]\s*$/m);
  assert.match(workflow, /github\.event\.issue\.number == 55/);
  assert.match(workflow, /github\.event\.issue\.pull_request == null/);
  assert.match(workflow, /github\.actor == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.comment\.body == '\/cut-release-0\.1\.2'/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});

test("0.1.2 tag cutter binds the exact corrected release source and version", () => {
  assert.match(workflow, /^\s*RELEASE_TAG:\s*0\.1\.2\s*$/m);
  assert.match(
    workflow,
    /^\s*RELEASE_SOURCE_SHA:\s*3187db893f5629d8703897a83245df46b62b6f7d\s*$/m,
  );
  assert.match(workflow, /package\.get\("version"\) != release_tag/);
  assert.match(workflow, /release_cut_chart_version_mismatch/);
  assert.match(workflow, /release_cut_chart_app_version_mismatch/);
  assert.match(workflow, /release_cut_source_not_ancestor/);
  assert.match(workflow, /release_cut_merge_base_mismatch/);
});

test("0.1.2 tag cutter requires green zero-artifact main validation before privilege", () => {
  assert.match(workflow, /^\s*actions:\s*read\s*$/m);
  assert.match(workflow, /^\s*contents:\s*read\s*$/m);
  assert.match(workflow, /^\s*issues:\s*write\s*$/m);
  assert.match(workflow, /actions\/workflows\/validation\.yml\/runs/);
  assert.match(workflow, /"event": "push"/);
  assert.match(workflow, /"status": "completed"/);
  assert.match(workflow, /"head_sha": sha/);
  assert.match(workflow, /run\.get\("head_branch"\) == "main"/);
  assert.match(workflow, /run\.get\("conclusion"\) == "success"/);
  assert.match(workflow, /actions\/runs\/\{run_id\}\/artifacts\?per_page=100/);
  assert.match(workflow, /artifacts\.get\("total_count"\) != 0/);
  assert.match(workflow, /\(\("source", release_source_sha\), \("current_main", current_main_sha\)\)/);
});

test("0.1.2 tag cutter uses maintenance authority only for immutable tag creation", () => {
  assert.match(workflow, /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/);
  assert.match(workflow, /organization_maintenance_token_required/);
  assert.match(workflow, /request\("POST", "\/git\/refs", \{"ref": f"refs\/tags\/\{release_tag\}", "sha": release_source_sha\}\)/);
  assert.match(workflow, /release_cut_existing_tag_conflict/);
  assert.match(workflow, /release_cut_tag_readback_mismatch/);
  assert.doesNotMatch(workflow, /FORGEJO_REGISTRY_(?:USERNAME|TOKEN)/);
});

test("0.1.2 tag cutter observes the normal tag-push producer instead of publishing itself", () => {
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs/);
  assert.match(workflow, /run\.get\("event"\) == "push"/);
  assert.match(workflow, /run\.get\("head_sha"\) == release_source_sha/);
  assert.match(workflow, /Publish tagged dashboard image and chart/);
  assert.match(workflow, /agent-state-dashboard-cut-release-0\.1\.2/);
  assert.match(workflow, /agent-state-dashboard-cut-release-0\.1\.2 -->/);
  assert.doesNotMatch(workflow, /buildah\s+(?:bud|build|push)|helm\s+push|skopeo\s+copy/);
});
