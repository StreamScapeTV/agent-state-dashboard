import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-tag.yml", import.meta.url),
  "utf8",
);

const releaseSourceSha = "c86db7ae3dd9a223e42cd2c4830b75fc175f72a9";
const validatedRunId = "32136685577";
const validatedHeadSha = "69bb56cd0083b668a76d20ee32d247700923b41b";
const tagStep = workflow.split("- id: tag", 2)[1]?.split("- id: release", 1)[0] ?? "";
const releaseObserver = workflow.split("- id: release", 2)[1]?.split("- name: Report bounded", 1)[0] ?? "";
const reporter = workflow.split("- name: Report bounded", 2)[1] ?? "";

test("0.1.1 tag helper runs only from the exact successful validated Node workflow run", () => {
  assert.match(workflow, /name: Cut immutable dashboard 0\.1\.1 tag/);
  assert.match(workflow, /workflow_run:\n\s+workflows: \["Node validation"\]\n\s+types: \[completed\]/);
  assert.doesNotMatch(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /github\.repository == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.event_name == 'workflow_run'/);
  assert.match(workflow, new RegExp(`github\\.event\\.workflow_run\\.id == ${validatedRunId}`));
  assert.match(workflow, /github\.event\.workflow_run\.name == 'Node validation'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_repository\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, new RegExp(`github\\.event\\.workflow_run\\.head_sha == '${validatedHeadSha}'`));
  assert.match(workflow, new RegExp(`RELEASE_SOURCE_SHA: ${releaseSourceSha}`));
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
});

test("tag mutation uses only the non-recursive organization mutation credential", () => {
  assert.match(
    workflow,
    /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/,
  );
  assert.match(tagStep, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.match(tagStep, /release_tag_workflow_run_not_trusted/);
  assert.match(tagStep, new RegExp(`trigger_run_id != "${validatedRunId}"`));
  assert.match(tagStep, new RegExp(`trigger_head_sha != "${validatedHeadSha}"`));
  for (const forbidden of [
    /github\.token/,
    /GITHUB_TOKEN/,
    /ACTIONS_READ_TOKEN/,
    /ISSUE_COMMENT_TOKEN/,
  ]) {
    assert.doesNotMatch(tagStep, forbidden);
  }
  assert.doesNotMatch(tagStep, /FORGEJO_REGISTRY|SUPABASE|KUBE|SOPS|TAILSCALE/);
});

test("tag helper proves exact merged source ancestry and independently reads back the tag", () => {
  assert.match(tagStep, /\/git\/ref\/heads\/main/);
  assert.match(tagStep, /\/git\/commits\/\{release_source_sha\}/);
  assert.match(tagStep, /\/compare\/\{release_source_sha\}\.\.\.\{caller_sha\}/);
  assert.match(tagStep, /merge_base_commit/);
  assert.match(tagStep, /\/git\/ref\/tags\/\{encoded_tag\}/);
  assert.match(tagStep, /"POST",\n\s+"\/git\/refs"/);
  assert.match(tagStep, /"ref": f"refs\/tags\/\{release_tag\}"/);
  assert.match(tagStep, /release_tag_not_lightweight_commit/);
  assert.match(tagStep, /release_tag_target_mismatch/);
});

test("ordinary workflow token is limited to read-only release observation and issue reporting", () => {
  assert.match(releaseObserver, /ACTIONS_READ_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(releaseObserver, /\/actions\/workflows\/release\.yml\/runs/);
  assert.match(releaseObserver, /"event": "push"/);
  assert.match(releaseObserver, /run\.get\("head_sha"\) == release_source_sha/);
  assert.match(reporter, /ISSUE_COMMENT_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(reporter, /\/issues\/42\/comments/);
  assert.match(reporter, /no producer completion is claimed/);
  assert.match(reporter, /validated Node run/);
  assert.doesNotMatch(releaseObserver, /\/git\/refs|refs\/tags/);
  assert.doesNotMatch(reporter, /\/git\/refs|refs\/tags/);
});

test("tag helper contains no producer publication or deployment behavior", () => {
  assert.doesNotMatch(workflow, /buildah|podman|docker build|helm |kubectl|flux |latest/i);
  assert.doesNotMatch(workflow, /git\.faruqi\.dev|helm-charts|agent-state-dashboard:0\.1\.1/);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact/);
});
