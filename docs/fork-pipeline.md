# Portal fork and image pipeline

The full custom application source is maintained in `soviet-kitsch/stasharr-portal`, forked from `enymawse/stasharr-portal`. `fork-manifest.json` records the upstream base and the two reviewed pull requests. The catalog-alias fix from PR 36 is already an ancestor. PR 34's list/scroll restoration is ported with the discovery filters, request-operation invalidation and authentication boundaries required by this fork.

## Validation and publication

All three upstream workflow files are retained and adapted:

1. `ci.yml` runs for pull requests, main pushes and manual dispatch. It installs the locked dependencies, generates Prisma types, runs backend/frontend tests, builds both applications, and applies the new integration migration to a fresh disposable PostgreSQL database containing synthetic older integration, request, uncertain-action and session records. Existing application `DATABASE_URL` is deliberately ignored by that proof.
2. The same CI run builds the production image once, retaining source/revision/version labels. It starts only isolated PostgreSQL and Portal containers with `apparmor=unconfined`, checks native image health, served frontend, authentication status, protected-route rejection and session-secret file permissions, then saves that exact tested image as an artifact.
3. Only a successful trusted main push or main manual CI run calls reusable `ghcr-publish.yml`. The publisher verifies the archive checksum, image ID and source revision, loads the tested image without rebuilding it, and pushes `ghcr.io/soviet-kitsch/stasharr-portal:sha-<full commit>` and `:edge`. Pull requests cannot publish. The release artifact contains the image digest, version, source commit, test reports and migration proof.
4. `release-please.yml` retains its release-PR/tag function. It remains automatic in the upstream repository and is opt-in in this fork through repository variable `ENABLE_RELEASE_PLEASE=true`. A dedicated `RELEASE_PLEASE_TOKEN` remains preferred when release-created PRs/tags must trigger downstream workflows; the built-in token is a fallback. Fork setup does not create release PRs or change the version automatically.

Permissions default to source read. Package-write access is granted only to the gated publishing job. Release-PR write permissions belong only to the guarded release job. There is no `pull_request_target`, privileged untrusted-PR publication, production credential, remote service restart or automatic deployment in these workflows. Main CI runs are serialized so an older completed build cannot advance `edge` after a newer main run.

The image/version artifact establishes provenance and test success; it is not a production migration or approval. The media stack should deploy a reviewed digest or full source-commit image tag, preserve its existing database and session-secret mount, retain `apparmor=unconfined`, and keep Portal excluded from unrelated automatic image replacement. Registry publication does not restart the running stack. Moving from the earlier locally loaded image to this fork's image requires its own bounded deployment review and backups.

## Isolation and recovery

The upgrade proof accepts only an explicitly opted-in loopback CI PostgreSQL administrative connection, creates an unpredictable `portal_ci_upgrade_*` database, and never drops or reuses an existing database. Its service disappears with the CI job. Runtime smoke containers/network use unique CI-run names, contain only synthetic fresh state, and are removed by the job's own cleanup step. Both image build context and image artifacts exclude local caches, verification output, work checkouts and environment files through `.dockerignore`.

Before publication, the additive migration was also tested natively in the separately created database `codex_portal_followups_39cc2137364a`: 23 baseline migrations followed by the new migration preserved credentials, health state, sessions, requests and an unknown action claim. That completed application-upgrade check is distinct from the new CI-only script, whose first full execution is part of the fork's first GitHub CI run. Local checks confirm that the script parses, loads its dependencies and refuses execution without explicit CI isolation.

An image failure prevents publication. A test or migration-proof failure also prevents publication, even if the parallel image job passes. Production recovery remains a separate operation: preserve the durable request ledger and unknown outcomes, do not discard additive schema or restore an older database automatically, and use only a reviewed compatible image rollback.

## Upstream maintenance

Keep upstream history and fork changes visible. Fetch upstream, review changes on a branch, run the complete CI, and update `fork-manifest.json` when accepting a new upstream base or port. The source commit in OCI labels and release receipts identifies the exact build; no checked patch from the infrastructure repository is needed to reconstruct the application. The infrastructure repository remains responsible for service configuration and the separately approved deployment.
