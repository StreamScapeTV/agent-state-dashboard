import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publisher = await readFile(
  new URL("../.github/workflows/release-existing-tag-0.1.2.yml", import.meta.url),
  "utf8",
);
const dispatcher = await readFile(
  new URL("../.github/workflows/dispatch-release-existing-tag-0.1.2.yml", import.meta.url),
  "utf8",
);

const sourceSha = "3187db893f5629d8703897a83245df46b62b6f7d";
const centralSha = "3622994c73f0dda06d9c22d51091f9e90b096bc5";

test("native recovery publisher is default-branch workflow_dispatch with an exact request gate", () => {
  assert.match(publisher, /^\s*workflow_dispatch:\s*$/m);
  assert.match(publisher, /inputs\.request_id == 'issue-55-native-existing-tag-0\.1\.2'/);
  assert.match(publisher, /github\.repository == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(publisher, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(publisher, /^\s*(?:push|pull_request|issue_comment):\s*$/m);
});

test("publisher pins the reviewed native amd64 existing-tag Central authority", () => {
  assert.match(
    publisher,
    new RegExp(`reusable-native-image-chart\\.yml@${centralSha}`),
  );
  assert.match(publisher, /^\s*release_mode:\s*existing-tag\s*$/m);
  assert.match(publisher, /^\s*release_version:\s*0\.1\.2\s*$/m);
  assert.match(publisher, new RegExp(`^\\s*release_source_sha:\\s*${sourceSha}\\s*$`, "m"));
  assert.match(publisher, /^\s*image_name:\s*agent-state-dashboard\s*$/m);
  assert.match(publisher, /^\s*chart_name:\s*agent-state-dashboard\s*$/m);
  assert.match(publisher, /^\s*chart_path:\s*charts\/agent-state-dashboard\s*$/m);
  assert.match(publisher, /FORGEJO_REGISTRY_USERNAME/);
  assert.match(publisher, /FORGEJO_REGISTRY_TOKEN/);
  assert.doesNotMatch(publisher, /reusable-tag-image-chart\.yml|arm64|latest/);
});

test("publisher reports immutable image and chart evidence and fails closed", () => {
  assert.match(publisher, /needs\.release\.outputs\.image_digest/);
  assert.match(publisher, /needs\.release\.outputs\.chart_digest/);
  assert.match(publisher, /needs\.release\.outputs\.chart_package_sha256/);
  assert.match(publisher, /native_release_identity_mismatch/);
  assert.match(publisher, /native_release_image_reference_mismatch/);
  assert.match(publisher, /native_release_chart_reference_mismatch/);
  assert.match(publisher, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(publisher, /agent-state-dashboard-native-existing-tag-0\.1\.2/);
  assert.doesNotMatch(publisher, /upload-artifact/);
});

test("dispatcher accepts only the exact owner command on issue 55", () => {
  assert.match(dispatcher, /^\s*issue_comment:\s*$/m);
  assert.match(dispatcher, /github\.event\.issue\.number == 55/);
  assert.match(dispatcher, /github\.actor == 'mimranfaruqi'/);
  assert.match(dispatcher, /github\.event\.comment\.user\.login == 'mimranfaruqi'/);
  assert.match(dispatcher, /github\.event\.comment\.body == '\/publish-existing-0\.1\.2-native'/);
  assert.match(dispatcher, /^\s*actions:\s*write\s*$/m);
  assert.match(dispatcher, /^\s*issues:\s*write\s*$/m);
});

test("dispatcher verifies the immutable tag and only dispatches the bounded publisher", () => {
  assert.match(dispatcher, new RegExp(sourceSha));
  assert.match(dispatcher, /\/git\/ref\/tags\/0\.1\.2/);
  assert.match(dispatcher, /native_dispatch_tag_target_mismatch/);
  assert.match(dispatcher, /release-existing-tag-0\.1\.2\.yml\/dispatches/);
  assert.match(dispatcher, /issue-55-native-existing-tag-0\.1\.2/);
  assert.match(dispatcher, /"ref": "main"/);
  assert.match(dispatcher, /status != 204/);
  assert.doesNotMatch(dispatcher, /\/git\/refs|refs\/tags\/0\.1\.2.*POST|ORGANIZATION_MAINTENANCE_TOKEN/);
});
