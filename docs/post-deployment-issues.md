# Portal post-deployment issue queue

27 October 2026. Prepared from the user's five reported issues and read-only inspection of the pass-1/pass-2 source, with Pass 3 in progress. **Queued only: no fixes, service changes, request actions or external issue publication have been performed for this backlog.** Complexity describes Codex implementation difficulty, not engineering days. Source locations below are relative to `media-server/.work/stasharr-portal-reconciliation-20261027`.

| ID | Priority | Issue | Codex complexity |
| --- | --- | --- | --- |
| P3-Q01 | P1 | Explain and guide recovery for imported files without a Stash catalog match | Medium; high if automatic file-to-catalog reconciliation is later requested |
| P3-Q02 | P1 | Separate browser URLs from internal API URLs and edit connected services in place | Medium–high |
| P3-Q03 | P2 | Prefill re-request library and quality from valid saved or configured defaults | Medium |
| P3-Q04 | P2 | Apply Portal's existing button and dialog design consistently | Low–medium |
| P3-Q05 | P1 | Make re-request resume an existing acquisition appropriately, with history and duplicate-dispatch protection | High |

Suggested implementation sequence: Q02 first so recovery links work, Q01 next, then Q03 and Q05 together, followed by Q04 across the completed workflows. Q04 can be developed alongside the backend changes. These are follow-up issues, not additions silently folded into Pass 3.

## P3-Q01 — Guided recovery for “imported but no match found”

**Trigger and current root cause.** Whisparr reports `hasFile`, while the current Stash projection has no matching catalog ID. `apps/sp-api/src/acquisition/acquisition-reconciliation.ts` returns `WAITING_FOR_STASH_MATCH` with a short suggestion to check identification or a different record. That condition does not distinguish a file that has not been scanned, a file present under another catalog record, an unidentified file, or a stale/failed Stash refresh. The earlier audit found six files already physically in Stash despite the mismatch; the displayed condition alone cannot prove that a file is missing. `RequestActionsComponent` offers no guided match-resolution workflow.

**Proposed fix.** Add a “Review Stash match” action and a compact explanation panel showing the observed evidence, its last successful refresh, what is unknown, and practical next steps. Link to the relevant Whisparr entry and, when positively identified, candidate local Stash scene(s). Explain the difference between the library file and its catalog association. Support a clear path to inspect/identify in Stash and refresh Portal afterward. Any candidate match must state its evidence and ambiguity; a similar title or performer is not enough to attach a catalog ID automatically. Describe unavailable Stash or incomplete snapshots as unverified, rather than another failed match.

**Acceptance criteria.**

- A user encountering this state can find the file, understand why Portal does not yet call it available, and know what to do next.
- Displayed candidates distinguish exact catalog ID, verified file identity/fingerprint, and unconfirmed similarity.
- “Refresh status” remains observation-only. Opening the panel never initiates a download or rewrites metadata.
- Multiple copies, alternate scene versions, unidentified scenes, stale snapshots, missing files and provider outages have accurate messages.
- Any future metadata-link repair requires an explicit reviewed choice and preserves the old association/history; it is a separate mutation from this guided read-only workflow.

**Dependencies.** Q02 for browser-reachable links. Deeper candidate detection may require bounded queries against Stash file paths/fingerprints and a safe mapping between Whisparr and Stash mount paths; do not rely on title similarity alone.

## P3-Q02 — Separate API and browser addresses for every connected service

**Trigger and current root cause.** A configured API address such as a Docker service hostname works from Portal but cannot be opened from the user's browser. The integration model, update DTO and response expose `baseUrl` without a separate browser URL (`prisma/schema.prisma`, `integrations/dto/update-integration.dto.ts`, `integration-response.dto.ts`). Stash scene view URLs and Whisparr scene links are built from that same API base (`providers/stash/stash.adapter.ts::resolveSceneViewUrl`, `providers/whisparr/whisparr.adapter.ts::buildSceneViewUrl`; scene/acquisition/library consumers). The settings UI already has in-place “Save only” and “Save & Test” operations. Therefore the missing distinction is a data-and-linking feature, not a reason to reset and re-add integrations.

**Proposed fix.** Add an optional browser address to the shared integration form, persistence, DTOs and API client types for every currently supported connection: Stash, Whisparr, StashDB and FansDB. Use an explicit shared convention for future Hydra/download integrations too. Keep the internal API address for server calls, connection checks and protected-asset proxying; use the browser address only when constructing user-facing external links. Add a common URL builder that preserves reverse-proxy path prefixes and encodes entity IDs. Existing integrations are editable in place, preserving credentials, provider selection, requests and health state when only the browser address changes.

