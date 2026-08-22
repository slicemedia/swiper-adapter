import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleasePreparation } from "./assert-release-preparation-safe.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repositoryRoot, "scripts/assert-release-preparation-safe.mjs");
const workflowSource = await readFile(
  resolve(repositoryRoot, ".github/workflows/release-pr.yml"),
  "utf8",
);
const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const safeEnvironment = {
  GITHUB_REPOSITORY: "slicemedia/swiper-adapter",
  GITHUB_REPOSITORY_VISIBILITY: "private",
};

const checkoutAction = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

function validate(source = workflowSource, environment = safeEnvironment) {
  return validateReleasePreparation({
    environment,
    manifest,
    workflowSource: source,
  });
}

function expectMutationRejected(label, mutate, expectedError) {
  const mutated = mutate(workflowSource);
  assert.notEqual(mutated, workflowSource, `${label} mutation did not change the workflow`);
  const errors = validate(mutated);
  assert.notEqual(errors.length, 0, `${label} mutation was accepted`);
  assert.match(errors.join("\n"), expectedError);
}

describe("private release preparation", () => {
  it("accepts the exact pinned version-only workflow for the private repository", async () => {
    assert.deepEqual(validate(), []);

    const result = await run({
      GITHUB_REPOSITORY: "slicemedia/swiper-adapter",
      GITHUB_REPOSITORY_VISIBILITY: "private",
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /npm publication is disabled/u);
  });

  it("accepts the version-only workflow after the repository and package become public", () => {
    assert.deepEqual(
      validateReleasePreparation({
        environment: { ...safeEnvironment, GITHUB_REPOSITORY_VISIBILITY: "public" },
        manifest: { ...manifest, private: false },
        workflowSource,
      }),
      [],
    );
  });

  it("fails closed when repository visibility is missing or unsupported", () => {
    const errors = validate(workflowSource, {
      ...safeEnvironment,
      GITHUB_REPOSITORY_VISIBILITY: "internal",
    });

    assert.match(
      errors.join("\n"),
      /requires an explicit private or public repository visibility/u,
    );
  });

  it("rejects npm and OIDC credentials in the version-PR environment", () => {
    for (const variable of [
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "NODE_AUTH_TOKEN",
      "NPM_TOKEN",
      "YARN_NPM_AUTH_TOKEN",
    ]) {
      const errors = validate(workflowSource, {
        ...safeEnvironment,
        [variable]: "test-only-token",
      });
      assert.match(errors.join("\n"), new RegExp(`${variable} must not be available`, "u"));
    }
  });

  it("rejects extra jobs and extra root capabilities", () => {
    expectMutationRejected(
      "extra job",
      (source) => `${source}\n  publish:\n    runs-on: ubuntu-latest\n    steps: []\n`,
      /jobs must contain exactly version/u,
    );
    expectMutationRejected(
      "extra root key",
      (source) => `${source}\nenv: {}\n`,
      /workflow must contain exactly/u,
    );
  });

  it("rejects trigger, permission, concurrency, and activation-gate mutations", () => {
    expectMutationRejected(
      "tag trigger",
      (source) => source.replace("    branches: [main]", "    branches: [main]\n    tags: [v*]"),
      /prohibited tag path/u,
    );
    expectMutationRejected(
      "manual trigger",
      (source) => source.replace("on:\n", "on:\n  workflow_dispatch:\n"),
      /on must contain exactly/u,
    );
    expectMutationRejected(
      "OIDC permission",
      (source) => source.replace("permissions: {}", "permissions:\n  id-token: write"),
      /prohibited OIDC permission/u,
    );
    expectMutationRejected(
      "concurrency",
      (source) => source.replace("cancel-in-progress: false", "cancel-in-progress: true"),
      /concurrency.cancel-in-progress does not match/u,
    );
    expectMutationRejected(
      "activation gate",
      (source) => source.replace("vars.SLICEMEDIA_RELEASE_PR_ENABLED == 'true' &&\n      ", ""),
      /jobs.version.if does not match/u,
    );
    expectMutationRejected(
      "secret environment",
      (source) => source.replace("environment: release-sanitize", "environment: production"),
      /jobs.version.environment does not match/u,
    );
  });

  it("rejects job-level reusable workflows", () => {
    expectMutationRejected(
      "reusable workflow",
      (source) =>
        source.replace(
          "  version:\n",
          "  version:\n    uses: octo-org/example/.github/workflows/release.yml@main\n",
        ),
      /prohibited job-level reusable-workflow call/u,
    );
  });

  it("rejects flow-style steps even when they parse to the reviewed value", () => {
    expectMutationRejected(
      "flow-style step mapping",
      (source) =>
        source.replace(
          `      - uses: ${checkoutAction} # v7\n        with:\n          fetch-depth: 0\n          persist-credentials: false`,
          `      - { uses: ${checkoutAction}, with: { fetch-depth: 0, persist-credentials: false } }`,
        ),
      /steps\.0 must not use flow-style YAML/u,
    );
    expectMutationRejected(
      "flow-style steps sequence",
      (source) =>
        source.replace(
          / {4}steps:\n(?:.|\n)*$/u,
          "    steps: [{ run: pnpm install --frozen-lockfile }]\n",
        ),
      /jobs\.version\.steps must not use flow-style YAML/u,
    );
  });

  it("rejects multiline run payloads even when YAML folds to the reviewed command", () => {
    expectMutationRejected(
      "folded run",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: >-\n          pnpm install --frozen-lockfile",
        ),
      /one-line plain scalar/u,
    );
    expectMutationRejected(
      "literal run",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: |-\n          pnpm install --frozen-lockfile",
        ),
      /one-line plain scalar/u,
    );
  });

  it("rejects reordered, unpinned, missing, and additional steps", () => {
    expectMutationRejected(
      "missing private denylist",
      (source) =>
        source.replace(
          "${{ secrets.SLICEMEDIA_FORBIDDEN_TERMS }}",
          "${{ secrets.UNRELATED_VALUE }}",
        ),
      /steps\.1 does not match/u,
    );
    expectMutationRejected(
      "persisted checkout credentials",
      (source) => source.replace("persist-credentials: false", "persist-credentials: true"),
      /steps\.0 does not match/u,
    );
    expectMutationRejected(
      "unpinned action",
      (source) => source.replace(checkoutAction, "actions/checkout@v7"),
      /steps\.0 does not match/u,
    );
    expectMutationRejected(
      "changed command",
      (source) =>
        source.replace("pnpm install --frozen-lockfile", "pnpm install --no-frozen-lockfile"),
      /steps\.3 does not match/u,
    );
    expectMutationRejected(
      "additional step",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n      - run: echo unexpected",
        ),
      /exactly 6 reviewed steps/u,
    );
    expectMutationRejected(
      "additional uses step",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n      - uses: example/release-action@0123456789abcdef0123456789abcdef01234567",
        ),
      /exactly 6 reviewed steps/u,
    );
  });

  it("rejects credential, publish, tag, and release paths", () => {
    expectMutationRejected(
      "secret credential",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}",
        ),
      /prohibited credential path/u,
    );
    expectMutationRejected(
      "npm publish",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n      - run: npm publish",
        ),
      /prohibited npm publication command/u,
    );
    expectMutationRejected(
      "tag creation",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n      - run: git tag v0.1.1",
        ),
      /prohibited Git tag command/u,
    );
    expectMutationRejected(
      "GitHub release creation",
      (source) =>
        source.replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - run: pnpm install --frozen-lockfile\n      - run: gh release create v0.1.1",
        ),
      /prohibited GitHub release command/u,
    );
    expectMutationRejected(
      "combined Changesets action",
      (source) =>
        source.replace(
          "changesets/action/version@8488615a623b1b9c987934bb89eae8af6a946ac1",
          "changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1",
        ),
      /prohibited combined Changesets action/u,
    );
  });

  it("rejects aliases and duplicate keys", () => {
    expectMutationRejected(
      "alias",
      (source) =>
        source.replace("permissions: {}", "permissions: &permissions {}\nextra: *permissions"),
      /cannot use YAML aliases/u,
    );
    expectMutationRejected("duplicate jobs", (source) => `${source}\njobs: {}\n`, /invalid YAML/u);
  });
});

function run(additionalEnvironment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "",
        ACTIONS_ID_TOKEN_REQUEST_URL: "",
        NODE_AUTH_TOKEN: "",
        NPM_CONFIG__AUTH: "",
        NPM_CONFIG__AUTHTOKEN: "",
        NPM_TOKEN: "",
        YARN_NPM_AUTH_TOKEN: "",
        ...additionalEnvironment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ code, stderr, stdout }));
  });
}
