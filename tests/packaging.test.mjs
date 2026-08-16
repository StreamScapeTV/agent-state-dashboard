import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  dockerfile,
  entrypoint,
  nginx,
  securityHeaders,
  chart,
  values,
  valuesSchema,
  deployment,
  service,
  releaseWorkflow,
  packageJsonSource,
  nodeVersionSource,
  nextConfigSource,
  dockerIgnore,
  gitIgnore,
] = await Promise.all([
  read("Dockerfile"),
  read("docker/entrypoint.sh"),
  read("docker/nginx.conf"),
  read("docker/security-headers.conf"),
  read("charts/agent-state-dashboard/Chart.yaml"),
  read("charts/agent-state-dashboard/values.yaml"),
  read("charts/agent-state-dashboard/values.schema.json"),
  read("charts/agent-state-dashboard/templates/deployment.yaml"),
  read("charts/agent-state-dashboard/templates/service.yaml"),
  read(".github/workflows/release.yml"),
  read("package.json"),
  read(".nvmrc"),
  read("next.config.ts"),
  read(".dockerignore"),
  read(".gitignore"),
]);

const packageJson = JSON.parse(packageJsonSource);
const chartValuesSchema = JSON.parse(valuesSchema);
const nodeVersion = nodeVersionSource.trim();
const chartVersion = chart.match(/^version:\s*([^\s]+)$/m)?.[1];
const chartAppVersion = chart.match(/^appVersion:\s*["']?([^"'\s]+)["']?$/m)?.[1];
const publisherSha = "85b86d260d3212ec1c86433439df598864aa461f";

test("container packages static export behind NGINX and a loopback Node data process", () => {
  assert.match(dockerfile, new RegExp(`ARG NODE_VERSION=${nodeVersion.replaceAll(".", "\\.")}`));
  const pinnedNodeBases = dockerfile.match(
    /FROM node:\$\{NODE_VERSION\}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b/g,
  );
  assert.equal(pinnedNodeBases?.length, 2);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /test -f server\/index\.mjs/);
  assert.match(dockerfile, /cp -R server\/\. \/opt\/dashboard\/server\//);
  assert.doesNotMatch(dockerfile, /if \[ -d server \]/);
  assert.match(dockerfile, /COPY --from=build[^\n]*\/opt\/dashboard\/static/);
  assert.match(dockerfile, /COPY docker\/security-headers\.conf \/etc\/nginx\/security-headers\.conf/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /HEALTHCHECK[^\n]*--interval=30s/);
  assert.match(dockerfile, /127\.0\.0\.1:8080\/healthz/);
  assert.match(entrypoint, /SERVER_ENTRYPOINT:-\/app\/server\/index\.mjs/);
  assert.match(entrypoint, /SUPABASE_URL/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEY/);
  assert.match(entrypoint, /SERVER_PORT:-8788/);
  assert.match(entrypoint, /\/tmp\/nginx\/client_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/proxy_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/fastcgi_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/uwsgi_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/scgi_temp/);

  const nodeStart = entrypoint.indexOf('node "${SERVER_ENTRYPOINT}" &');
  const secretUnset = entrypoint.indexOf("unset SUPABASE_URL SUPABASE_SECRET_KEY");
  const nginxStart = entrypoint.indexOf("nginx -g 'daemon off;' &");
  assert.ok(nodeStart >= 0 && nodeStart < secretUnset);
  assert.ok(secretUnset < nginxStart);

  assert.doesNotMatch(`${dockerfile}\n${entrypoint}`, /AGENT_STATE_SUPABASE_SECRET_KEY|TEAM_DOMAIN|POLICY_AUD|fvbaxyklaclgdzyhybbr/);
});

test("static build identity rotates with the release version before immutable caching", () => {
  assert.match(nextConfigSource, /readFileSync\("package\.json", "utf8"\)/);
  assert.match(nextConfigSource, /generateBuildId:[^\n]*agent-state-dashboard-\$\{packageVersion\}/);
  assert.doesNotMatch(nextConfigSource, /agent-state-dashboard-static/);
});

