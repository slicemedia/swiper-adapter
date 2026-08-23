# Slice Media Swiper Adapter

Slice Media Swiper Adapter adds a reversible lifecycle around the upstream [`swiper`](https://www.npmjs.com/package/swiper) library for Webflow projects. It is not a fork. The adapter handles responsive enablement, multiple slider roots, delayed CMS markup, optional mutation observation, refreshes, accessibility-state restoration, and teardown.

The package is independent of Slice Media DevKit and can be used in any Webflow-oriented TypeScript project. Its ESM entry is side-effect-free: consumers decide when to initialize it and which official Swiper CSS and modules to include.

## Install

Install the public release candidate from npm's `next` tag together with its Swiper peer dependency:

```sh
pnpm add @slicemedia/swiper-adapter@next swiper
```

```sh
npm install @slicemedia/swiper-adapter@next swiper
```

```sh
yarn add @slicemedia/swiper-adapter@next swiper
```

## Use

Use Swiper's standard classes and neutral project-owned attributes. Give CMS slides a unique stable key when their order can change:

```html
<section class="swiper" data-wft-slider>
  <div class="swiper-wrapper">
    <article class="swiper-slide" data-wft-slide-key="first">First item</article>
    <article class="swiper-slide" data-wft-slide-key="second">Second item</article>
  </div>
  <button type="button" data-wft-slider-prev aria-label="Previous item"></button>
  <button type="button" data-wft-slider-next aria-label="Next item"></button>
  <div data-wft-slider-pagination></div>
</section>
```

```ts
import { createResponsiveSwiper } from "@slicemedia/swiper-adapter";
import "swiper/css";

const slider = createResponsiveSwiper({
  target: "[data-wft-slider]",
  enabled: { maxWidth: 767 },
  observeMutations: true,
  swiper: {
    slidesPerView: 1.2,
    spaceBetween: 16,
  },
});

slider.init();

// Reconcile CMS changes or configuration updates when needed.
slider.refresh();

// Restore author-owned attributes and remove Swiper-owned state.
slider.destroy();
```

`createResponsiveSwiper()` also accepts an element, an iterable of elements, a per-element options callback, a custom factory for advanced module setups, and lifecycle event listeners. The exported types document the complete API.

Initialization is idempotent. By default, a hidden or zero-width root is deferred until it becomes measurable; a `ResizeObserver` schedules the refresh when the browser provides one. Use `deferUntilMeasurable: false` only when initialization against hidden geometry is intentional. During CMS refreshes, the adapter preserves the active element or its unique `data-wft-slide-key`, falling back to a safe index if that item was removed. In loop mode it uses Swiper's logical slide index when the matched slide has one, and the refreshed active index for a newly replaced, not-yet-indexed node.

One root can have only one owner within the loaded adapter module. A second controller, or a controller encountering a standard external Swiper instance on the same root, emits `ownershipConflict` and does not initialize another instance. Destroying the owner releases the root.

## Opt-in Webflow controls

The optional `@slicemedia/swiper-adapter/webflow` entry configures upstream A11y, Navigation, and Pagination modules with controls scoped to each root. It creates no markup and imports no CSS. Navigation controls must be native `type="button"` buttons and need either an author-provided accessible name or localized labels in the integration options.

```ts
import { createResponsiveSwiper } from "@slicemedia/swiper-adapter";
import { createWebflowSwiperOptions } from "@slicemedia/swiper-adapter/webflow";
import "swiper/css";
import "swiper/css/a11y";
import "swiper/css/navigation";
import "swiper/css/pagination";

const slider = createResponsiveSwiper({
  target: "[data-wft-slider]",
  observeMutations: true,
  swiper: (root) =>
    createWebflowSwiperOptions(root, {
      navigation: {
        previousLabel: "Previous item",
        nextLabel: "Next item",
      },
      swiper: { slidesPerView: 1.2, spaceBetween: 16 },
    }),
});

slider.init();
```

The helper discovers `[data-wft-slider-prev]`, `[data-wft-slider-next]`, and `[data-wft-slider-pagination]` only inside the matching slider root. Pass explicit scoped element references when a project uses different neutral hooks.

## Browser output

The package emits typed ESM only. It does not ship an IIFE, register a browser global, auto-import CSS, or initialize a slider. Bundle it with `swiper` inside the site-owned browser entry used by your project.

## Development

The published browser package does not add a Node.js engine restriction beyond upstream Swiper.
Repository development and release checks run on Node.js 22 and 24, on Linux and Windows, using
pnpm 11:

```sh
pnpm install
pnpm check
```

## Support and maintenance

The published package deliberately declares no additional Node.js engine, operating-system, CPU,
or libc restriction. Browser compatibility follows the installed upstream Swiper version and the
standard browser APIs used by enabled adapter features; optional mutation and resize observers are
skipped when unavailable. The peer range in `package.json` is the authoritative Swiper
compatibility contract.

Before version 1.0, the most recent version under npm's `next` tag is the actively maintained
release-candidate line. Once a `latest` release exists, the current `latest` line receives compatible
security and defect fixes while `next` previews upcoming changes. Earlier `0.x` lines are maintained
on a best-effort basis, and a minor `0.x` release may contain a breaking change documented in the
changelog. Pin versions for production projects and review release notes before upgrading. Support
is community-based and has no service-level guarantee. An exact semantic version identifies
immutable package contents; `next` and `latest` are movable npm dist-tags, not versions.

## AI-assisted development and independence

AI tools assisted substantially with this project's implementation, tests, and documentation.
AI-generated or AI-reviewed code can still contain defects. Production use requires human review,
project-specific testing, and appropriate accessibility, security, and browser validation.

The code is MIT licensed. Swiper is a separate upstream dependency distributed under its own
license. The names Swiper and Webflow are used only to describe compatibility. This project is not
affiliated with, sponsored by, or endorsed by the Swiper maintainers or Webflow.
