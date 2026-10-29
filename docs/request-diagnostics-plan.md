# Request diagnostics implementation plan

29 October 2026. Planning only. This extends the maintained Portal fork; no application implementation, runtime configuration, searches or deployment is included.

## Product outcome

Every requested scene should answer four questions: what has happened, what is blocking progress, what evidence supports that answer, and what can I do next?

The first screen is a concise explanation. Native IDs, source evidence and all candidate details are available by expanding the relevant attempt. Current pipeline state, historical attempts and a fresh diagnostic search are presented separately.

The acquisition overview becomes a compact table as part of the first release. Short status summaries and useful queue-wide counts are core scope, including requested scenes waiting for acquisition; they are not deferred to an optional analytics dashboard. Discovery pages can retain their existing presentation.

## User experience

Replace the small Request history dialog with a reusable Request details view, reachable from Requested, Awaiting Import, Failed and scene details. Preserve all existing actions and their recorded history. Use the established baseline buttons and typography, with a responsive drawer/panel rather than nested dialogs.

1. **Current situation:** a plain-language summary, last checked time and service health. Example: `Whisparr has the scene, but no download is active. The last recorded search completed; its release decisions were not retained.` Availability continues to use existing conservative Stash reconciliation.
2. **Timeline:** Portal submission/re-request, Whisparr creation/reuse, search start/completion, grab, download/import failure or success, and Stash match observations. Display source time and observation time when they differ. An observed transition is not an invented native event.
3. **Search attempts:** newest first, expandable. Each records trigger/mode, start/end, query when known, configured/participating source evidence, counts with precise definitions, and result completeness. Do not treat a completed command as proof of zero results.
4. **Candidate decisions:** show the top relevant returned candidate and every rejection reason, with other candidates expandable. Keep Whisparr's ordering; show match uncertainty. Wrong-scene results are separate from correctly mapped candidates. Do not call the largest file the best candidate.
5. **Actions:** Refresh observations, Check pending action, Run diagnostic search, Search NZBHydra, existing Search again/Re-request, Review Stash match and relevant service links. Keep their effects visibly distinct. Delete request retains its existing dismissal/history behavior.

Suggested queue filters: No retained search evidence; Last search returned no usable candidates; All evaluated candidates rejected; Indexer/search problem; Download/import problem; Waiting for Stash match. A filter uses the latest applicable attempt and exposes its date; old evidence does not silently become current truth. Filter/count queries run across the full dataset before pagination, not only rendered cards.

### Acquisition table and short status

Replace scene cards and large summary cards with a dense table and compact count/filter controls. Cover all existing acquisition stages, with particular emphasis on Requested and scenes waiting for acquisition. `Waiting for acquisition` is a user-facing description of the existing requested/waiting-for-release situation, not a second duplicate lifecycle. Keep Awaiting Import distinct: it means there is already a download/import or matching step to resolve.

Default columns:

- Selection checkbox, with an explicit all-matching selection control and count.
- Scene: linked title, with compact studio/performer information below; optional small thumbnail, without large artwork or long descriptions.
- Stage: Requested, Downloading, Awaiting Import or Failed, using existing lifecycle semantics.
- Short status: one concise, evidence-backed explanation, with a small latest-search result/source/time line where useful.
- Last activity: event time and request age; distinguish an old event from the last successful status observation. Unknown times remain unknown.
- Actions: visible Request details and Hydra search when configured, with secondary recovery actions in an accessible menu. Preserve existing operation guards and review flows.

Example short statuses: `Search queued`, `Searching`, `No candidates returned`, `All candidates rejected`, `Size limit`, `Search incomplete`, `No search history`, `Missing in Whisparr`, `Downloading`, `Import blocked`, `Waiting for Stash match` and `Status stale`. Show a compact count such as `6 rejected` only when supported; otherwise show unknown/partial evidence explicitly. A brief secondary explanation such as `Top candidate exceeds size limit` must not conceal additional rejection reasons in Request details.

Derive each row on the server from current lifecycle, active action, provider freshness and latest relevant attempt. Current download/import progress takes precedence over an old search failure. Stale or unavailable observations do not overwrite historical facts or assert absence. An interactive diagnostic attempt remains labelled as diagnostic; it does not replace the historical automatic-search outcome or imply a download occurred. Diagnostic and acquisition statuses can be displayed together when both are relevant.

