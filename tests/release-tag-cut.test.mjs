import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helper = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-tag.yml", import.meta.url),
  "utf8",
);
const dispatcher = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-pr.yml", import.meta.url),
  "utf8",
);
const arcGate = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-arc.yml", import.meta.url),
  "utf8",
);

const releaseSourceSha = "c86db7ae3dd9a223e42cd2c4830b75fc175f72a9";
const requestId = "issue-42-pr49-cut-0.1.1";
const helperAdmission = helper.split("admit_cleanup:", 2)[1]?.split("cut_tag:", 1)[0] ?? "";
const helperTagJob = helper.split("cut_tag:", 2)[1] ?? "";
const helperTagStep = helperTagJob.split("- id: tag", 2)[1]?.split("- id: release", 1)[0] ?? "";
const arcAdmission = arcGate.split("admit_cleanup:", 2)[1]?.split("cut_tag:", 1)[0] ?? "";
const arcTagJob = arcGate.split("cut_tag:", 2)[1] ?? "";

test("default-branch tag helper is workflow-dispatch-only and one-shot", () => {
  assert.match(helper, /workflow_dispatch:/);
  assert.match(helper, /request_id:/);
  assert.match(helper, /cleanup_pr:/);
  assert.match(helper, /cleanup_head_sha:/);
  assert.doesNotMatch(helper, /pull_request_target:/);
  assert.doesNotMatch(helper, /issue_comment:/);
  assert.doesNotMatch(helper, /workflow_run:/);
  assert.match(helper, new RegExp(requestId.replaceAll(".", "\\.")));
  assert.match(helper, new RegExp(`RELEASE_SOURCE_SHA: ${releaseSourceSha}`));
});

