import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmCommand = await resolvePnpmCommand();
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const installedVersions = Object.fromEntries(
  await Promise.all(
    ["jsdom", "swiper", "typescript", "vite"].map(async (name) => {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, "node_modules", name, "package.json"), "utf8"),
      );
      if (typeof manifest.version !== "string" || manifest.version.length === 0) {
        throw new Error(`Installed ${name} package does not declare a version.`);
      }
      return [name, manifest.version];
    }),
  ),
);
const temporaryRoot = await mkdtemp(join(tmpdir(), "slicemedia-swiper-consumer-"));
const packDirectory = join(temporaryRoot, "pack");
const consumerDirectory = join(temporaryRoot, "consumer");

try {
  await mkdir(packDirectory);
  await mkdir(join(consumerDirectory, "src"), { recursive: true });
  const packOutput = await run(
    npmCommand,
    ["pack", "--json", "--pack-destination", packDirectory],
    { cwd: repositoryRoot },
  );
  const packResult = JSON.parse(packOutput)[0];
  if (!packResult?.filename) throw new Error("npm pack did not return an archive filename.");
  const archivePath = join(packDirectory, packResult.filename);

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "swiper-adapter-packed-consumer",
        private: true,
        type: "module",
        scripts: {
          build: "vite build",
          runtime: "node runtime.mjs",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@slicemedia/swiper-adapter": `file:${relative(consumerDirectory, archivePath).replaceAll("\\", "/")}`,
          swiper: installedVersions.swiper,
        },
        devDependencies: {
          jsdom: installedVersions.jsdom,
          typescript: installedVersions.typescript,
          vite: installedVersions.vite,
        },
        engines: packageJson.engines,
        packageManager: packageJson.packageManager,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDirectory, "index.html"),
    '<main data-test-root></main><script type="module" src="/src/main.ts"></script>\n',
  );
  await writeFile(
    join(consumerDirectory, "src/main.ts"),
    `import { createResponsiveSwiper } from "@slicemedia/swiper-adapter";
import { createWebflowSwiperOptions } from "@slicemedia/swiper-adapter/webflow";
import "swiper/css";
import "swiper/css/a11y";
import "swiper/css/navigation";
import "swiper/css/pagination";

const root = document.querySelector<HTMLElement>("[data-test-root]");
if (root) {
  const controller = createResponsiveSwiper({
    target: root,
    swiper: (element) =>
      createWebflowSwiperOptions(element, {
        navigation: false,
        pagination: false,
        swiper: { slidesPerView: 1 },
      }),
  });
  controller.init();
}
`,
  );
  await writeFile(join(consumerDirectory, "runtime.mjs"), getRuntimeTestSource());

  await run(
    pnpmCommand,
    ["install", "--ignore-workspace", "--prefer-offline", "--frozen-lockfile=false"],
    {
      cwd: consumerDirectory,
    },
  );
  const installedPackage = await realpath(
    join(consumerDirectory, "node_modules/@slicemedia/swiper-adapter"),
  );
  await run(process.execPath, [join(repositoryRoot, "scripts/sanitize.mjs"), installedPackage], {
    cwd: repositoryRoot,
  });
  await run(pnpmCommand, ["typecheck"], { cwd: consumerDirectory });
  await run(pnpmCommand, ["build"], { cwd: consumerDirectory });
  await run(pnpmCommand, ["run", "runtime"], { cwd: consumerDirectory });
  console.info("Packed consumer typecheck, bundle, and real Swiper lifecycle passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...options,
      env: { ...process.env, CI: "1" },
      shell: process.platform === "win32" && command.endsWith(".cmd"),
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
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else {
        rejectPromise(
          new Error(
            `${command} ${args.join(" ")} failed with status ${code ?? "unknown"}.\n${stdout}${stderr}`,
          ),
        );
      }
    });
  });
}

async function resolvePnpmCommand() {
  if (process.platform !== "win32") return "pnpm";

  const pnpmHome = process.env.PNPM_HOME;
  if (pnpmHome) {
    const executable = join(pnpmHome, "pnpm.exe");
    try {
      await access(executable);
      return executable;
    } catch {
      // Fall back to the conventional Windows command shim.
    }
  }

  return "pnpm.cmd";
}

