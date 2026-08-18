import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-tag.yml", import.meta.url),
  "utf8",
);

const releaseSourceSha = "c86db7ae3dd9a223e42cd2c4830b75fc175f72a9";
const admission = workflow.split("admit_cleanup:", 2)[1]?.split("cut_tag:", 1)[0] ?? "";
const tagJob = workflow.split("cut_tag:", 2)[1] ?? "";
const tagStep = tagJob.split("- id: tag", 2)[1]?.split("- id: release", 1)[0] ?? "";
const observer = tagJob.split("- id: release", 2)[1]?.split("- name: Report bounded", 1)[0] ?? "";
const reporter = tagJob.split("- name: Report bounded", 2)[1] ?? "";

test("0.1.1 tag helper is driven only by the finalized temporary-helper cleanup PR", () => {
  assert.match(workflow, /pull_request_target:\n\s+types: \[opened\]/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'orchestrator\/issue-42-remove-tag-helper'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'mimranfaruqi'/);
  assert.match(workflow, /github\.event\.pull_request\.title == '\[#42\] Remove temporary 0\.1\.1 tag helper'/);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/);
});

test("cleanup admission is read-only and proves exactly two deletions before privileged work", () => {
  assert.match(workflow, /pull-requests: read/);
  assert.match(admission, /ADMISSION_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(admission, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.match(admission, /\/pulls\/\{pr_number\}\/files\?per_page=100/);
  assert.match(admission, /\.github\/workflows\/cut-release-0\.1\.1-tag\.yml/);
  assert.match(admission, /tests\/release-tag-cut\.test\.mjs/);
  assert.match(admission, /filenames != expected_files or len\(files\) != 2/);
  assert.match(admission, /row\.get\("status"\) != "removed"/);
  assert.match(admission, /cleanup_admission_requires_deletions_only/);
  assert.match(admission, /cleanup_admission_main_drifted/);
});

test("tag mutation uses only the organization maintenance authority after admission", () => {
  assert.match(tagJob, /needs: admit_cleanup/);
  assert.match(tagJob, /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/);
  assert.match(tagStep, /ORGANIZATION_MAINTENANCE_TOKEN/);
  assert.doesNotMatch(tagStep, /github\.token|GITHUB_TOKEN|ADMISSION_TOKEN|ACTIONS_READ_TOKEN|ISSUE_COMMENT_TOKEN/);
  assert.match(tagStep, new RegExp(`RELEASE_SOURCE_SHA: ${releaseSourceSha}`));
  assert.match(tagStep, /\/git\/ref\/heads\/main/);
  assert.match(tagStep, /\/compare\/\{release_source_sha\}\.\.\.\{admitted_base_sha\}/);
  assert.match(tagStep, /merge_base_commit/);
  assert.match(tagStep, /"POST", "\/git\/refs"/);
  assert.match(tagStep, /"ref": f"refs\/tags\/\{release_tag\}"/);
  assert.match(tagStep, /release_tag_not_lightweight_commit/);
  assert.match(tagStep, /release_tag_target_mismatch/);
});

test("ordinary workflow token is limited to publication observation and issue reporting", () => {
  assert.match(observer, /ACTIONS_READ_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(observer, /\/actions\/workflows\/release\.yml\/runs/);
  assert.match(observer, /run\.get\("head_sha"\) == release_source_sha/);
  assert.match(reporter, /ISSUE_COMMENT_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(reporter, /\/issues\/42\/comments/);
  assert.match(reporter, /no producer completion is claimed/);
  assert.doesNotMatch(observer, /\/git\/refs|refs\/tags/);
  assert.doesNotMatch(reporter, /\/git\/refs|refs\/tags/);
});

test("tag helper contains no producer publication or deployment implementation", () => {
  assert.doesNotMatch(workflow, /buildah|podman|docker build|helm |kubectl|flux |latest/i);
  assert.doesNotMatch(workflow, /git\.faruqi\.dev|helm-charts|agent-state-dashboard:0\.1\.1/);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact/);
});
