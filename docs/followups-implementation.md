# Acquisition follow-ups and maintained fork

27 October 2026. These changes accompany discovery Pass 3. Production activation is separate from source publication and CI image generation.

## Delivered behavior

1. **Review Stash match.** Acquisition rows awaiting import and scene lifecycle panels offer an on-demand review. It reports live Whisparr import/file information, Stash catalog matches and bounded filename/path/size candidates, source check times, completeness and practical identification steps. File hints are explicitly unverified; alternate catalog versions and multiple copies remain visible. Missing, failed, malformed, short or duplicate result pages cannot prove absence. Opening/re-checking the panel performs no scan, identification, download or metadata mutation.
2. **Browser addresses.** Every supported integration has an optional browser URL, independent of the API address. Existing connections are editable in place without resetting them or re-entering keys. Browser/default-only saves preserve health, credentials and provider selection. API calls and protected image fetching keep the API address; user-facing Stash/Whisparr links and service launch links use the browser address, including reverse-proxy prefixes. Library links are rebuilt from current settings at read time. Unset browser URLs use a sanitized API-address fallback.
3. **Request defaults.** Whisparr settings expose deliberate root-folder/profile choice loading and editable Portal defaults. Request settings resolve valid saved values first, then configured defaults, then a sole valid choice. Ambiguous/missing choices require review. The modal displays the actual returned defaults and their source. Batch creation settings are instance defaults rather than the first selected scene's saved preferences. Existing acquisitions do not require unused creation settings.
4. **Consistent controls.** Request, history, batch, confirmation and match-review controls use Portal's native PrimeNG button theme, clear secondary/danger variants and responsive wrapping. Review dialogs share spacing and surfaces, render at the document level and block background scrolling. Destructive request removal still requires its explicit limited-scope confirmation.
5. **Resume existing acquisitions.** A re-request records a new reviewed intent, rechecks current Stash/Whisparr/queue/search state and takes the appropriate step. It creates a missing entry once, reuses an active job, searches an existing waiting entry once when requested, or reports import/identification/blocker guidance. Single and batch preview/execution agree. Upstream settings stay intact. An uncertain search cannot be confirmed merely because its movie already existed; command evidence is required, with durable claims and key replay preserved.

## Upstream integration

- [PR 36](https://github.com/enymawse/stasharr-portal/pull/36), catalog-alias availability: original commit `f57d7808629fdca3ed35dc4b4314750ae7bd519b` was already an ancestor of the deployed build. It has not been duplicated or merged upstream by this work.
- [PR 34](https://github.com/enymawse/stasharr-portal/pull/34), list position restoration: ported from `155e0c895e3cf46b8c7966ca399e25c22d7c3072`, preserving the new discovery filters and acquisition controls. Discovery caches last 30 minutes; acquisition snapshots expire after 30 seconds. Auth changes and relevant mutations/refreshes invalidate remembered observations, including older library browser links. Generation checks prevent a departing page from repopulating invalidated private/stale data.
- Real router navigation testing exposed and fixed a performer-picker render loop caused by allocating a new selected-ID array every render. The picker now binds a stable signal.

## Validation

- 401 backend tests pass across 39 suites, including combined operations/requests tests for history, repeated keys, concurrent claims and uncertain resume-search recovery.
- 147 frontend tests across 34 suites pass across the full regression run and the final affected dialog suite. API and frontend production builds pass without compiler warnings.
- An isolated PostgreSQL database replayed all 23 baseline migrations and the new additive integration-settings migration. Synthetic credentials, health, sessions, requests and an uncertain action claim were preserved; new fields remain nullable and persist explicit values. Production data was not modified.
- Bounded read-only queries against the installed Stash confirmed the filename filter, file path/size fields and catalog lookup shape.
- Headless Chrome checks exercised queue, match review, history, settings prefill and deletion confirmation with neutral fixtures in light/dark themes at desktop/mobile widths. Fourteen screenshots were captured; no page errors, horizontal overflow or acquisition submissions occurred. Mobile review content remains internally scrollable. Fixture testing is distinct from live backlog repair.
- CI additionally replays the synthetic upgrade proof and smoke-tests the built Docker image against a disposable database, then publishes that same verified image. See [fork pipeline](fork-pipeline.md).

The new database migration only adds nullable fields. No file movement/deletion, catalog association rewrite, queue cancellation/blocklisting or automatic backlog retry is included. Existing re-request history and uncertain-dispatch safeguards remain in force.