test("helper re-admits exact PR 49 cleanup before exposing mutation authority", () => {
  assert.match(helperAdmission, /github\.event_name == 'workflow_dispatch'/);
  assert.match(helperAdmission, /inputs\.request_id == 'issue-42-pr49-cut-0\.1\.1'/);
  assert.match(helperAdmission, /PR_NUMBER: \$\{\{ inputs\.cleanup_pr \}\}/);
  assert.match(helperAdmission, /PR_HEAD_SHA: \$\{\{ inputs\.cleanup_head_sha \}\}/);
  assert.match(helperAdmission, /ADMISSION_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(helperAdmission, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.match(helperAdmission, /pr_number != "49"/);
  assert.match(helperAdmission, /orchestrator\/issue-42-remove-tag-helper/);
  assert.match(helperAdmission, /\[#42\] Remove temporary 0\.1\.1 tag helper/);
  assert.match(helperAdmission, /\.github\/workflows\/cut-release-0\.1\.1-tag\.yml/);
  assert.match(helperAdmission, /tests\/release-tag-cut\.test\.mjs/);
  assert.match(helperAdmission, /filenames != expected_files or len\(files\) != 2/);
  assert.match(helperAdmission, /cleanup_admission_requires_deletions_only/);
});

test("tag mutation remains isolated to organization maintenance authority", () => {
  assert.match(helperTagJob, /needs: admit_cleanup/);
  assert.match(
    helperTagJob,
    /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/,
  );
  assert.match(helperTagStep, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.doesNotMatch(helperTagStep, /github\.token|GITHUB_TOKEN|ADMISSION_TOKEN|ACTIONS_READ_TOKEN|ISSUE_COMMENT_TOKEN/);
  assert.match(helperTagStep, /event_name != "workflow_dispatch"/);
  assert.match(helperTagStep, /cleanup_pr_number != "49"/);
  assert.match(helperTagStep, /\/compare\/\{release_source_sha\}\.\.\.\{admitted_base_sha\}/);
  assert.match(helperTagStep, /"POST", "\/git\/refs"/);
  assert.match(helperTagStep, /"ref": f"refs\/tags\/\{release_tag\}"/);
  assert.match(helperTagStep, /release_tag_target_mismatch/);
});

test("PR dispatcher is unprivileged and only synchronizes exact cleanup PR 49", () => {
  assert.match(dispatcher, /pull_request:\n\s+branches:\n\s+- main\n\s+types: \[synchronize\]/);
  assert.match(dispatcher, /actions: write/);
  assert.match(dispatcher, /contents: read/);
  assert.match(dispatcher, /pull-requests: read/);
  assert.match(dispatcher, /github\.event\.pull_request\.number == 49/);
  assert.match(dispatcher, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-42-remove-tag-helper'/);
  assert.match(dispatcher, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(dispatcher, /github\.event\.pull_request\.title == '\[#42\] Remove temporary 0\.1\.1 tag helper'/);
  assert.match(dispatcher, /DISPATCH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(dispatcher, /ORGANIZATION_MAINTENANCE_TOKEN|FORGEJO_REGISTRY|SUPABASE|KUBE|SOPS|TAILSCALE/);
});

test("dispatcher verifies two deletions then dispatches helper on main", () => {
  assert.match(dispatcher, /\/pulls\/\{pr_number\}\/files\?per_page=100/);
  assert.match(dispatcher, /\.github\/workflows\/cut-release-0\.1\.1-tag\.yml/);
  assert.match(dispatcher, /tests\/release-tag-cut\.test\.mjs/);
  assert.match(dispatcher, /filenames != expected_files or len\(files\) != 2/);
  assert.match(dispatcher, /tag_dispatch_requires_deletions_only/);
  assert.match(dispatcher, /\/actions\/workflows\/cut-release-0\.1\.1-tag\.yml\/dispatches/);
  assert.match(dispatcher, /"ref": "main"/);
  assert.match(dispatcher, new RegExp(`"request_id": "${requestId}"`));
  assert.match(dispatcher, /"cleanup_pr": pr_number/);
  assert.match(dispatcher, /"cleanup_head_sha": pr_head_sha/);
  assert.match(dispatcher, /response\.status != 204/);
});

test("ARC tag gate executes only protected cleanup admission on general-tiny capacity", () => {
  assert.match(arcGate, /pull_request_target:\n\s+types: \[synchronize\]/);
  assert.match(arcGate, /github\.event\.pull_request\.number == 49/);
  assert.match(arcGate, /github\.event\.pull_request\.head\.repo\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(arcGate, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-42-remove-tag-helper'/);
  assert.match(arcGate, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(arcGate, /github\.event\.pull_request\.title == '\[#42\] Remove temporary 0\.1\.1 tag helper'/);
  assert.equal((arcGate.match(/runs-on: \[linux, amd64, general, tiny\]/g) ?? []).length, 2);
  assert.doesNotMatch(arcGate, /ubuntu-(?:latest|[0-9.]+)/);
});

test("ARC admission is read-only and secret-free", () => {
  assert.match(arcGate, /permissions:\n\s+contents: read\n\s+pull-requests: read/);
  assert.match(arcAdmission, /ADMISSION_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(arcAdmission, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.match(arcAdmission, /\/pulls\/\{pr_number\}\/files\?per_page=100/);
  assert.match(arcAdmission, /filenames != expected_files or len\(files\) != 2/);
  assert.match(arcAdmission, /arc_admission_requires_deletions_only/);
  assert.match(arcAdmission, /arc_admission_main_drifted/);
});

test("ARC mutation authority is isolated after admission and only creates the exact tag ref", () => {
  assert.match(arcTagJob, /needs: admit_cleanup/);
  assert.match(
    arcTagJob,
    /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/,
  );
  assert.match(arcTagJob, new RegExp(`RELEASE_SOURCE_SHA: ${releaseSourceSha}`));
  assert.match(arcTagJob, /cleanup_pr_number != "49"/);
  assert.match(arcTagJob, /\/compare\/\{release_source_sha\}\.\.\.\{admitted_base_sha\}/);
  assert.match(arcTagJob, /request\("POST", "\/git\/refs", \{"ref": f"refs\/tags\/\{release_tag\}", "sha": release_source_sha\}\)/);
  assert.match(arcTagJob, /release_tag_target_mismatch/);
  assert.doesNotMatch(arcTagJob, /FORGEJO_REGISTRY|SUPABASE|KUBE|SOPS|TAILSCALE/);
});

test("temporary tag machinery contains no image, chart, or deployment implementation", () => {
  const combined = `${helper}\n${dispatcher}\n${arcGate}`;
  assert.doesNotMatch(combined, /buildah|podman|docker build|helm |kubectl|flux |latest/i);
  assert.doesNotMatch(combined, /git\.faruqi\.dev|helm-charts|agent-state-dashboard:0\.1\.1/);
  assert.doesNotMatch(combined, /upload-artifact|download-artifact/);
});