Above the table, provide compact counts for existing stages plus Needs attention, No candidates, Rejected and Unknown/stale evidence. Diagnostic categories may overlap: label them as filters rather than presenting an additive total. All counts reflect complete server-side query scope. Provide scene/studio/performer text search, stage/blocker filters, and sorting by attention, request age and last activity. Default to actionable problems first, then oldest waiting requests, with stable IDs as tie-breakers; allow the user to change it. Preserve filter/sort/page position in navigation.

Use explicit pagination rather than infinite card loading for predictable comparison and selection. Page selection and all-filtered selection must state their scope and selected count. Changes to filter/search scope clear selection; paging alone preserves it. Bulk review uses the exact selected identities and current eligibility, so live status updates never silently substitute other scenes. Existing Select all behavior across more than one 50-row API page and sequential 20-action execution batches must remain correct. Cap/review large selections using the existing server contracts rather than bypassing them.

Small screens retain a compact row/list with Scene, Short status and Details always visible, with secondary information available on expansion. Keep text labels alongside colors/icons, semantic table markup on desktop, accessible sorting/selection and established baseline button typography. The overview reads one paginated projection; it must not make separate native-service or search requests for every row. Automatic observations update summaries in the background independently of opening Request details.

## Evidence and outcome rules

| Evidence                                                                                | Allowed conclusion                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Portal persisted a request/command dispatch                                             | Submission/search sent, or outcome uncertain if acknowledgement was lost               |
| Native command is running or completed                                                  | Search running/completed; result count remains unknown without result evidence         |
| Complete evaluated-candidate response is empty                                          | No evaluable candidates returned by this search; raw indexer hit count remains unknown |
| Candidates exist and every evaluated candidate is rejected                              | All evaluated candidates rejected; expose counts and reasons                           |
| Search failure, truncation, malformed payload, unavailable or partially failed indexers | Failed/incomplete outcome; never a definitive zero or unavailable release              |
| Native grab/import event                                                                | That event occurred; it does not independently prove a Stash match                     |
| No retained command or correlated history                                               | No retained evidence; never `never searched`                                           |

Raw indexer hits, parsed/evaluated candidates, accepted candidates and grabbed releases are different counters. Store them as nullable values with provenance; do not substitute zero for unknown. Report source coverage independently from result counts. Distinguish upstream configuration, requested sources, sources actually contacted and sources confirmed successful; a configured count is not successful coverage.

Historical facts stay attached to their original attempt and configuration snapshot. Present-day profile settings may help explain the current situation, but cannot prove a historical threshold. Record contemporaneous profile/size/seeder settings when available. When only a native rejection string exists, show it without inventing numeric limits.

## Increment 0: validate automatic-search capture

Run this investigation early, alongside the design of the evidence model. It is a bounded capability spike, not a dependency for all UI work.

- Check deployed Whisparr 3.6.5.1886 command/history contracts, retention, ordering, pagination and native event/live-stream capabilities.
- Determine whether supported APIs expose per-attempt automatic-search counts and decisions. Initial investigation has not established such an interface; command status alone is insufficient.
- If native events are inadequate, test a read-only log observer against controlled fixtures for overlapping searches, identity/parse failures, RSS searches, truncation, restart and rotation. Correlate only with proven command/movie identities. Uncorrelated messages remain unattributed evidence.
- Separate automatic request searches, interactive diagnostic searches and RSS discovery. They may use different enabled sources and cannot be substituted for one another.
- Prefer native APIs/events, then an isolated read-only observer. Do not introduce a Whisparr fork or broaden Portal's host/log access silently. If a new observer is needed, prepare its own exact permissions, credential handling and deployment scope.

Exit artifact: supported capture matrix, representative credential-free fixtures, completeness limits, and a decision about whether reliable automatic release decisions can ship with Increment 2. If not, ship honest command/history evidence and explicit diagnostic searches while documenting this gap. Do not present that reduced scope as complete automatic-search analytics.

## Increment 1: durable request evidence and timeline

### Storage and integration

Add additive Prisma models for:

- **RequestDiagnosticEvent:** catalog identity, integration-instance identity, optional RequestAction/attempt reference, source/native event ID, event type, event/observation times and a versioned allowlisted evidence object.
- **RequestSearchAttempt:** action reference, native command ID when proven, mode/trigger, dispatch/start/end times, execution state, outcome/completeness, nullable counters and a bounded configuration snapshot.
- **DiagnosticSyncState:** durable history cursor/checkpoint, last successful observation and errors, keyed by integration instance.

Retain RequestAction as the authority for acquisition dispatch and uncertainty. A diagnostic observation must not clear an acquisition claim, create a second request or infer a successful grab. Scope native IDs to an integration instance and verify its movie/catalog mapping; recycled IDs or changed integrations do not attach events to unrelated scenes. Retain catalog provider alongside scene UUID in the new evidence even though full multi-catalog acquisition remains outside this pass.

