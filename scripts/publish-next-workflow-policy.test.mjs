import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validatePublicationEnvironment } from "./assert-npm-publication-artifact.mjs";
import {
  validatePublishNextReadiness,
  validatePublishSourceCommit,
} from "./assert-publish-next-safe.mjs";
import { calculateArchiveHashes, validatePackResult } from "./prepare-npm-publication.mjs";
import { validatePublishNextWorkflow } from "./publish-next-workflow-policy.mjs";
import {
  registryAvailabilityPolicy,
  validateProvenanceAttestations,
  validatePublicationReceipt,
  validateRegistryMetadata,
  waitForVerifiedPublication,
} from "./verify-npm-publication.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(
  resolve(repositoryRoot, ".github/workflows/publish-next.yml"),
  "utf8",
);
const commit = "a".repeat(40);
const publicManifest = {
  name: "@slicemedia/swiper-adapter",
  version: "0.2.0",
  private: false,
  publishConfig: { access: "public", provenance: true },
};
const prepareEnvironment = {
  GITHUB_REPOSITORY: "slicemedia/swiper-adapter",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_RELEASE_REF: "refs/heads/main",
  GITHUB_RELEASE_SHA: commit,
  SLICEMEDIA_NPM_PUBLISH_NEXT_ENABLED: "true",
};
const publishEnvironment = {
  ...prepareEnvironment,
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: commit,
  SLICEMEDIA_RELEASE_ENVIRONMENT: "npm-next",
};
const provenancePredicateType = "https://slsa.dev/provenance/v1";

function createRegistryMetadata(hashes) {
  return {
    name: publicManifest.name,
    versions: {
      [publicManifest.version]: {
        name: publicManifest.name,
        version: publicManifest.version,
        dist: {
          ...hashes,
          attestations: {
            url: `https://registry.npmjs.org/-/npm/v1/attestations/${globalThis.encodeURIComponent(publicManifest.name)}@${publicManifest.version}`,
            provenance: { predicateType: provenancePredicateType },
          },
          tarball: "https://registry.npmjs.org/example.tgz",
        },
      },
    },
    "dist-tags": { next: publicManifest.version },
  };
}

