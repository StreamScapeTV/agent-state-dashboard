import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/cut-release-0.1.1-tag.yml", import.meta.url),
  "utf8",
);

const releaseSourceSha = "c86db7ae3dd9a223e42cd2c4830b75fc175f72a9";

test("0.1.1 tag helper is a bounded one-shot main-push source identity operation", () => {
  assert.match(workflow, /name: Cut immutable dashboard 0\.1\.1 tag/);
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/);
  assert.match(workflow, /paths:\n\s+- \.github\/workflows\/cut-release-0\.1\.1-tag\.yml/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /github\.repository == 'StreamScapeTV\/agent-state-dashboard'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /RELEASE_TAG: 0\.1\.1/);
  assert.match(workflow, new RegExp(`RELEASE_SOURCE_SHA: ${releaseSourceSha}`));
});

test("tag helper uses only the non-recursive organization mutation credential", () => {
  assert.match(
    workflow,
    /ORGANIZATION_MAINTENANCE_TOKEN: \$\{\{ secrets\.ORGANIZATION_MAINTENANCE_TOKEN \}\}/,
  );
  assert.doesNotMatch(workflow, /secrets\.GITHUB_TOKEN|github\.token|GITHUB_TOKEN/);
  assert.doesNotMatch(workflow, /FORGEJO_REGISTRY|SUPABASE|KUBE|SOPS|TAILSCALE/);
});

test("tag helper proves exact merged source ancestry and independently reads back the tag", () => {
  assert.match(workflow, /\/git\/ref\/heads\/main/);
  assert.match(workflow, /\/git\/commits\/\{release_source_sha\}/);
  assert.match(workflow, /\/compare\/\{release_source_sha\}\.\.\.\{caller_sha\}/);
  assert.match(workflow, /merge_base_commit/);
  assert.match(workflow, /\/git\/ref\/tags\/\{encoded_tag\}/);
  assert.match(workflow, /"POST",\n\s+"\/git\/refs"/);
  assert.match(workflow, /"ref": f"refs\/tags\/\{release_tag\}"/);
  assert.match(workflow, /release_tag_not_lightweight_commit/);
  assert.match(workflow, /release_tag_target_mismatch/);
});

test("tag helper contains no producer publication or deployment behavior", () => {
  assert.doesNotMatch(workflow, /buildah|podman|docker build|helm |kubectl|flux |latest/i);
  assert.doesNotMatch(workflow, /git\.faruqi\.dev|helm-charts|agent-state-dashboard:0\.1\.1/);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact/);
});
