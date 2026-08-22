import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const skippedDirectories = new Set([".git", "coverage", "node_modules"]);
const localPrivateDirectory = resolve(".private");
const privateTerms = await loadPrivateTerms();
const privateRules = createPrivateRules(privateTerms);
const canonicalBrandWords = ["Slice", "Media"];
const canonicalCompactBrand = canonicalBrandWords.join("").toLocaleLowerCase("en-US");
const compactBrandPattern = new RegExp(escapeRegExp(canonicalCompactBrand), "giu");
const separatedBrandPattern = new RegExp(
  `(${escapeRegExp(canonicalBrandWords[0])})([\\s_-]+)(${escapeRegExp(canonicalBrandWords[1])})`,
  "giu",
);
const secretPatterns = [
  { label: "GitHub personal access token", pattern: /\bghp_[A-Za-z0-9]{30,}\b/u },
  { label: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/u },
  { label: "AWS-style access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && path === localPrivateDirectory) continue;
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
    else if (entry.isSymbolicLink()) {
      throw new Error("Symbolic links are not allowed in sanitized roots.");
    }
  }
}

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["."];
const findings = [];

for (const input of roots) {
  const root = resolve(input);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error("A sanitized root must not be a symbolic link.");
  }
  const files = rootStat.isDirectory() ? walk(root) : [root];
  for await (const file of files) {
    const path = relative(rootStat.isDirectory() ? root : resolve(root, ".."), file) || file;
    const privatePathMatch = findPrivateRules(path);
    for (const rule of privatePathMatch) {
      findings.push(`[redacted path]: private rule ${rule.index} (${rule.kind}) in filename`);
    }
    if (containsForbiddenBrand(path)) {
      findings.push(`${path}: forbidden identifier in filename`);
    }

    const content = await readFile(file);
    if (content.subarray(0, 8192).includes(0)) continue;
    const text = content.toString("utf8");
    for (const rule of findPrivateRules(text)) {
      findings.push(
        `${privatePathMatch.length > 0 ? "[redacted path]" : path}: private rule ${rule.index} (${rule.kind}) in content`,
      );
    }
    if (containsForbiddenBrand(text)) {
      findings.push(`${path}: forbidden identifier in content`);
    }
    for (const { label, pattern } of secretPatterns) {
      if (pattern.test(text)) findings.push(`${path}: possible ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`Sanitization failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.info(`Sanitization passed for ${roots.length} root(s).`);
}

function containsForbiddenBrand(source) {
  for (const match of source.matchAll(compactBrandPattern)) {
    const candidate = match[0];
    if (
      candidate !== canonicalCompactBrand &&
      candidate !== canonicalCompactBrand.toLocaleUpperCase("en-US")
    ) {
      return true;
    }
  }

  for (const match of source.matchAll(separatedBrandPattern)) {
    const [, firstWord, separator, secondWord] = match;
    const isCanonicalProse =
      /^\s+$/u.test(separator) &&
      firstWord === canonicalBrandWords[0] &&
      secondWord === canonicalBrandWords[1];
    if (!isCanonicalProse) return true;
  }

  return false;
}

function findPrivateRules(source) {
  const foldedSource = source.toLocaleLowerCase("en-US");
  return privateRules.filter((rule) =>
    rule.caseInsensitive
      ? foldedSource.includes(rule.needle.toLocaleLowerCase("en-US"))
      : source.includes(rule.needle),
  );
}

function createPrivateRules(terms) {
  return terms.flatMap((term, termIndex) => {
    const rules = [{ index: termIndex + 1, kind: "text", needle: term, caseInsensitive: true }];
    const seenEncodings = new Set();
    const variants = [
      ...new Set([term, term.toLocaleLowerCase("en-US"), term.toLocaleUpperCase("en-US")]),
    ];
    for (const variant of variants) {
      const bytes = Buffer.from(variant, "utf8");
      const base64 = bytes.toString("base64");
      addEncoding("base64", base64, false);
      addEncoding("base64-unpadded", base64.replace(/=+$/u, ""), false);
      addEncoding(
        "base64url",
        base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""),
        false,
      );
      addEncoding("hex", bytes.toString("hex"), true);
    }
    return rules;

    function addEncoding(kind, needle, caseInsensitive) {
      const key = `${caseInsensitive ? "i" : "s"}:${needle}`;
      if (seenEncodings.has(key)) return;
      seenEncodings.add(key);
      rules.push({ index: termIndex + 1, kind, needle, caseInsensitive });
    }
  });
}

async function loadPrivateTerms() {
  let source = process.env.SLICEMEDIA_FORBIDDEN_TERMS?.trim() ?? "";
  if (!source) {
    try {
      const denylistPath = resolve(localPrivateDirectory, "denylist");
      const stats = await lstat(denylistPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 64 * 1024) {
        throw new Error("The local private denylist must be a bounded regular file.");
      }
      source = (await readFile(denylistPath, "utf8")).trim();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  if (!source) {
    if (process.env.SLICEMEDIA_REQUIRE_FORBIDDEN_TERMS === "true") {
      throw new Error("A private forbidden-term JSON array is required for this gate.");
    }
    return [];
  }

  if (Buffer.byteLength(source, "utf8") > 64 * 1024) {
    throw new TypeError("Private forbidden-term input exceeds the size limit.");
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new TypeError("Private forbidden terms must be a valid JSON array.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > 256 ||
    !parsed.every(
      (term) => typeof term === "string" && term.trim().length >= 3 && term.trim().length <= 256,
    )
  ) {
    throw new TypeError("Private forbidden terms must be a JSON array of 3-256 character strings.");
  }
  return [...new Set(parsed.map((term) => term.trim()))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