function createProvenanceDocument(hashes, sourceCommit = commit) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/%40slicemedia/swiper-adapter@${publicManifest.version}`,
        digest: {
          sha512: Buffer.from(hashes.integrity.slice("sha512-".length), "base64").toString("hex"),
        },
      },
    ],
    predicateType: provenancePredicateType,
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/slicemedia/swiper-adapter",
            path: ".github/workflows/publish-next.yml",
          },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/slicemedia/swiper-adapter@refs/heads/main",
            digest: { gitCommit: sourceCommit },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
      },
    },
  };
  return {
    attestations: [
      {
        predicateType: provenancePredicateType,
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
            signatures: [{ sig: "synthetic-signature" }],
          },
        },
      },
    ],
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("accepts only token-free preparation, minimal OIDC publication, and no-OIDC verification", () => {
  assert.deepEqual(validatePublishNextWorkflow(workflow), []);
  assert.deepEqual(
    validatePublishNextReadiness({
      environment: prepareEnvironment,
      manifest: publicManifest,
      workflowSource: workflow,
    }),
    [],
  );
  assert.deepEqual(validatePublicationEnvironment(publishEnvironment, publicManifest), []);
});

test("fails closed unless the reviewed global npm is first on PATH for preparation", () => {
  assert.equal(workflow.match(/npm_global_prefix="\$\(npm prefix -g\)"/gu)?.length, 1);
  const mutations = [
    (source) => source.replace('"$npm_global_prefix" != /*', '"$npm_global_prefix" == ""'),
    (source) => source.replace('! -x "$npm_global_bin/npm"', '! -e "$npm_global_bin/npm"'),
    (source) => source.replace('export PATH="$npm_global_bin:$PATH"', 'export PATH="$PATH"'),
    (source) => source.replace('"$(command -v npm)" != "$npm_global_bin/npm" || ', ""),
    (source) => source.replace('"$(npm --version)" != "11.19.0"', '"11.19.0" != "11.19.0"'),
    (source) => source.replace('"$GITHUB_PATH" != /*', '"$GITHUB_PATH" == ""'),
    (source) =>
      source.replace(
        'printf \'%s\\n\' "$npm_global_bin" >> "$GITHUB_PATH"',
        'printf \'%s\\n\' "$PATH" >> "$GITHUB_PATH"',
      ),
    (source) => source.replace("        run: |\n", "        run: >\n"),
    (source) =>
      source.replace(
        "      - run: pnpm install --frozen-lockfile",
        "      - run: |\n          pnpm install --frozen-lockfile",
      ),
  ];
  for (const mutate of mutations) {
    const mutated = mutate(workflow);
    assert.notEqual(mutated, workflow);
    assert.notDeepEqual(validatePublishNextWorkflow(mutated), []);
  }
});

test("rejects changes to every publish trust boundary", () => {
  const mutations = [
    (source) => source.replace("  workflow_dispatch:", "  push:\n    tags:\n      - v*"),
    (source) => source.replace("environment: release-sanitize", "environment: production"),
    (source) => source.replace("environment: npm-next", "environment: production"),
    (source) => source.replace("id-token: write", "id-token: none"),
    (source) =>
      source.replace(
        "  prepare:\n    if:",
        "  prepare:\n    permissions:\n      id-token: write\n    if:",
      ),
    (source) => source.replace("persist-credentials: false", "persist-credentials: true"),
    (source) => source.replace("fetch-depth: 0", "fetch-depth: 1"),
    (source) => source.replace("runtime: node@24", "runtime: node@latest"),
    (source) => source.replace("npm@11.19.0", "npm@12.0.0"),
    (source) => source.replace("timeout-minutes: 25", "timeout-minutes: 10"),
    (source) =>
      source.replace("${{ secrets.SLICEMEDIA_FORBIDDEN_TERMS }}", "${{ secrets.UNRELATED_VALUE }}"),
    (source) => source.replace('= "11.19.0"', '= "11.19.1"'),
    (source) => source.replace("--tag next", "--tag latest"),
    (source) => source.replace("npm publish .npm-release/package.tgz", "npm publish"),
    (source) =>
      source.replace(
        "--registry https://registry.npmjs.org/",
        "--registry https://registry.example.test/",
      ),
    (source) =>
      source.replace(
        "      - run: npm publish .npm-release/package.tgz --ignore-scripts --tag next --access public --provenance --registry https://registry.npmjs.org/ --userconfig /dev/null",
        "      - run: npm publish .npm-release/package.tgz --ignore-scripts --tag next --access public --provenance --registry https://registry.npmjs.org/ --userconfig /dev/null\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
      ),
    (source) =>
      `${source}\n  unexpected:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release create v0.2.0\n`,
  ];
  for (const mutate of mutations) {
    const mutated = mutate(workflow);
    assert.notEqual(mutated, workflow);
    assert.notDeepEqual(validatePublishNextWorkflow(mutated), []);
  }
});

test("rejects private state, wrong refs, stale commits, disabled gates, and npm overrides", () => {
  const readinessCases = [
    { manifest: { ...publicManifest, private: true } },
    { environment: { ...prepareEnvironment, GITHUB_REPOSITORY_VISIBILITY: "private" } },
    { environment: { ...prepareEnvironment, GITHUB_RELEASE_REF: "refs/heads/feature" } },
    {
      environment: {
        ...prepareEnvironment,
        SLICEMEDIA_NPM_PUBLISH_NEXT_ENABLED: "false",
      },
    },
    { environment: { ...prepareEnvironment, NPM_TOKEN: "synthetic-token" } },
  ];
  for (const entry of readinessCases) {
    assert.notDeepEqual(
      validatePublishNextReadiness({
        environment: entry.environment ?? prepareEnvironment,
        manifest: entry.manifest ?? publicManifest,
        workflowSource: workflow,
      }),
      [],
    );
  }

  assert.deepEqual(
    validatePublishSourceCommit({ expected: commit, head: commit, remote: commit, status: "" }),
    [],
  );
  assert.notDeepEqual(
    validatePublishSourceCommit({
      expected: commit,
      head: commit,
      remote: "b".repeat(40),
      status: "",
    }),
    [],
  );
  assert.notDeepEqual(
    validatePublicationEnvironment(
      { ...publishEnvironment, npm_config_registry: "https://registry.example.test/" },
      publicManifest,
    ),
    [],
  );
});

test("binds pack output, receipt, source commit, and registry metadata to one exact archive", () => {
  const hashes = calculateArchiveHashes(Buffer.from("synthetic package archive"));
  const packResult = {
    name: publicManifest.name,
    version: publicManifest.version,
    filename: "synthetic.tgz",
    ...hashes,
  };
  assert.deepEqual(validatePackResult(packResult, publicManifest, hashes), []);

  const receipt = {
    schemaVersion: 1,
    name: publicManifest.name,
    version: publicManifest.version,
    archive: ".npm-release/package.tgz",
    npmVersion: "11.19.0",
    ...hashes,
    sourceCommit: commit,
  };
  assert.deepEqual(validatePublicationReceipt(receipt, publicManifest, hashes, commit), []);

  const metadata = createRegistryMetadata(hashes);
  const provenance = createProvenanceDocument(hashes);
  assert.deepEqual(
    validateRegistryMetadata(
      metadata,
      publicManifest.name,
      publicManifest.version,
      hashes.integrity,
      hashes.shasum,
    ),
    [],
  );
  assert.deepEqual(
    validateProvenanceAttestations(provenance, {
      commit,
      name: publicManifest.name,
      sha512: Buffer.from(hashes.integrity.slice("sha512-".length), "base64").toString("hex"),
      version: publicManifest.version,
    }),
    [],
  );
  assert.notDeepEqual(
    validateRegistryMetadata(
      metadata,
      publicManifest.name,
      publicManifest.version,
      "sha512-unrelated",
      hashes.shasum,
    ),
    [],
  );
  assert.notDeepEqual(
    validateProvenanceAttestations(createProvenanceDocument(hashes, "b".repeat(40)), {
      commit,
      name: publicManifest.name,
      sha512: Buffer.from(hashes.integrity.slice("sha512-".length), "base64").toString("hex"),
      version: publicManifest.version,
    }),
    [],
  );
  assert.notDeepEqual(
    validatePublicationReceipt(
      { ...receipt, sourceCommit: "b".repeat(40) },
      publicManifest,
      hashes,
      commit,
    ),
    [],
  );
  assert.notDeepEqual(
    validatePublicationReceipt(
      { ...receipt, npmVersion: "11.18.0" },
      publicManifest,
      hashes,
      commit,
    ),
    [],
  );
});

test("waits immediately at a fixed cadence for registry metadata and exact provenance", async () => {
  const hashes = calculateArchiveHashes(Buffer.from("synthetic package archive"));
  const metadata = createRegistryMetadata(hashes);
  const provenance = createProvenanceDocument(hashes);
  const registryUrl = `https://registry.npmjs.org/${globalThis.encodeURIComponent(publicManifest.name)}`;
  const events = [];
  let currentTime = 0;
  let registryRequests = 0;

  await waitForVerifiedPublication({
    expectedCommit: commit,
    expectedIntegrity: hashes.integrity,
    expectedName: publicManifest.name,
    expectedShasum: hashes.shasum,
    expectedVersion: publicManifest.version,
    fetchImpl: async (url) => {
      events.push(`fetch:${url}`);
      if (url === registryUrl) {
        registryRequests += 1;
        return registryRequests === 1 ? jsonResponse({}, 404) : jsonResponse(metadata);
      }
      return jsonResponse(provenance);
    },
    log: () => {},
    now: () => currentTime,
    sleep: async (delayMs) => {
      events.push(`sleep:${delayMs}`);
      currentTime += delayMs;
    },
  });

  assert.equal(events[0], `fetch:${registryUrl}`);
  assert.equal(events[1], `sleep:${registryAvailabilityPolicy.retryDelayMs}`);
  assert.equal(registryRequests, 2);
  assert.equal(currentTime, registryAvailabilityPolicy.retryDelayMs);
});

test("bounds registry polling to the reviewed 18-minute availability window", async () => {
  const hashes = calculateArchiveHashes(Buffer.from("synthetic package archive"));
  const delays = [];
  let currentTime = 0;
  let requests = 0;

  await assert.rejects(
    waitForVerifiedPublication({
      expectedCommit: commit,
      expectedIntegrity: hashes.integrity,
      expectedName: publicManifest.name,
      expectedShasum: hashes.shasum,
      expectedVersion: publicManifest.version,
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({}, 404);
      },
      log: () => {},
      now: () => currentTime,
      sleep: async (delayMs) => {
        delays.push(delayMs);
        currentTime += delayMs;
      },
    }),
    /not verifiable within 18 minutes/u,
  );

  assert.deepEqual(registryAvailabilityPolicy, {
    pollingWindowMs: 18 * 60_000,
    requestTimeoutMs: 10_000,
    retryDelayMs: 15_000,
  });
  assert.equal(requests, 73);
  assert.equal(delays.length, 72);
  assert.ok(delays.every((delayMs) => delayMs === 15_000));
  assert.equal(
    delays.reduce((total, delayMs) => total + delayMs, 0),
    18 * 60_000,
  );
});