Extend WhisparrAdapter with validated read-only command detail and paginated native history support. Reuse existing queue/library observations instead of creating another full synchronization pipeline. Record source events idempotently; commit new events and cursor together; use a small overlap and native-ID deduplication. Incomplete pages or API failure do not advance the cursor or prove absence.

Observe active commands promptly after confirmed dispatch, with a shared bounded poll (suggested 5 seconds while commands are active, otherwise reuse the 30-second queue cadence). Polling is one shared operation, not one loop per browser or queue card. Poll retention gaps are visible; polling cannot guarantee complete native decision capture. Pause/limit background work during outages and retain original timestamps.

Backfill existing RequestAction records and bounded native history where attribution is proven. Mark original versus reconstructed evidence. Propose the most recent 30 days or 5,000 native history events initially, whichever bounds work first; expose truncation and backfill start time. Do not rewrite old action results or infer missing initial-request command IDs from timestamps alone.

### API and presentation

Suggested additive API contract:

- `GET /api/requests/:stashId/diagnostics`: current summary, latest attempt summary, freshness/limitations and links, all from stored evidence.
- Paginated event and attempt subresources with stable cursors; no arbitrary last-20 limit hiding older history.
- `POST /api/requests/:stashId/diagnostics/refresh`: refresh read-only native observations and persist them. It does not search, grab, identify or move media.

Opening a view performs no indexer search. Existing history consumers remain compatible during rollout. Reuse existing browser URL utilities, Stash match review and request action components. Show queue filter counts from an indexed projection only after defining latest-attempt precedence and stale-state handling.

Extend the paginated acquisition feed with the shared diagnostic summary and server-side blocker/search/sort criteria. Use the same summary derivation in the table and Request details. Add required indexes and aggregate counts, with no per-row provider queries. Implement table pagination, selection, navigation state and short status presentation in this increment; candidate-specific rejection summaries fill in when Increment 2 supplies the evidence.

## Increment 2: diagnostic searches and rejection analytics

Add an explicit `POST /api/requests/:stashId/diagnostic-searches` with an operation key. It creates a persisted attempt/job and returns an ID so a slow upstream response or browser navigation does not lose the attempt. Native `GET /api/v3/release?movieId=...` performs a fresh interactive search/evaluation and consumes indexer quota, even though its method is GET. Never call it from automatic view refresh.

This diagnostic action does not grab a release. Keep the existing automatic Search again action separate; that command may acquire media. Before either kind of search, check for a conflicting running search and use a shared server-side per-scene guard. Preserve the existing durable acquisition claims. A diagnostic timeout may leave a native search running: record an unknown outcome, retain the guard while native activity is known, and do not blindly retry because the lease or HTTP request expired. A crash after dispatch must not silently create a second search on restart.

Suggested initial bounds, validated in the capability spike: one diagnostic search at a time globally, 60-second per-scene cooldown, 10 manual diagnostic searches per rolling hour, a 120-second upstream timeout and 200 persisted candidate rows per attempt. Persist aggregate returned/rejection counts before truncating saved candidate detail, and label detail truncation. If the HTTP payload limit prevents receiving the complete response, completeness and totals remain unknown. Indexer fan-out may consume multiple provider hits per diagnostic search; these application limits do not promise a provider-quota cap.

Persist native ordering and allowlisted fields: title, source/indexer, protocol, size, parsed quality, mapped identity, seeders if provided, custom format score, decision flags and all rejection reasons. Render strings as text. Exclude credential-bearing download/magnet URLs, cookies, headers and raw payloads from diagnostics responses/logs. Provide native source links only through explicit safe link construction.

Use helpful explanations for size/profile, matching/parsing, seeders, blocklist, existing-file and temporary-service blocks, while retaining native reason text. Show actual-versus-policy values only from contemporary evidence. Highlight a top relevant candidate with an explicit scope such as `Top returned candidate`; never assert that it is the best release on all indexers. Version differences/identity ambiguity remain visible.

Suggested retention: retain compact events and attempt summaries with the request history; retain bounded candidate details for 90 days, with `Detailed candidates expired` thereafter. Implement no destructive production pruning until the exact retention policy and activation are approved. Backups include the new models.

The core table, short statuses and blocker counts are included in Increment 1. Optional later analytics can add rejection reason frequencies and search coverage over time. Label the denominator and period, distinguish reconstructed/unknown evidence, and never present an incomplete sample as a global success rate.

