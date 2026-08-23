import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivePath = resolve(repositoryRoot, ".npm-release/package.tgz");
const receiptPath = resolve(repositoryRoot, ".npm-release/receipt.json");
const registryOrigin = "https://registry.npmjs.org";
const provenancePredicateType = "https://slsa.dev/provenance/v1";
const provenanceSource = Object.freeze({
  builder: "https://github.com/actions/runner/github-hosted",
  ref: "refs/heads/main",
  repository: "https://github.com/slicemedia/swiper-adapter",
  workflowPath: ".github/workflows/publish-next.yml",
});

export const registryAvailabilityPolicy = Object.freeze({
  pollingWindowMs: 18 * 60_000,
  requestTimeoutMs: 10_000,
  retryDelayMs: 15_000,
});

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const archive = await readFile(archivePath);
  const hashes = {
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    shasum: createHash("sha1").update(archive).digest("hex"),
  };
  const receiptErrors = validatePublicationReceipt(
    receipt,
    manifest,
    hashes,
    process.env.GITHUB_RELEASE_SHA,
  );
  if (receiptErrors.length > 0) throw new Error(receiptErrors.join(" "));

  await waitForVerifiedPublication({
    expectedCommit: receipt.sourceCommit,
    expectedIntegrity: receipt.integrity,
    expectedName: manifest.name,
    expectedShasum: receipt.shasum,
    expectedVersion: manifest.version,
  });
  console.info(
    `Verified ${manifest.name}@${manifest.version}: npm integrity, next dist-tag, and exact SLSA provenance match the reviewed archive and source commit.`,
  );
}

