# Changelog

## 0.2.0

### Minor Changes

- 6a06bfc: Add opt-in attribute-based slider structure preparation for existing Webflow grids and CMS lists. Resolve scoped tracks, slides, and containers; temporarily apply upstream classes and flex mechanics; restore authored layout and list semantics on teardown. Handle delayed or replaced tracks, new keyed CMS slides, nested controls, container ownership and measurement, failed initialization, and vendor mutation feedback. Keep standard markup and inert imports compatible.

All notable changes to Slice Media Swiper Adapter are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.0

Initial public release candidate, distributed through npm's `next` tag.

- Add a side-effect-free TypeScript adapter around upstream Swiper without forking Swiper or
  changing its standard markup, modules, options, or official CSS.
- Add idempotent responsive initialization, refresh, and complete teardown across multiple slider
  roots.
- Coordinate root ownership and report conflicts instead of creating duplicate Swiper instances.
- Preserve CMS slide position through insertion, replacement, and reordering with stable slide
  keys and safe index fallbacks.
- Defer hidden or zero-width roots until measurable and support opt-in CMS mutation observation.
- Add an optional Webflow helper for scoped upstream A11y, Navigation, and Pagination modules while
  leaving CSS, markup, and initialization under consumer control.
- Restore author-owned accessibility state during teardown.
- Validate the package with lifecycle, DOM, packed-consumer, Linux, and Windows checks.
