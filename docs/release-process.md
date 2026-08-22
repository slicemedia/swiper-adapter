# Release preparation

The repository uses Changesets to prepare version pull requests during private incubation and after
public launch. The workflow is intentionally incapable of publishing packages, creating tags, or
creating GitHub Releases.

During incubation, leave the repository variable `SLICEMEDIA_RELEASE_PR_ENABLED` unset. Before enabling version pull requests, an owner must review the workflow and configure the organization or repository Actions policy to allow GitHub Actions to create pull requests. Then set the variable to exactly `true`.

Version pull requests run only after a push to `main`; there is no manual privileged trigger. The
job is bound to the main-only `release-sanitize` environment, which owns the private denylist
secret.

Enabling this gate only permits the reviewed version-PR workflow. Publishing remains a separate, unavailable operation until Slice Media approves and implements a public release process.

Before the first public `0.x` prerelease, run the automated package, packed-consumer, sanitization,
and clean-room gates. Publish it only under `next`. Real client and neutral Webflow projects then
serve as prerelease pilots covering breakpoint transitions, initially hidden containers, CMS
insertion/replacement/reordering, loop restoration, localized keyboard-accessible controls,
destroy/reinitialize cycles, and rendered production bundles. Fixes discovered during pilots ship
as further `next` versions. Do not promote to `latest` until those pilots and the complete public
readiness review pass.
Create the matching Git tag and GitHub Release only after npm accepts that exact version commit;
promotion must reuse the published artifact rather than rebuild it.

The dormant `Publish npm prerelease` workflow is the only approved npm publication path. It is
manual, runs only from the current `main` commit, and accepts no npm token. Its archive-preparation
job is bound to `release-sanitize`, while its minimal OIDC publisher is bound separately to the
protected `npm-next` environment and cannot read the private denylist. Installation, tests, and
archive preparation remain outside the OIDC job; the publisher receives only the recorded archive
after proving that its checkout is still live remote `main`. Both preparation
and publication pin and verify npm `11.19.0`; npm 12 is not allowed implicitly. It also requires
a public repository, a non-private package manifest, and the repository variable
`SLICEMEDIA_NPM_PUBLISH_NEXT_ENABLED=true`. Keep that variable unset until the npm scope, trusted
publisher, required reviewers, final package name, and first-prerelease readiness gates have all
been verified. The protected main scan, version-PR job, and prerelease preparation job require the
private `SLICEMEDIA_FORBIDDEN_TERMS` environment secret as a non-empty JSON string array and declare
`release-sanitize` explicitly. Pull-request CI contains no secret reference and always runs generic
secret and naming checks. The sanitizer derives text, UTF-8 base64, base64url, and hexadecimal rules
at runtime and reports only rule indices and kinds. For local
checks, the same JSON can live in ignored `.private/denylist`; never commit or print it. A
successful run packs and records one local archive, confirms that its source commit is
still the remote `main`, and publishes that exact archive only to `next` at the explicit
`https://registry.npmjs.org/` registry. Registry, user-configuration, and classic-token environment
overrides are rejected, and registry integrity must match the local archive. It does not create a
Git tag or GitHub Release.