function getRuntimeTestSource() {
  return `import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const globalsBeforeImport = new Set(Object.keys(globalThis));
const { createResponsiveSwiper } = await import("@slicemedia/swiper-adapter");
const { createWebflowSwiperOptions } = await import("@slicemedia/swiper-adapter/webflow");
assert.equal("document" in globalThis, false);
assert.deepEqual(
  Object.keys(globalThis).filter((key) => !globalsBeforeImport.has(key)),
  [],
  "Package imports must not register globals.",
);

const dom = new JSDOM(\`<section class="swiper" data-wft-slider>
  <div class="swiper-wrapper">
    <article class="swiper-slide" data-wft-slide-key="one">One</article>
    <article class="swiper-slide" data-wft-slide-key="two">Two</article>
    <article class="swiper-slide" data-wft-slide-key="three">Three</article>
  </div>
  <button type="button" data-wft-slider-prev></button>
  <button type="button" data-wft-slider-next></button>
  <div data-wft-slider-pagination></div>
</section>\`, { pretendToBeVisual: true });
const browserWindow = dom.window;
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "HTMLSlotElement",
  "SVGElement",
  "MutationObserver",
  "ResizeObserver",
]) {
  if (browserWindow[key] !== undefined) globalThis[key] = browserWindow[key];
}
globalThis.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);

const root = browserWindow.document.querySelector("[data-wft-slider]");
Object.defineProperty(root, "clientWidth", { configurable: true, value: 800 });
Object.defineProperty(root, "offsetWidth", { configurable: true, value: 800 });
root.getBoundingClientRect = () => ({
  bottom: 300,
  height: 300,
  left: 0,
  right: 800,
  top: 0,
  width: 800,
  x: 0,
  y: 0,
  toJSON() {},
});
root.getClientRects = () => [root.getBoundingClientRect()];
const controller = createResponsiveSwiper({
  target: root,
  document: browserWindow.document,
  window: browserWindow,
  swiper: (element) => createWebflowSwiperOptions(element, {
    navigation: { previousLabel: "Previous item", nextLabel: "Next item" },
    swiper: { loop: true, slidesPerView: 1, speed: 0, watchOverflow: false },
  }),
});
controller.init();
assert.equal(controller.getState().instanceCount, 1);
assert.equal(root.classList.contains("swiper-initialized"), true);
assert.ok(root.swiper?.navigation, "Navigation module was not initialized.");
assert.ok(root.swiper?.a11y, "A11y module was not initialized.");
assert.ok(root.swiper?.pagination, "Pagination module was not initialized.");
assert.equal(root.querySelector("[data-wft-slider-prev]").getAttribute("aria-label"), "Previous item");

root.swiper.slideToLoop(1, 0, false);
await new Promise((resolve) => browserWindow.requestAnimationFrame(resolve));
assert.equal(root.swiper.realIndex, 1);
assert.equal(root.swiper.slides[root.swiper.activeIndex].getAttribute("data-wft-slide-key"), "two");
const originalSlideToLoop = root.swiper.slideToLoop.bind(root.swiper);
const restoredLoopIndexes = [];
root.swiper.slideToLoop = (index, ...args) => {
  restoredLoopIndexes.push(index);
  return originalSlideToLoop(index, ...args);
};
root.querySelector(".swiper-wrapper").insertAdjacentHTML(
  "afterbegin",
  '<article class="swiper-slide" data-wft-slide-key="new">New</article>',
);
controller.refresh();
assert.equal(restoredLoopIndexes.at(-1), 1);
assert.ok(root.swiper.slides.some((slide) => slide.getAttribute("data-wft-slide-key") === "two"));
await new Promise((resolve) => browserWindow.requestAnimationFrame(resolve));
assert.equal(root.swiper.realIndex, 1);
assert.equal(root.swiper.slides[root.swiper.activeIndex].getAttribute("data-wft-slide-key"), "two");

controller.destroy();
assert.equal(controller.getState().instanceCount, 0);
assert.equal(root.className, "swiper");
assert.equal(root.querySelector("[data-wft-slider-prev]").hasAttribute("aria-label"), false);
assert.equal(root.querySelector('[data-wft-slide-key="new"]') !== null, true);
`;
}
