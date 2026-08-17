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

test("container builds with Node but runs only pinned NGINX", () => {
  assert.match(dockerfile, new RegExp(`ARG NODE_VERSION=${nodeVersion.replaceAll(".", "\\.")}`));
  const pinnedNodeBases = dockerfile.match(
    /FROM node:\$\{NODE_VERSION\}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b/g,
  );
  assert.equal(pinnedNodeBases?.length, 1);
  assert.match(dockerfile, /ARG NGINX_VERSION=1\.29\.8/);
  assert.match(
    dockerfile,
    /FROM nginx:\$\{NGINX_VERSION\}-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime/,
  );
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /test -f out\/index\.html/);
  assert.match(dockerfile, /test -d out\/_next\/static/);
  assert.match(dockerfile, /COPY --from=build \/workspace\/out\/ \/usr\/share\/nginx\/html\//);
  assert.match(dockerfile, /COPY docker\/nginx\.conf \/etc\/nginx\/templates\/nginx\.conf\.template/);
  assert.match(dockerfile, /COPY docker\/security-headers\.conf \/etc\/nginx\/security-headers\.conf/);
  assert.match(dockerfile, /USER 101/);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /HEALTHCHECK[^\n]*--interval=30s/);
  assert.match(dockerfile, /127\.0\.0\.1:8080\/healthz/);
  assert.match(dockerfile, /STOPSIGNAL SIGQUIT/);
  assert.doesNotMatch(dockerfile, /npm ci --omit=dev|\/app\/server|opt\/dashboard\/server|tini|AS runtime[\s\S]*FROM node/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*server\//);

  assert.match(entrypoint, /SUPABASE_URL must be supplied by the Kubernetes Secret/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEY must be supplied by the Kubernetes Secret/);
  assert.match(entrypoint, /\^https\?\:\/\//);
  assert.match(entrypoint, /A-Za-z0-9\._-/);
  assert.match(entrypoint, /SUPABASE_URL="\$\{SUPABASE_URL%\/\}"/);
  assert.match(entrypoint, /envsubst '\$\{SUPABASE_URL\} \$\{SUPABASE_SECRET_KEY\}'/);
  assert.match(entrypoint, /\/tmp\/nginx\.conf/);
  assert.match(entrypoint, /umask 077/);
  assert.match(entrypoint, /\/tmp\/nginx\/client_temp/);
  assert.match(entrypoint, /\/tmp\/nginx\/proxy_temp/);
  assert.match(entrypoint, /unset SUPABASE_URL SUPABASE_SECRET_KEY/);
  assert.match(entrypoint, /exec nginx -c "\$\{nginx_config\}" -g 'daemon off;'/);
  assert.doesNotMatch(entrypoint, /SERVER_ENTRYPOINT|SERVER_PORT|\bnode\b|kill -TERM|\bwait\b/);

  assert.doesNotMatch(
    `${dockerfile}\n${entrypoint}\n${nginx}`,
    /AGENT_STATE_SUPABASE_SECRET_KEY|TEAM_DOMAIN|POLICY_AUD|fvbaxyklaclgdzyhybbr/,
  );
});

test("static build identity rotates with the release version before immutable caching", () => {
  assert.match(nextConfigSource, /readFileSync\("package\.json", "utf8"\)/);
  assert.match(nextConfigSource, /generateBuildId:[^\n]*agent-state-dashboard-\$\{packageVersion\}/);
  assert.doesNotMatch(nextConfigSource, /agent-state-dashboard-static/);
});

test("NGINX exposes only the five-table read gateway plus Realtime and static UI", () => {
  assert.match(nginx, /^worker_processes 1;$/m);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /return 200 "ok\\n"/);
  assert.doesNotMatch(nginx, /dashboard_server|127\.0\.0\.1:8788|location \/api\/|location = \/events/);

  assert.match(nginx, /proxy_ssl_verify on/);
  assert.match(nginx, /proxy_ssl_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt/);
  assert.match(
    nginx,
    /location ~ \^\/supabase\/rest\/v1\/\(current_projects\|current_agents\|current_work\|current_resources\|current_coordination\)\/\?\$/,
  );
  assert.match(nginx, /\$request_method !~ \^\(GET\|HEAD\|OPTIONS\)\$/);
  assert.match(nginx, /if \(\$arg_apikey != ''\)/);
  assert.match(nginx, /rewrite \^\/supabase\/rest\/v1\/\(current_projects\|current_agents\|current_work\|current_resources\|current_coordination\)\/\?\$ \/rest\/v1\/\$1 break/);
  assert.match(nginx, /proxy_set_header apikey "\$\{SUPABASE_SECRET_KEY\}"/);
  assert.match(nginx, /proxy_set_header Authorization ""/);
  assert.match(nginx, /proxy_set_header X-HTTP-Method-Override ""/);
  assert.match(nginx, /proxy_pass \$\{SUPABASE_URL\};/);
  assert.match(nginx, /location = \/supabase\/rest\/v1 \{\s*return 404;/);
  assert.match(nginx, /location \/supabase\/rest\/v1\/ \{\s*return 404;/);

  assert.match(nginx, /map \$http_upgrade \$connection_upgrade/);
  assert.match(nginx, /map \$arg_vsn \$realtime_vsn/);
  assert.match(nginx, /'1\.0\.0' '&vsn=1\.0\.0'/);
  assert.match(nginx, /'2\.0\.0' '&vsn=2\.0\.0'/);
  assert.match(nginx, /map \$arg_log_level \$realtime_log_level/);
  assert.match(nginx, /'info' '&log_level=info'/);
  assert.match(nginx, /'warn' '&log_level=warn'/);
  assert.match(nginx, /'error' '&log_level=error'/);
  assert.match(nginx, /location = \/supabase\/realtime\/v1\/websocket/);
  assert.match(
    nginx,
    /set \$args "apikey=\$\{SUPABASE_SECRET_KEY\}\$\{realtime_vsn\}\$\{realtime_log_level\}"/,
  );
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_set_header Connection \$connection_upgrade/);
  assert.match(nginx, /proxy_set_header x-api-key "\$\{SUPABASE_SECRET_KEY\}"/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /proxy_read_timeout 1h/);
  assert.match(nginx, /proxy_send_timeout 1h/);
  assert.match(nginx, /proxy_pass \$\{SUPABASE_URL\}\/realtime\/v1\/websocket/);

  assert.equal((nginx.match(/proxy_set_header User-Agent "StreamScapeTV-Agent-State-Dashboard-Gateway\/1"/g) ?? []).length, 2);
  assert.equal((nginx.match(/error_log \/dev\/null emerg;/g) ?? []).length, 2);
  assert.equal((nginx.match(/access_log off;/g) ?? []).length, 3);

  assert.match(nginx, /location \/_next\/static\//);
  assert.match(nginx, /immutable/);
  assert.doesNotMatch(nginx, /^\s*expires\s/m);
  assert.match(nginx, /try_files \$uri \$uri\/ \$uri\.html \/index\.html/);

  const headerIncludes = nginx.match(/include \/etc\/nginx\/security-headers\.conf;/g);
  assert.equal(headerIncludes?.length, 5);
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

test("Helm workload matches the pure-NGINX runtime and keeps bounded security", () => {
  assert.match(deployment, /secretKeyRef:/);
  assert.match(deployment, /name: SUPABASE_URL/);
  assert.match(deployment, /name: SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(deployment, /name: (?:SERVER_HOST|SERVER_PORT|HOST|PORT)\b/);
  assert.doesNotMatch(deployment, /127\.0\.0\.1:8788|value: "8788"/);
  assert.match(deployment, /containerPort: 8080/);
  assert.match(deployment, /readinessProbe:/);
  assert.match(deployment, /livenessProbe:/);
  assert.match(deployment, /path: \/healthz/);
  assert.match(deployment, /mountPath: \/tmp/);
  assert.match(deployment, /emptyDir:/);
  assert.match(deployment, /sizeLimit: 32Mi/);
  assert.match(deployment, /resources:/);
  assert.match(deployment, /automountServiceAccountToken: false/);
  assert.match(deployment, /imagePullSecrets:/);
  assert.match(deployment, /toYaml \.Values\.securityContext/);
  assert.match(deployment, /if \.Values\.image\.digest/);
  assert.match(deployment, /image: "\{\{ \.Values\.image\.repository \}\}@\{\{ \.Values\.image\.digest \}\}"/);
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
