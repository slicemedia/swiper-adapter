import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedRepository = "slicemedia/swiper-adapter";
const expectedPackage = "@slicemedia/swiper-adapter";

const checkoutAction = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const pnpmSetupAction = "pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2";
const changesetsVersionAction =
  "changesets/action/version@8488615a623b1b9c987934bb89eae8af6a946ac1";

const prohibitedCredentialVariables = [
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "NODE_AUTH_TOKEN",
  "NPM_CONFIG__AUTH",
  "NPM_CONFIG__AUTHTOKEN",
  "NPM_TOKEN",
  "YARN_NPM_AUTH_TOKEN",
];

const prohibitedStringPatterns = [
  ["secret context", /\bsecrets\s*\./iu],
  [
    "registry credential",
    /\b(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG__AUTH(?:TOKEN)?|YARN_NPM_AUTH_TOKEN)\b/iu,
  ],
  ["OIDC token request", /\bACTIONS_ID_TOKEN_REQUEST_(?:TOKEN|URL)\b/iu],
  ["npm publication command", /\b(?:npm|pnpm)\s+publish\b/iu],
  ["Yarn publication command", /\byarn\s+npm\s+publish\b/iu],
  ["Changesets publication command", /\bchangesets?\s+publish\b/iu],
  ["npm release mutation", /\bnpm\s+(?:access|deprecate|dist-tag|unpublish)\b/iu],
  ["Git tag command", /\bgit\s+tag\b/iu],
  ["Git tag push", /\bgit\s+push\b[^\n]*(?:--tags|refs\/tags\/)/iu],
  ["GitHub release command", /\bgh\s+release\b/iu],
  ["GitHub Releases API call", /\bgh\s+api\b[^\n]*\/releases(?:\b|\/)/iu],
  ["Changesets publish action", /\bchangesets\/action\/publish@/iu],
  ["combined Changesets action", /\bchangesets\/action@/iu],
  [
    "release creation action",
    /\b(?:actions\/create-release|ncipollo\/release-action|softprops\/action-gh-release)@/iu,
  ],
];

const expectedSteps = [
  {
    uses: checkoutAction,
    with: { "fetch-depth": 0, "persist-credentials": false },
  },
  {
    run: "node scripts/sanitize.mjs",
    env: {
      SLICEMEDIA_FORBIDDEN_TERMS: "${{ secrets.SLICEMEDIA_FORBIDDEN_TERMS }}",
      SLICEMEDIA_REQUIRE_FORBIDDEN_TERMS: "true",
    },
  },
  {
    uses: pnpmSetupAction,
    with: {
      version: "11.21.0",
      runtime: "node@22",
      cache: true,
      install: false,
    },
  },
  { run: "pnpm install --frozen-lockfile" },
  {
    run: "pnpm release:prepare:check",
    env: {
      GITHUB_REPOSITORY_VISIBILITY: "${{ github.event.repository.visibility }}",
    },
  },
  {
    uses: changesetsVersionAction,
    with: {
      script: "pnpm version-packages",
      "commit-message": "chore: version Swiper Adapter",
      "pr-title": "chore: version Swiper Adapter",
      "pr-draft": "create",
    },
  },
];

const readJson = async (relativePath) =>
  JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8"));

const formatPath = (path) => path.join(".");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateExactKeys(value, expectedKeys, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${formatPath(path)} must be a mapping.`);
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actualKeys, sortedExpectedKeys)) {
    errors.push(
      `${formatPath(path)} must contain exactly ${sortedExpectedKeys.join(", ") || "no keys"}; received ${actualKeys.join(", ") || "no keys"}.`,
    );
    return false;
  }
  return true;
}

function validateExactValue(actual, expected, path, errors) {
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${formatPath(path)} does not match the reviewed version-PR contract.`);
  }
}

function inspectProhibitedPaths(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectProhibitedPaths(entry, [...path, String(index)], errors),
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path, key];
    if (key === "id-token") {
      errors.push(`${formatPath(entryPath)} is a prohibited OIDC permission.`);
    }
    if (key === "tags" || key === "tags-ignore") {
      errors.push(`${formatPath(entryPath)} is a prohibited tag path.`);
    }
    if (path.length === 2 && path[0] === "jobs" && key === "uses") {
      errors.push(`${formatPath(entryPath)} is a prohibited job-level reusable-workflow call.`);
    }
    if (/(?:^|[-_])(?:auth|credential|password|secret|token)(?:$|[-_])/iu.test(key)) {
      errors.push(`${formatPath(entryPath)} is a prohibited credential path.`);
    }

    if (typeof entry === "string") {
      for (const [label, pattern] of prohibitedStringPatterns) {
        const isReviewedPrivateDenylist =
          formatPath(entryPath) === "jobs.version.steps.1.env.SLICEMEDIA_FORBIDDEN_TERMS" &&
          entry === "${{ secrets.SLICEMEDIA_FORBIDDEN_TERMS }}";
        if (!isReviewedPrivateDenylist && pattern.test(entry)) {
          errors.push(`${formatPath(entryPath)} contains a prohibited ${label}.`);
        }
      }
    }
    inspectProhibitedPaths(entry, entryPath, errors);
  }
}

