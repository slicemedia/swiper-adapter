import { spawn } from "node:child_process";

const allowedFiles = new Set(["LICENSE", "README.md", "package.json"]);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with status ${code ?? "unknown"}.`));
    });
  });
}

const output = await run(npmCommand, ["pack", "--dry-run", "--json"]);
const result = JSON.parse(output);
const files = result[0]?.files;
if (!Array.isArray(files)) throw new Error("npm pack did not return a file inventory.");

const unexpected = files
  .map(({ path }) => path)
  .filter(
    (path) => typeof path !== "string" || (!allowedFiles.has(path) && !path.startsWith("dist/")),
  );

if (unexpected.length > 0) {
  throw new Error(`npm pack contains unexpected files: ${unexpected.join(", ")}`);
}
if (!files.some(({ path }) => path === "dist/index.js")) {
  throw new Error("npm pack is missing dist/index.js; run the build before checking the package.");
}
if (!files.some(({ path }) => path === "dist/index.d.ts")) {
  throw new Error(
    "npm pack is missing dist/index.d.ts; run the build before checking the package.",
  );
}
if (!files.some(({ path }) => path === "dist/webflow.js")) {
  throw new Error("npm pack is missing the opt-in Webflow integration entry.");
}
if (!files.some(({ path }) => path === "dist/webflow.d.ts")) {
  throw new Error("npm pack is missing the Webflow integration declarations.");
}

console.info(`npm pack allowlist passed with ${files.length} files.`);
