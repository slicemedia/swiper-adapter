# Contributing to Slice Media Swiper Adapter

1. Preserve standard upstream Swiper markup, modules, options, and official CSS. This adapter must
   not become a fork or acquire project-specific defaults.
2. Keep the package root and `/webflow` entry side-effect-free. Consumers own initialization, CSS,
   and browser bundling.
3. Add regression coverage for lifecycle, ownership, CMS replacement/reordering, breakpoints,
   accessibility restoration, and complete teardown when relevant.
4. Add a Changeset for every user-visible change.
5. Run `pnpm check` before opening a pull request. CI repeats the gate on Node.js 22 and 24 on Linux
   and Windows.
6. Use synthetic markup and selectors. Never add client identifiers, production content,
   credentials, or deployment details.
7. Do not publish packages, create release tags, or enable release variables from a contribution.
   In particular, keep `SLICEMEDIA_NPM_PUBLISH_NEXT_ENABLED` unset outside an approved release.
8. Keep private provenance terms only in the `SLICEMEDIA_FORBIDDEN_TERMS` secret of the protected
   `release-sanitize` environment or an ignored local `.private/denylist` JSON array. Never commit
   or print that input.

By participating, you agree to follow [the Code of Conduct](./CODE_OF_CONDUCT.md).