function validateStepSyntax(document, errors) {
  const stepsNode = document.getIn(["jobs", "version", "steps"], true);
  if (!isSeq(stepsNode)) return;

  if (stepsNode.flow === true) {
    errors.push("jobs.version.steps must not use flow-style YAML.");
  }

  stepsNode.items.forEach((stepNode, index) => {
    if (!isMap(stepNode)) return;
    if (stepNode.flow === true) {
      errors.push(`jobs.version.steps.${index} must not use flow-style YAML.`);
    }

    const runNode = stepNode.get("run", true);
    if (
      isScalar(runNode) &&
      (runNode.type === "BLOCK_FOLDED" || runNode.type === "BLOCK_LITERAL")
    ) {
      errors.push(
        `jobs.version.steps.${index}.run must be a one-line plain scalar, not a multiline block.`,
      );
    }
  });
}

function validateWorkflowShape(workflow, errors) {
  if (
    !validateExactKeys(
      workflow,
      ["name", "on", "permissions", "concurrency", "jobs"],
      ["workflow"],
      errors,
    )
  ) {
    return;
  }

  validateExactValue(workflow.name, "Release PR", ["name"], errors);

  if (validateExactKeys(workflow.on, ["push"], ["on"], errors)) {
    if (validateExactKeys(workflow.on.push, ["branches"], ["on", "push"], errors)) {
      validateExactValue(workflow.on.push.branches, ["main"], ["on", "push", "branches"], errors);
    }
  }

  validateExactKeys(workflow.permissions, [], ["permissions"], errors);

  if (
    validateExactKeys(
      workflow.concurrency,
      ["group", "cancel-in-progress"],
      ["concurrency"],
      errors,
    )
  ) {
    validateExactValue(
      workflow.concurrency.group,
      "swiper-adapter-release-pr",
      ["concurrency", "group"],
      errors,
    );
    validateExactValue(
      workflow.concurrency["cancel-in-progress"],
      false,
      ["concurrency", "cancel-in-progress"],
      errors,
    );
  }

  if (!validateExactKeys(workflow.jobs, ["version"], ["jobs"], errors)) {
    return;
  }

  const versionJob = workflow.jobs.version;
  if (
    !validateExactKeys(
      versionJob,
      ["if", "environment", "runs-on", "permissions", "steps"],
      ["jobs", "version"],
      errors,
    )
  ) {
    return;
  }

  validateExactValue(
    versionJob.if,
    "vars.SLICEMEDIA_RELEASE_PR_ENABLED == 'true' && github.repository == 'slicemedia/swiper-adapter'",
    ["jobs", "version", "if"],
    errors,
  );
  validateExactValue(
    versionJob.environment,
    "release-sanitize",
    ["jobs", "version", "environment"],
    errors,
  );
  validateExactValue(
    versionJob["runs-on"],
    "ubuntu-latest",
    ["jobs", "version", "runs-on"],
    errors,
  );

  if (
    validateExactKeys(
      versionJob.permissions,
      ["contents", "pull-requests"],
      ["jobs", "version", "permissions"],
      errors,
    )
  ) {
    validateExactValue(
      versionJob.permissions.contents,
      "write",
      ["jobs", "version", "permissions", "contents"],
      errors,
    );
    validateExactValue(
      versionJob.permissions["pull-requests"],
      "write",
      ["jobs", "version", "permissions", "pull-requests"],
      errors,
    );
  }

  if (!Array.isArray(versionJob.steps)) {
    errors.push("jobs.version.steps must be a sequence.");
    return;
  }
  if (versionJob.steps.length !== expectedSteps.length) {
    errors.push(
      `jobs.version.steps must contain exactly ${expectedSteps.length} reviewed steps in order.`,
    );
  }
  for (let index = 0; index < expectedSteps.length; index += 1) {
    if (index >= versionJob.steps.length) break;
    validateExactValue(
      versionJob.steps[index],
      expectedSteps[index],
      ["jobs", "version", "steps", String(index)],
      errors,
    );
  }
}

export function validateReleasePreparation({ environment, manifest, workflowSource }) {
  const errors = [];
  const visibility = environment.GITHUB_REPOSITORY_VISIBILITY;
  if (visibility !== "private" && visibility !== "public") {
    errors.push(
      `Release preparation requires an explicit private or public repository visibility; received ${JSON.stringify(visibility)}.`,
    );
  }
  if (
    environment.GITHUB_REPOSITORY !== undefined &&
    environment.GITHUB_REPOSITORY !== expectedRepository
  ) {
    errors.push(`Release preparation is restricted to ${expectedRepository}.`);
  }
  for (const variable of prohibitedCredentialVariables) {
    if (environment[variable]?.trim()) {
      errors.push(`${variable} must not be available to the version-PR workflow.`);
    }
  }

  if (manifest.name !== expectedPackage) {
    errors.push("Release preparation is restricted to the Swiper Adapter package.");
  }
  const document = parseDocument(workflowSource, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  for (const error of document.errors) {
    errors.push(`Version-PR workflow is invalid YAML: ${error.message}`);
  }
  if (document.errors.length > 0) return errors;

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    errors.push(`Version-PR workflow cannot use YAML aliases: ${error.message}`);
    return errors;
  }

  validateStepSyntax(document, errors);
  inspectProhibitedPaths(workflow, [], errors);
  validateWorkflowShape(workflow, errors);
  return errors;
}

async function main() {
  const manifest = await readJson("package.json");
  const workflowSource = await readFile(
    resolve(repositoryRoot, ".github/workflows/release-pr.yml"),
    "utf8",
  );
  const errors = validateReleasePreparation({
    environment: process.env,
    manifest,
    workflowSource,
  });

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.info("Version-PR release preparation is fail-closed; npm publication is disabled.");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
