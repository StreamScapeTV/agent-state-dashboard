import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/validation.yml", import.meta.url),
  "utf8",
);

test("public dashboard validation uses Central main on GitHub-hosted runners", () => {
  assert.match(
    workflow,
    /uses: StreamScapeTV\/ci-workflows\/\.github\/workflows\/reusable-resolve-source\.yml@main/,
  );
  assert.match(
    workflow,
    /uses: StreamScapeTV\/ci-workflows\/\.github\/workflows\/reusable-node\.yml@main/,
  );
  assert.equal((workflow.match(/execution_backend: github-hosted/g) ?? []).length, 2);
  assert.doesNotMatch(
    workflow,
    /StreamScapeTV\/ci-workflows\/\.github\/workflows\/[^\s]+@[0-9a-f]{40}/,
  );
  assert.doesNotMatch(workflow, /\bruns-on:/);
  assert.doesNotMatch(workflow, /self-hosted|buildah|\[linux,\s*amd64/);
});

test("hosted migration preserves the dashboard validation contract", () => {
  assert.match(workflow, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /source_mode: \$\{\{ github\.event_name == 'pull_request'/);
  assert.match(workflow, /expected_branch: main/);
  assert.match(workflow, /validation_profile: frontend-contract-static/);
  assert.match(workflow, /version_file: \.nvmrc/);
  assert.match(workflow, /install_profile: npm-ci/);
  assert.match(workflow, /command_profile: contract-test-build/);
  assert.match(workflow, /static_output_directory: out/);
});
