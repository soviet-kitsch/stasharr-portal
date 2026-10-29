# Request diagnostics and acquisition overview

29 October 2026. Implemented in the fork; production activation requires its separate reviewed deployment.

Acquisition now uses a compact paginated table. Stage and blocker filters count the full matching dataset, with scene/studio/performer search, attention/age/activity sorting and navigation state in the URL. Selection persists across pages and clears when the filter changes. Select all reads 50-row pages and refuses a changed snapshot; bulk recovery retains its existing review, exact identities, 20-item execution batches and uncertain-action guards. Current downloading/import progress takes precedence over old search results. Unavailable or stale observations are explicit.

## Automatic history

Request events are collected by a shared 15-second observer without opening any scene. Portal submissions/action outcomes remain recordable when Whisparr is unavailable. The observer captures native MoviesSearch command state/timestamps, confirmed grab/import/failure events and observed pipeline transitions. Events and attempts persist in PostgreSQL and are deduplicated by native identity or recorded action. Source identity includes the Whisparr integration and endpoint. Native history has a durable checkpoint with an overlap; malformed or oversized responses retain the previous checkpoint rather than proving absence. Initial native backfill is bounded to 30 days/5,000 events; Portal action history is backfilled independently.

**Request details** shows the timeline, separate search attempts, current observations, source limitations and connected-system links. History remains readable when an integration is unavailable. Timestamp-and-ID cursors preserve events with identical timestamps. Opening details or refreshing observations does not search indexers, submit downloads, identify media or change Stash catalog links.

The deployed Whisparr 3.6.5.1886 command/history APIs were checked read-only. The retained command list had zero MoviesSearch entries; a 30-day history read returned 99 native events with verified integer IDs/movie IDs and string event types/dates. Those included grab, download failure, import and file-record deletion events. The tested APIs do not supply retained automatic release decision/count evidence. Missing history must not be shown as `never searched` or a zero result.

## Diagnostic searches

**Run diagnostic search** deliberately starts a fresh interactive search/evaluation without grabbing. It uses normal indexer quota and may search different enabled sources from an automatic acquisition search. Its saved results retain Whisparr's native ordering, candidate identity, quality/size/source/seeders where supplied and every rejection string. Correctly mapped candidates are distinguished from unknown or different-scene mappings. Up to 200 candidate details are retained with complete evaluated-response counts when available; raw indexer hit counts and complete source coverage remain unknown.

Diagnostic searches use the durable acquisition-action claim, operation-key replay checks, a database-enforced single diagnostic slot, a 60-second scene cooldown and ten searches per rolling hour. A fresh identity/active-command check runs immediately before dispatch. The HTTP result is a persisted attempt ID; the worker continues independently of the browser. Timeouts and process restarts never automatically replay a search. An interrupted attempt can be explicitly closed after three minutes and a successful native command check showing no active search; this records closure without claiming results. A stored completed result can resolve a leftover local claim without another upstream search.

**Search again** and **Re-request** keep their existing acquisition behavior and can download releases. They remain separate from diagnostic evaluation. Diagnostic evidence cannot mark a scene available; existing conservative Stash matching still decides availability.

Complete original automatic-search rejection capture remains a capability limitation. This release does not add a Whisparr fork, host-log mount or speculative log parser. A new diagnostic search explains its own current candidates, not a past automatic attempt. Reports discarded before native release parsing may not appear in the evaluated candidate response.

## NZBHydra search controls

Settings → Acquisition stores Hydra's browser URL and Studio/Performers/Scene title defaults without reconnecting existing integrations. **Search Hydra** opens an editable query builder with individual performer choices and XXX preselected. Manually edited terms stay intact until Regenerate terms is chosen. Inside Request details the builder expands inline, avoiding a second modal.

The external link preserves a reverse-proxy prefix and uses Hydra 9.1.1's browser `query`/`category=XXX` contract, with no API key. It opens a prefilled form; the user starts the actual search in Hydra. Opening that link is not recorded as a completed search or download. Direct acquisitions retain the existing Hydra → qBittorrent/Weaver → Stash route, and unsupported independent content stays out of Eros.

Performer names are filled by a bounded ten-scene catalog batch per observer pass and refreshed after a day. Initial performer search coverage fills as that background metadata work completes. No per-row native requests are made when reading the acquisition table.

## Home, fullscreen and responsiveness

Home's large introduction/statistics block is replaced by a compact shortcut rail: scene, performer and studio searches; latest library entries; requests needing attention; and Customize Home. Saved rails and their editing behavior are retained. Buttons use the baseline appearance/typography.

A global fullscreen control calls the browser Fullscreen API directly from a click. On touch devices it requests landscape after entering fullscreen and releases its own orientation lock on exit, including browser-initiated exit and late lock completion. Unsupported or denied orientation locking keeps fullscreen usable and gives a rotation hint. Browser/OS support governs physical rotation; desktop orientation is not changed. It does not simulate rotation with CSS or alter device settings.

Local validation includes 440 backend tests, 175 frontend tests and both production builds. Browser fixtures check selection across 120 rows, all rejection messages, Hydra proxy/category/edited-query behavior, baseline button/typography comparisons in both themes, and mobile layout. A site-wide sweep covers 18 routes at 320, 390, 768, 1024, 1440 and 844×390 landscape widths in both themes (216 cases). A tablet/landscape table overflow found in the initial sweep was corrected; the repeated sweep has zero overflow or page-error cases. Tests use neutral data and block external requests. Physical mobile orientation remains browser/device-dependent; unit coverage verifies lock order, denial, exit and interruption behavior.

CI additionally applies the additive migration to synthetic existing data, preserves sessions/request/action records, verifies the database's concurrent/uncertain-search guard, and exercises authenticated diagnostics/table/settings/cursor contracts against the exact built image with every acquisition integration disconnected. Candidate-detail pruning is not activated by this release; records are retained until an explicit retention policy is approved.
