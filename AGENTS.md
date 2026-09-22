# Slice Media Swiper Adapter repository guidance

This repository contains one side-effect-free Webflow adapter around upstream Swiper. It is independent of Slice Media DevKit and must remain usable from any Webflow-oriented TypeScript codebase.

## Boundaries

- Prefer Webflow-owned classes and neutral root/track/slide attributes with the opt-in `structure` mode. Prepare standard Swiper classes and mechanical layout temporarily at runtime; restore the authored markup on disable/destroy. Keep upstream options, modules, and official CSS. This project is an adapter, not a fork.
- Keep the package root and opt-in `/webflow` entry inert: importing them must not initialize sliders, modify globals, or import CSS.
- Coordinate one owner per root, preserve uniquely keyed CMS items, defer zero-width roots by default, and restore project-owned accessibility state during complete teardown.
- Keep A11y, Navigation, and Pagination integration opt-in through upstream modules, scoped native buttons, temporary runtime classes, and official CSS. Keep authored visual styles on component classes, and retain standard-markup compatibility when structure adaptation is disabled.
- Preserve author-owned DOM, attributes, and content. Track only vendor-created nodes and vendor-owned mutations.
- Do not introduce site IDs, client selectors, copied production markup, credentials, deployment behavior, or dependencies on another Slice Media product.

## Commands

- `pnpm build` — build ESM and declarations.
- `pnpm test` — run lifecycle and DOM tests.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` — validate source.
- `pnpm pack:check` — inspect the npm package allowlist.
- `pnpm sanitize` — scan source and distributable output.
- `pnpm check` — run the complete local gate.