## Increment 3: configurable Hydra search recovery

Add Hydra search settings without requiring users to reconnect existing integrations. A basic external search builder needs a browser URL and term preferences, not Hydra API credentials. Follow the established separate browser/API address convention if later availability previews add an authenticated Hydra integration.

- GUI defaults for Studio, Performers and Scene title; suggested initial selection Studio + Performers, with title optional. Offer individual performer deselection and an editable query preview on each request.
- Saved global defaults plus temporary per-request choices; a manually edited query remains intact until the user explicitly regenerates it.
- Missing fields are omitted with a visible explanation; reject an empty final query; normalize whitespace/deduplicate repeated names without silently dropping meaningful terms.
- Default category is XXX. Browser query parameters are `query` and `category=XXX`; Newznab's `q`/`cat=6000` are not the browser contract.
- Default behavior is a prefilled editable Hydra form in a new tab. This uses the verified bare-query behavior. An auto-running mode is optional only after compatibility testing against the actual Hydra version; do not misuse an unverified link contract or silently select all indexers.
- Preserve configured proxy prefixes; allow only HTTP(S); no keys in browser URLs; external links use standard new-tab protections.
- Do not log `search completed` from opening a link. At most record `Hydra search opened` with that narrow meaning if useful, never inferred hits or downloads.

Manual downloads retain the current Hydra → qBittorrent/Weaver → Stash routing. Unsupported independent content stays out of Eros. Mark a Portal request available only after existing verified Stash matching; a browser click is not completion. A future availability-preview feature can reuse the query builder and evidence model, but is outside this pass.

## Validation and rollout

Use neutral fixtures for the UI and native responses. Test successful zero versus unknown raw hits, all rejected, mixed decisions, provider errors, partial coverage, malformed/truncated responses, stale data, several simultaneous searches, restarts, action replay, unresolved dispatch, log rotation if used, native ID reuse, pagination and integration changes. Test original automatic versus later interactive attempts remain distinct.

Validate size explanations against contemporary settings and retain all reasons. Verify drawer opening, polling and observation refresh send no indexer-search or grab calls. Test query checkboxes, aliases/commas/special characters, empty fields, user edits, default persistence and reverse-proxy prefixes. Compare baseline typography/buttons on desktop/mobile and light/dark; verify keyboard focus and accessible status announcements.

For the acquisition table, validate short-status precedence, diagnostic-versus-automatic provenance, full-dataset counts/filters/sorting, stable pagination, stale evidence, all-filtered selection across more than 50 rows, exact bulk-review identities, filter-change selection reset and retained navigation position. Check that current download/import activity supersedes old rejection labels and that mobile layouts keep the status visible. Verify one feed request supplies row summaries without per-row upstream calls.

Run relevant backend/frontend suites and builds. Apply additive migrations to a disposable restored database, confirm old history remains available and run the exact candidate image through authenticated runtime checks. Any bounded live diagnostic search must be explicit and measured; it is not bundled into read-only verification. No test grabs or forced imports are required.

Deploy through the existing pinned fork pipeline with backup and guarded rollback, retaining sessions, integration settings, action history and `apparmor=unconfined`. A Portal container replacement requires the separate concrete deployment approval mandated by the repository AGENTS.md. A new observer or permission/mount change, if required, needs its own reviewed scope. No deployment is authorized by this planning document.

## Codex complexity and deliverable order

| Increment                                                     | Complexity               | Deliverable / main risk                                                                                                           |
| ------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 0. Capture capability spike                                   | Medium, potentially high | Proven source/coverage matrix; reject unreliable historical inference                                                             |
| 1. Evidence + timeline + acquisition table                    | Medium–high              | Additive storage, attribution, backfill, shared short statuses, server-side counts/filtering and selection/navigation regressions |
| 2. Diagnostic decisions                                       | Medium–high              | Explicit search job, durable replay behavior, rejection presentation and quota controls                                           |
| 3. Hydra search builder                                       | Low–medium               | Settings, term controls, preview and verified browser link behavior                                                               |
| Full automatic decision capture if native APIs are inadequate | High                     | Separate observer or upstream hook; constrained by reliable correlation and retention                                             |

Implementation order: capability spike and shared evidence design first; timeline and acquisition-table foundation next; diagnostic decisions next; Hydra builder can be developed independently after the common request-detail/settings contracts are settled. First release should include the table, short statuses, timeline, explicit diagnostic results and Hydra recovery together if the spike exposes no substantial new operational dependency. Full automatic capture has an explicit acceptance gate rather than an assumed promise.
