# Release process

The initial public release is `0.1.0`. Work completed before that release is consolidated in the
root changelog rather than represented as version-bumping Changesets. After `0.1.0`, every
user-visible change requires a Changeset.

## Version pull requests

The Release PR workflow only prepares draft version pull requests. It cannot publish packages,
create tags, or create GitHub Releases. Keep `SLICEMEDIA_RELEASE_PR_ENABLED` unset until an owner has
reviewed the workflow, protected `main`, and allowed GitHub Actions to create pull requests. Setting
the repository variable to exactly `true` enables the pinned version-only job after a push to
`main`; there is no manual privileged trigger.

The job runs in the main-only `release-sanitize` environment, which owns the confidential denylist
secret. Pull-request CI has no access to that secret and always runs the generic secret and naming
checks.

## First-package bootstrap

npm requires a package to exist before its trusted publisher can be configured. For this package's
one-time bootstrap only:

1. Review a minimal identity-only `0.0.0-bootstrap.0` archive that contains no runtime build,
   credentials, customer data, or release automation.
2. From an npm organization owner account protected by two-factor authentication, publish that
   archive with public access under the non-default `bootstrap` tag. Never assign it to `next` or
   `latest`.
3. Verify the package owner, scope, version, contents, and `bootstrap` dist-tag on npm.
4. Configure npm trusted publishing for `slicemedia/swiper-adapter`, this repository's
   `.github/workflows/publish-next.yml` workflow, and its `npm-next` environment, with the
   `npm publish` action explicitly allowed.
5. Use only the trusted-publisher workflow for the real `0.1.0` package and later releases. Do not
   add an npm token to GitHub Actions or manually publish a production archive.

The bootstrap package is permanent registry history. Prepare and inspect it separately; do not
derive it by weakening the real package's guarded publication workflow.

## Prerelease publication

The `Publish npm prerelease` workflow is the only approved path for real npm artifacts. It is
manual, runs only from current remote `main`, accepts no npm token, and publishes only under the
`next` tag. Its archive-preparation job uses `release-sanitize`; the minimal OIDC publisher is
isolated in the protected `npm-next` environment and cannot read the denylist.

Keep `SLICEMEDIA_NPM_PUBLISH_NEXT_ENABLED` unset until all of the following are true:

- the repository is public and `main` protections are active;
- `@slicemedia/swiper-adapter` exists from the reviewed bootstrap;
- the npm trusted publisher targets the exact repository, workflow, and environment;
- the `npm-next` environment has its required reviewer;
- the package manifest explicitly sets `private: false`; and
- the intended version and package archive have passed the complete readiness review.

Setting the variable to exactly `true` enables publication only when every workflow and source
guard also passes. The workflow:

- proves that the checkout is still current remote `main` and clean;
- runs tests, builds, packed-consumer checks, sanitization, and package inspection before OIDC is
  available;
- pins and verifies npm `11.19.0` rather than accepting an implicit npm major upgrade;
- records one archive and its integrity in the preparation job;
- passes only that archive to the minimal OIDC job;
- rejects registry, user-configuration, and classic-token overrides;
- publishes to the explicit `https://registry.npmjs.org/` registry with provenance; and
- allows npm's publish-time scan up to 18 minutes to make the version available; and
- verifies the exact registry integrity, `next` tag, and SLSA provenance source against the reviewed
  archive and commit.

After the first verified OIDC release, set the package's npm Publishing access to require
two-factor authentication and disallow tokens. Trusted publishing is additive, so this setting
closes token-based publication paths outside the reviewed workflow.

The sanitizer derives text, UTF-8 base64, base64url, and hexadecimal rules at runtime and reports
only rule indices and kinds. The protected workflows require `SLICEMEDIA_FORBIDDEN_TERMS` as a
non-empty JSON string array in `release-sanitize`. Local checks may use the same JSON in ignored
`.private/denylist`; never commit or print it.

Create the matching Git tag and GitHub Release only after npm accepts the exact version commit.
Promotion to `latest` must move the dist-tag to the already verified artifact; it must not rebuild
or republish the package.

## Pilot gate

Publish `0.1.0` to `next` only after automated package, packed-consumer, sanitization, and clean-room
gates pass. Real client and neutral Webflow projects then serve as prerelease pilots covering
breakpoint transitions, initially hidden containers, CMS insertion/replacement/reordering, loop
restoration, localized keyboard-accessible controls, destroy/reinitialize cycles, and rendered
production bundles.

Fixes discovered during pilots ship as new immutable versions under `next`. Do not promote a
version to `latest` until the pilots and complete public-readiness review pass.