test("NGINX proxies local data routes and applies bounded security/cache policy", () => {
  assert.match(nginx, /^worker_processes 1;$/m);
  assert.match(nginx, /server 127\.0\.0\.1:8788/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /location = \/events/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /location \/_next\/static\//);
  assert.match(nginx, /immutable/);
  assert.doesNotMatch(nginx, /^\s*expires\s/m);
  assert.match(nginx, /try_files \$uri \$uri\/ \$uri\.html \/index\.html/);

  const headerIncludes = nginx.match(/include \/etc\/nginx\/security-headers\.conf;/g);
  assert.equal(headerIncludes?.length, 4);
  assert.match(securityHeaders, /X-Content-Type-Options "nosniff" always/);
  assert.match(securityHeaders, /Referrer-Policy "no-referrer" always/);
  assert.match(securityHeaders, /X-Frame-Options "DENY" always/);
  assert.match(securityHeaders, /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)" always/);
});

test("retired Cloudflare Pages headers cannot be copied back into the static export", async () => {
  await assert.rejects(
    access(new URL("../public/_headers", import.meta.url)),
    (error) => error?.code === "ENOENT",
  );
});

test("Helm defaults use the exact existing Secret and Tailscale contract", () => {
  assert.equal(chartVersion, packageJson.version);
  assert.equal(chartAppVersion, packageJson.version);
  assert.equal(chartValuesSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.match(values, /name: agent-state-dashboard-supabase/);
  assert.match(values, /urlKey: SUPABASE_URL/);
  assert.match(values, /secretKeyKey: SUPABASE_SECRET_KEY/);
  assert.match(values, /hostname: agent-state-dashboard/);
  assert.match(values, /- tag:agent-state-dashboard/);
  assert.match(values, /proxyGroup: tailscale-proxy-group/);

  assert.match(service, /type: LoadBalancer/);
  assert.match(service, /loadBalancerClass: tailscale/);
  assert.match(service, /allocateLoadBalancerNodePorts: false/);
  assert.match(service, /tailscale\.com\/hostname/);
  assert.match(service, /tailscale\.com\/tags/);
  assert.match(service, /tailscale\.com\/proxy-group/);
});

test("Helm schema models the complete public values surface and locks security invariants", () => {
  const properties = chartValuesSchema.properties ?? {};
  const image = properties.image;
  const imagePullSecret = properties.imagePullSecrets?.items;
  const serviceValues = properties.service;
  const tailscale = properties.tailscale;
  const supabase = properties.supabase;
  const existingSecret = supabase?.properties?.existingSecret;
  const podSecurity = properties.podSecurityContext;
  const containerSecurity = properties.securityContext;

  assert.equal(chartValuesSchema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(properties).sort(),
    [
      "affinity",
      "fullnameOverride",
      "image",
      "imagePullSecrets",
      "nameOverride",
      "nodeSelector",
      "podAnnotations",
      "podLabels",
      "podSecurityContext",
      "probes",
      "replicaCount",
      "resources",
      "securityContext",
      "service",
      "supabase",
      "tailscale",
      "terminationGracePeriodSeconds",
      "tolerations",
    ],
  );
  assert.equal(image?.additionalProperties, false);
  assert.equal(imagePullSecret?.additionalProperties, false);
  assert.equal(serviceValues?.additionalProperties, false);
  assert.equal(tailscale?.additionalProperties, false);
  assert.equal(supabase?.additionalProperties, false);
  assert.deepEqual(Object.keys(supabase?.properties ?? {}), ["existingSecret"]);
  assert.equal(existingSecret?.additionalProperties, false);
  assert.deepEqual(
    Object.keys(existingSecret?.properties ?? {}).sort(),
    ["name", "secretKeyKey", "urlKey"],
  );
  assert.equal(podSecurity?.properties?.runAsNonRoot?.const, true);
  assert.equal(podSecurity?.properties?.runAsUser?.const, 1000);
  assert.equal(podSecurity?.properties?.runAsGroup?.const, 1000);
  assert.equal(podSecurity?.properties?.fsGroup?.const, 1000);
  assert.equal(podSecurity?.properties?.seccompProfile?.properties?.type?.const, "RuntimeDefault");
  assert.equal(containerSecurity?.properties?.allowPrivilegeEscalation?.const, false);
  assert.equal(containerSecurity?.properties?.readOnlyRootFilesystem?.const, true);
  assert.equal(containerSecurity?.properties?.runAsNonRoot?.const, true);
  assert.equal(containerSecurity?.properties?.capabilities?.properties?.drop?.items?.const, "ALL");
});

test("Helm workload reads secrets by reference and has bounded probes/resources/security", () => {
  assert.match(deployment, /secretKeyRef:/);
  assert.match(deployment, /name: SUPABASE_URL/);
  assert.match(deployment, /name: SUPABASE_SECRET_KEY/);
  assert.match(deployment, /readinessProbe:/);
  assert.match(deployment, /livenessProbe:/);
  assert.match(deployment, /path: \/healthz/);
  assert.match(deployment, /resources:/);
  assert.match(deployment, /automountServiceAccountToken: false/);
  assert.match(deployment, /imagePullSecrets:/);
  assert.match(deployment, /toYaml \.Values\.securityContext/);
  assert.match(values, /readOnlyRootFilesystem: true/);
  assert.doesNotMatch(deployment, /value:\s*['"]?https?:\/\/[^\s]+supabase/);
});

test("release is a thin bounded exact-tag central workflow caller", () => {
  assert.match(releaseWorkflow, /run-name: Publish tagged dashboard release \$\{\{ github\.ref_name \}\}/);
  assert.match(releaseWorkflow, /group: agent-state-dashboard-release-\$\{\{ github\.ref_name \}\}/);
  assert.match(releaseWorkflow, /cancel-in-progress: false/);
  assert.match(releaseWorkflow, new RegExp(`reusable-tag-image-chart\\.yml@${publisherSha}`));
  assert.doesNotMatch(releaseWorkflow, /reusable-tag-image-chart\.yml@main/);
  assert.match(releaseWorkflow, /image_name: agent-state-dashboard/);
  assert.match(releaseWorkflow, /chart_path: charts\/agent-state-dashboard/);
  assert.match(releaseWorkflow, /FORGEJO_REGISTRY_USERNAME/);
  assert.match(releaseWorkflow, /FORGEJO_REGISTRY_TOKEN/);
  assert.doesNotMatch(releaseWorkflow, /runs-on:/);
  assert.doesNotMatch(releaseWorkflow, /latest/);
});

test("local credential scratch files stay out of Git and image contexts", () => {
  for (const ignore of [gitIgnore, dockerIgnore]) {
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^\.dev\.vars$/m);
    assert.match(ignore, /^\.dev\.vars\.\*$/m);
    assert.match(ignore, /^\.npmrc$/m);
  }
});

test("package scripts no longer encode a Cloudflare Pages deployment path", () => {
  const scripts = packageJson.scripts ?? {};
  for (const name of Object.keys(scripts)) assert.doesNotMatch(name, /^pages:/);
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /wrangler\s+pages|pages functions/i);
});