**Acceptance criteria.**

- A healthy existing integration can have its browser address changed without resetting it, re-entering an unchanged API key or repeating setup.
- Editing only the browser address makes subsequent scene/library/acquisition links use it while API requests still use the internal address.
- All existing user-facing service links are audited, including detail pages, queues, library cards and any direct service launch links; catalog-to-Portal entity navigation stays internal.
- Browser address input accepts HTTP(S), including local hosts and path prefixes; reject embedded credentials and unsafe schemes. Never append API keys to links.
- An unset browser address has a documented backward-compatible fallback; internal Docker hostnames are not rewritten by guesswork.
- A browser-only edit does not clear a healthy integration, reset catalog selection or disable another provider. Integration repair and initial setup use the same shared field.
- Tests cover internal API vs public host, HTTPS reverse proxies, path prefixes, trailing slashes, absent browser address, invalid input and unchanged stored credentials.

**Dependencies.** Additive storage/configuration change and a link-consumer audit. This is foundational for Q01. Adding an entirely new Hydra connection remains a separate integration feature.

## P3-Q03 — Prefill the re-request destination and quality

**Trigger and current root cause.** A legacy request has no saved settings. `RequestsService.getRequestOptions` intentionally returns null root/profile for an existing request without settings, and the modal branches on `settingsNotice` to preserve those empty values. For brand-new requests the modal instead chooses the first accessible root and first profile. There is no explicit instance default destination/profile in the current request-options flow. Thus valid saved settings work, but old requests repeatedly demand manual choices; the first item returned by Whisparr is not necessarily the user's preferred default. Batch settings currently load options using the first eligible scene, which also needs a clear instance-level fallback rather than silently adopting arbitrary per-scene preferences.

**Proposed fix.** Make library destination and quality profile configurable Portal acquisition defaults, editable without reconnecting Whisparr. Resolve values in this order: valid saved per-request settings, valid explicitly configured defaults, then the sole accessible/valid option if unambiguous. Otherwise retain a required choice. Show where the prefilled values came from and keep them editable before confirmation. Preserve valid saved tags/monitor/search preferences; do not treat prefilling as permission to overwrite an existing Whisparr entry's settings.

**Acceptance criteria.**

- A legacy re-request opens with the configured default library and quality selected, without an extra settings step when both remain valid.
- Valid saved preferences take precedence; removed profiles and inaccessible/removed roots never submit silently.
- Multiple possible destinations with no configured default remain visibly unresolved, rather than using whichever option arrives first.
- Single and batch flows follow the same rule, while batch confirmation clearly describes common settings for new entries.
- The options response identifies defaults and warnings consistently; the modal uses the returned values directly rather than inferring intent from a warning string.
- Opening/reopening a settings modal never submits a request. Confirmation revalidates the selected root/profile against the current Whisparr configuration.

**Dependencies.** Integration/defaults settings storage and UI; coordinate with Q05 so “resume existing” does not unexpectedly change monitoring, root, quality or tags.

## P3-Q04 — Harmonize request controls and dialogs

**Trigger and current root cause.** Request action components render plain buttons and style them with a broad local `button` selector (`shared/request-actions/request-actions.component.scss`). Other Portal controls use PrimeNG `pButton` and existing page-specific primary/secondary styles. The request-history and deletion dialogs include plain buttons, batch controls reuse the local style, and acquisition-page `.secondary-action` rules are scoped to that parent component rather than a stable shared button contract. This produces mismatched heights, corners, spacing and interaction states.

**Proposed fix.** Inventory the existing Portal button variants and use one shared style/component contract for primary, secondary, danger, compact and icon-only actions. Update the new request, history, preview, confirmation, outcome-check and restore controls to use it. Keep primary action hierarchy clear and deletion confirmation visibly distinct. Reuse current design tokens and accessible states rather than introducing a parallel visual system.

**Acceptance criteria.**

- Request actions, batch controls and dialogs match existing Portal controls in both themes and desktop/mobile layouts.
- Hover, focus, disabled and loading states are consistent and preserve keyboard accessibility.
- Compact queue controls wrap sensibly; long labels and busy text do not overflow narrow cards or dialogs.
- Styling changes do not alter eligibility, operation keys, confirmation or submission behavior.
- Verify representative queue, scene, request-history and batch-dialog screens visually, alongside behavior tests.