export async function waitForVerifiedPublication({
  expectedCommit,
  expectedIntegrity,
  expectedName,
  expectedShasum,
  expectedVersion,
  fetchImpl = globalThis.fetch,
  log = (message) => console.info(message),
  now = () => Date.now(),
  sleep = setTimeout,
}) {
  const expectedSha512 = sha512HexFromIntegrity(expectedIntegrity);
  if (expectedSha512 === null) throw new Error("Expected npm integrity is not a SHA-512 digest.");

  const registryUrl = `${registryOrigin}/${globalThis.encodeURIComponent(expectedName)}`;
  const startedAt = now();
  const deadline = startedAt + registryAvailabilityPolicy.pollingWindowMs;
  const maximumAttempts =
    Math.floor(
      registryAvailabilityPolicy.pollingWindowMs / registryAvailabilityPolicy.retryDelayMs,
    ) + 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const metadata = await fetchJson(fetchImpl, registryUrl, deadline, now, {
        accept: "application/vnd.npm.install-v1+json",
      });
      const metadataErrors = validateRegistryMetadata(
        metadata,
        expectedName,
        expectedVersion,
        expectedIntegrity,
        expectedShasum,
      );
      if (metadataErrors.length > 0) throw new Error(metadataErrors.join(" "));

      const attestationUrl = metadata.versions[expectedVersion].dist.attestations.url;
      const attestations = await fetchJson(fetchImpl, attestationUrl, deadline, now, {
        accept: "application/json",
      });
      const provenanceErrors = validateProvenanceAttestations(attestations, {
        commit: expectedCommit,
        name: expectedName,
        sha512: expectedSha512,
        version: expectedVersion,
      });
      if (provenanceErrors.length > 0) throw new Error(provenanceErrors.join(" "));
      return;
    } catch (error) {
      const remainingMs = deadline - now();
      if (attempt === maximumAttempts || remainingMs <= 0) {
        throw new Error(
          `npm publication was not verifiable within ${registryAvailabilityPolicy.pollingWindowMs / 60_000} minutes: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      const delayMs = Math.min(registryAvailabilityPolicy.retryDelayMs, remainingMs);
      log(
        `npm publication is not verifiable yet (attempt ${attempt}/${maximumAttempts}); retrying in ${delayMs / 1_000} seconds.`,
      );
      await sleep(delayMs);
    }
  }
}

export function validatePublicationReceipt(receipt, manifest, hashes, expectedCommit) {
  const errors = [];
  const expectedKeys = [
    "archive",
    "integrity",
    "name",
    "npmVersion",
    "schemaVersion",
    "shasum",
    "sourceCommit",
    "version",
  ];
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys)
  ) {
    errors.push("Publication receipt does not match schema 1 exactly.");
    return errors;
  }
  if (receipt.schemaVersion !== 1) errors.push("Publication receipt has an unexpected schema.");
  if (receipt.npmVersion !== "11.19.0") {
    errors.push("Publication receipt was not prepared with npm 11.19.0.");
  }
  if (receipt.name !== manifest.name || receipt.version !== manifest.version) {
    errors.push("Publication receipt package identity does not match the manifest.");
  }
  if (receipt.archive !== ".npm-release/package.tgz") {
    errors.push("Publication receipt does not reference the fixed release archive.");
  }
  if (receipt.integrity !== hashes.integrity || receipt.shasum !== hashes.shasum) {
    errors.push("Publication receipt does not match the exact local archive.");
  }
  if (!/^[0-9a-f]{40}$/u.test(expectedCommit ?? "") || receipt.sourceCommit !== expectedCommit) {
    errors.push("Publication receipt is not bound to GITHUB_RELEASE_SHA.");
  }
  return errors;
}

export function validateRegistryMetadata(
  metadata,
  expectedName,
  expectedVersion,
  expectedIntegrity,
  expectedShasum,
) {
  const errors = [];
  if (metadata?.name !== expectedName) errors.push("Registry package name does not match.");
  const published = metadata?.versions?.[expectedVersion];
  if (published?.name !== expectedName || published?.version !== expectedVersion) {
    errors.push("Registry does not contain the exact published package version.");
  }
  if (published?.dist?.integrity !== expectedIntegrity) {
    errors.push("Registry integrity does not match the exact local archive.");
  }
  if (published?.dist?.shasum !== expectedShasum) {
    errors.push("Registry shasum does not match the exact local archive.");
  }
  if (
    typeof published?.dist?.tarball !== "string" ||
    !published.dist.tarball.startsWith("https://")
  ) {
    errors.push("Registry metadata is missing a secure tarball URL.");
  }
  if (metadata?.["dist-tags"]?.next !== expectedVersion) {
    errors.push("The npm next dist-tag does not reference the published version.");
  }
  if (published?.dist?.attestations?.provenance?.predicateType !== provenancePredicateType) {
    errors.push("Registry metadata does not advertise SLSA provenance for the exact version.");
  }
  if (!isExactAttestationUrl(published?.dist?.attestations?.url, expectedName, expectedVersion)) {
    errors.push("Registry metadata does not reference the exact npm attestation endpoint.");
  }
  return errors;
}

export function validateProvenanceAttestations(document, expected) {
  const attestations = document?.attestations;
  if (!Array.isArray(attestations)) {
    return ["npm attestation response does not contain an attestations array."];
  }

  const expectedSubject = npmPackagePurl(expected.name, expected.version);
  const expectedDependency = `git+${provenanceSource.repository}@${provenanceSource.ref}`;
  const candidates = attestations.filter(
    (attestation) => attestation?.predicateType === provenancePredicateType,
  );
  for (const candidate of candidates) {
    const envelope = candidate?.bundle?.dsseEnvelope;
    const statement = decodeDssePayload(envelope?.payload);
    const subject = statement?.subject;
    const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
    const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
    if (
      statement?._type === "https://in-toto.io/Statement/v1" &&
      statement?.predicateType === provenancePredicateType &&
      Array.isArray(envelope?.signatures) &&
      envelope.signatures.some(
        (signature) => typeof signature?.sig === "string" && signature.sig.length > 0,
      ) &&
      Array.isArray(subject) &&
      subject.length === 1 &&
      subject[0]?.name === expectedSubject &&
      subject[0]?.digest?.sha512 === expected.sha512 &&
      workflow?.repository === provenanceSource.repository &&
      workflow?.ref === provenanceSource.ref &&
      workflow?.path === provenanceSource.workflowPath &&
      statement?.predicate?.runDetails?.builder?.id === provenanceSource.builder &&
      Array.isArray(dependencies) &&
      dependencies.some(
        (dependency) =>
          dependency?.uri === expectedDependency &&
          dependency?.digest?.gitCommit === expected.commit,
      )
    ) {
      return [];
    }
  }

  return [
    "npm SLSA provenance does not bind the exact package digest, repository, workflow, branch, and source commit.",
  ];
}

async function fetchJson(fetchImpl, url, deadline, now, headers) {
  const remainingMs = Math.max(1, deadline - now());
  const response = await fetchImpl(url, {
    headers,
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(
      Math.min(registryAvailabilityPolicy.requestTimeoutMs, remainingMs),
    ),
  });
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
  return response.json();
}

function isExactAttestationUrl(value, expectedName, expectedVersion) {
  if (typeof value !== "string") return false;
  try {
    const url = new globalThis.URL(value);
    const prefix = "/-/npm/v1/attestations/";
    if (
      url.origin !== registryOrigin ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith(prefix)
    ) {
      return false;
    }
    return (
      globalThis.decodeURIComponent(url.pathname.slice(prefix.length)) ===
      `${expectedName}@${expectedVersion}`
    );
  } catch {
    return false;
  }
}

function npmPackagePurl(name, version) {
  if (name.startsWith("@")) {
    const segments = name.split("/");
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) return null;
    return `pkg:npm/${globalThis.encodeURIComponent(segments[0])}/${globalThis.encodeURIComponent(segments[1])}@${globalThis.encodeURIComponent(version)}`;
  }
  return `pkg:npm/${globalThis.encodeURIComponent(name)}@${globalThis.encodeURIComponent(version)}`;
}

function sha512HexFromIntegrity(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return null;
  const encoded = integrity.slice("sha512-".length);
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/u.test(encoded)) return null;
  const digest = Buffer.from(encoded, "base64");
  if (digest.length !== 64 || digest.toString("base64") !== encoded) return null;
  return digest.toString("hex");
}

function decodeDssePayload(payload) {
  if (
    typeof payload !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload)
  ) {
    return null;
  }
  try {
    const contents = Buffer.from(payload, "base64");
    if (contents.toString("base64") !== payload) return null;
    const value = JSON.parse(contents.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
