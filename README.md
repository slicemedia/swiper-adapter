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

Prefer attributes for behavior and your own Webflow classes for design. Enable `structure: true` to prepare Swiper's technical classes and layout only while the slider is active. **Attribute structure requires adapter 0.2.0 or later; 0.1.x supports standard markup only.**

```html
<section class="cards-component" data-wft-slider>
  <div class="cards-cms">
    <div class="cards-grid" data-wft-slider-track role="list">
      <article class="card" data-wft-slider-slide data-wft-slide-key="first" role="listitem">
        First item
      </article>
      <article class="card" data-wft-slider-slide data-wft-slide-key="second" role="listitem">
        Second item
      </article>
    </div>
  </div>
  <button class="cards-prev" type="button" data-wft-slider-prev aria-label="Previous item"></button>
  <button class="cards-next" type="button" data-wft-slider-next aria-label="Next item"></button>
  <div class="cards-pagination" data-wft-slider-pagination></div>
</section>
```

Load the unmodified official CSS through a project stylesheet in a lower-priority cascade layer. This lets Webflow's normal component classes keep their display, width, and other visual styles even when vendor CSS loads later:

```css
/* slider.css */
@import "swiper/css" layer(swiper);
/* Include these only when using the corresponding modules: */
@import "swiper/css/a11y" layer(swiper);
@import "swiper/css/navigation" layer(swiper);
@import "swiper/css/pagination" layer(swiper);
```

Import that stylesheet once in the shared slider vendor. If the project's own styles use cascade layers too, order the `swiper` layer below the project design layers. This retains upstream CSS without copying or renaming it.

The CMS Collection List is the track; Collection Items are slides. The existing Collection List Wrapper becomes Swiper's container. Navigation can stay outside that wrapper, inside the component root. Style `cards-grid`, `card`, and the other component classes in Webflow; no permanent `.swiper*` classes are needed in the Designer.

```ts
import { createResponsiveSwiper } from "@slicemedia/swiper-adapter";
import "./slider.css";

const slider = createResponsiveSwiper({
  target: "[data-wft-slider]",
  structure: true,
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

## Structure options

`structure: true` finds one `[data-wft-slider-track]` inside each root. It uses direct `[data-wft-slider-slide]` children when present; otherwise all direct HTML children are slides (excluding scripts, styles, and templates). Put only slides in the track. Nested `[data-wft-slider]` components keep their own tracks and controls.

The container defaults to `[data-wft-slider-container]`, if present, or the track's direct parent. You can customize scoped selectors without renaming any design classes:

```ts
const slider = createResponsiveSwiper({
  target: "[data-wft-slider]",
  structure: {
    container: ":scope", // Optional: this component root is the direct parent.
    track: "[data-wft-cards-track]",
    slides: ":scope > [data-wft-card]",
    equalHeight: true,
    containInlineSize: true, // Optional for a constrained grid/flex parent.
  },
  swiper: { slidesPerView: "auto", spaceBetween: 16 },
});
```

The track must be a direct child of its container, and slides must be direct children of the track. Mark the outer CMS item, not a card nested inside it. The adapter uses existing elements; it does not rebuild, wrap, clone, or reparent your content to make arbitrary nesting work. Swiper itself can reorder slides in loop mode.

While enabled, the adapter adds `.swiper`, `.swiper-wrapper`, and `.swiper-slide`, changes the track to non-wrapping flex layout in Swiper's direction, disables slide growth/shrink, and clears track gaps so `spaceBetween` controls spacing. Webflow controls colors, typography, card widths for `slidesPerView: "auto"`, and other visual styles. Import official Swiper CSS; avoid globally styling its technical classes. With A11y enabled, conflicting CMS list roles are temporarily suspended while Swiper exposes carousel groups.

Optional controls:

- `layout: false` adds the technical classes without applying flex mechanics; the project owns compatible layout CSS.
- `clearGap: false` preserves authored gaps; verify spacing with Swiper instead of counting both gap and `spaceBetween`.
- `equalHeight: true` stretches slides and temporarily sets their height to `auto`.
- `containInlineSize: true` adds inline-size containment while preserving other containment modes. Use it on a container whose width is constrained by its parent, not an intrinsically sized container.

Disable/destroy restores pre-enhancement attributes, inline styles, and accessibility state, including those of CMS slides added before a refresh. The controller never deletes author CMS content. Missing/empty tracks wait for `refresh()` or mutation observation; invalid or ambiguous structures emit `structureIssue` without partial preparation:

```ts
slider.on("structureIssue", ({ element, reason, message }) => {
  console.warn(reason, message, element);
});
```

Use `observeMutations: true` or call `refresh()` after CMS insertion, replacement, or filtering. New slides are prepared before Swiper updates; replacing the entire track recreates its instance. Attribute-only selector changes need an explicit `refresh()`. Upstream `createElements`, virtual slides, and renamed wrapper/slide classes cannot be combined with this mode. Multi-row Swiper Grid requires `layout: false` and project-owned layout CSS.

Omit `structure` or set it to `false` to keep the existing standard `.swiper > .swiper-wrapper > .swiper-slide` contract unchanged. Honor a project's explicit markup choice and existing ownership.

`createResponsiveSwiper()` also accepts an element, an iterable of elements, a per-element options callback, a custom factory for advanced module setups, and lifecycle event listeners. The exported types document the complete API.

Initialization is idempotent. By default, a hidden or zero-width root is deferred until it becomes measurable; a `ResizeObserver` schedules the refresh when the browser provides one. Use `deferUntilMeasurable: false` only when initialization against hidden geometry is intentional. During CMS refreshes, the adapter preserves the active element or its unique `data-wft-slide-key`, falling back to a safe index if that item was removed. In loop mode it uses Swiper's logical slide index when the matched slide has one, and the refreshed active index for a newly replaced, not-yet-indexed node.

The component root and resolved Swiper container can have only one owner within the loaded adapter module. A second controller, or a controller encountering a standard external Swiper instance on either element, emits `ownershipConflict` and does not initialize another instance. Destroying the owner releases both elements. The adapter also checks and observes the actual container for measurable geometry, so a visible heading cannot trigger initialization of a hidden CMS list.

## Opt-in Webflow controls

The optional `@slicemedia/swiper-adapter/webflow` entry configures upstream A11y, Navigation, and Pagination modules with controls scoped to each root. It creates no markup and imports no CSS. Navigation controls must be native `type="button"` buttons and need either an author-provided accessible name or localized labels in the integration options.

```ts
import { createResponsiveSwiper } from "@slicemedia/swiper-adapter";
import { createWebflowSwiperOptions } from "@slicemedia/swiper-adapter/webflow";
import "./slider.css";

const slider = createResponsiveSwiper({
  target: "[data-wft-slider]",
  structure: true,
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

The package emits typed ESM only. It does not ship an IIFE, register a browser global, auto-import CSS, or initialize a slider. Bundle it with `swiper` inside the project-owned shared vendor entry. Multiple addons should load that one vendor JS/CSS pair on demand; avoid bundling another Swiper copy into each addon. In DevKit, pass `structure: true` through the generated `createProjectSlider()` integration after upgrading the adapter dependency to a version that supports it.

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