**Dependencies.** Coordinate with Q01/Q03/Q05 so new controls enter the same design system. No backend change is required for the core styling work.

## P3-Q05 — Re-request should resume the existing pipeline, not fail on an existing queue record

**Trigger and current root cause.** The user's report is consistent with several different existing paths, which should be made one coherent contract. `previewBatch` explicitly marks `RE_REQUEST` ineligible whenever the Whisparr movie already exists, returning “Already in Whisparr. Use Search again.” The single re-request submission instead succeeds by reusing an existing movie and refreshing the projection, but dispatches no search or import recovery. `RequestActionsComponent` normally exposes Re-request only for an orphan condition, so a valid existing acquisition has a different action surface. `searchAgain` already has explicit `ALREADY_QUEUED` and `ALREADY_SEARCHING` outcomes. A source inspection establishes these differences; an exact end-to-end reproduction of the user's particular reported failure remains an acceptance task.

**Proposed fix.** Define Re-request as an explicit, reviewed “resume/reconcile this acquisition” operation. Resolve current Stash, movie, queue and command state first, then choose a narrow existing pipeline step. Record the user's intent and concrete outcome in the durable action history even when the correct result is reusing an existing queued job. Single and batch eligibility/execution must agree. Return a useful success/resume state for an existing request rather than a generic duplicate failure.

| Fresh observed state | Required behavior |
| --- | --- |
| Matching scene already available in Stash | Reconcile availability and record “already available”; do not acquire another copy. |
| Whisparr entry missing, no owned file, no uncertain prior action | Create once using reviewed valid settings; refresh Portal. |
| Existing Whisparr entry awaiting release with no queued transfer/search | Reuse entry and, when search is requested, run one native search with the ledger's dispatch guard. Preserve upstream settings unless an explicit settings update was reviewed. |
| Healthy queued/downloading job or already-running search | Reuse it, refresh/reconcile status, and record that the acquisition is already active. Do not create a second movie/download or dispatch a redundant search. |
| Failed/blocked/completed queue item requiring import attention | Show the actual blocker and a specific supported recovery action. Verify native Whisparr capabilities before choosing a command; do not invent a generic retry endpoint or silently remove/blocklist the job. |
| Whisparr has file but Stash catalog match is missing | Route to Q01 match review; do not redownload merely because the catalog association is absent. |
| Prior dispatch is uncertain or a claim is active | Keep the existing outcome-check path. A new action key or “resume” label must not bypass the uncertain dispatch guard. |

**Acceptance criteria.**

- Existing queued requests can be re-requested/resumed without a duplicate-entry error; their existing job is recognized and a human-readable history result is written.
- A completed previous operation replay with the same key returns its saved result; it does not rerun external work. A newly confirmed user intent receives a new ledger event and dispatches only the state-appropriate native step.
- Single and batch preview show exactly the action each scene will take. A batch does not label an existing active request ineligible merely because a record exists.
- Repeated clicks, concurrent sessions and retries after response loss cannot create duplicate movies/downloads or repeat a sent command whose outcome is unknown.
- Tests cover existing active/failed/import-pending queues, waiting releases, completed files, missing movies, preserved settings, snapshot/API failures, multiple copies, concurrent claims and uncertain dispatch after restart.
- History distinguishes “reused active acquisition,” “search started,” “already available,” “needs identification,” “blocked with reason” and “outcome unknown.”
- Replaying the pipeline means invoking the appropriate verified step, not blindly replaying every create/search call from the original acquisition.

**Dependencies.** Q01 for identity mismatches; Q03 for missing-entry settings; shared action/result types and frontend outcome presentation; native Whisparr capability validation for any queue/import recovery command. Preserve the durable RequestAction ledger, payload binding, per-scene claim, conditional dispatch and post-dispatch uncertainty handling introduced in Pass 2.

## Cross-cutting delivery criteria

- Preserve `apparmor=unconfined` in all stack container definitions and any isolated runtime validation, per the Proxmox requirement.
- Do not silently merge these fixes into the current Pass 3 review or deploy them with an unrelated release.
- No media moves/deletions, catalog identity rewrites, Whisparr entry deletion, queue cancellation/blocklisting or bulk recovery is implied by this issue queue.
- Before any deployment that replaces a running service, prepare its concrete candidate, backups and rollback scope, then obtain the bounded approval required by `media-server/AGENTS.md`.
