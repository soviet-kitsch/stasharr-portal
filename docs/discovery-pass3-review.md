# Portal discovery Pass 3

27 October 2026. Implemented locally on top of the deployed acquisition release `0b89cbe4624f05065dc95a2a4d2a4b5765e5fe5d`. No production service replacement, migration or acquisition action is included in this pass.

## User-visible changes

- Scenes gains a searchable performer picker, up to 20 selections, matching any selected performer. Performer, studio, tag, favorites and sort criteria combine at the catalog service before pagination; totals remain provider totals.
- Performers gains a searchable single-studio picker. The catalog supports exact studio membership, including correct global pagination and popularity sorting. Selecting a network does not expand descendants; the UI explains that child studios must be chosen separately.
- Performer popularity uses native `POPULARITY`, labelled “Popularity (StashDB)” with a community fingerprint-submission explanation. It is separate from scene count; no numeric score or recent-trending claim is invented.
- New filter IDs and labels survive links, reloads and browser Back. Performer labels use JSON in the URL so commas do not corrupt them. Obsolete search/feed responses do not replace the new scope. Clear Filters resets the added selections.
- A scene's studio logo and studio name open its internal Portal studio page. Catalog card studio badges also open the studio page and retain a return link. Local-library badges keep their existing library filter behavior because their studio identifiers may be local Stash identifiers.
- Studio pages offer “Browse performers at this studio.” Performer links and tag links already use internal Portal routes; studio parent/child links were also already internal. Explicit playback/system/source links remain external and are covered by the separately queued browser-address issue.

## Validation and evidence

- 347 backend tests pass across 35 suites, including provider-side combined filtering/global totals, native popularity with studio/name/gender/favorites, malformed query limits, unsupported-provider errors and acquisition regressions.
- 110 frontend tests pass across 29 files. Coverage includes filter hydration/clearing/Back, labels with commas, stale search/feed responses, search failure/retry, internal studio links and existing request actions. After the final URL-label refinement and studio-to-performers link assertion, the affected nine tests pass again.
- Backend and frontend production builds pass. No dependency or lockfile change, database migration, new credential, catalog switch or runtime configuration change is needed.
- Read-only live StashDB checks confirmed the native fields, performer popularity and exact studio membership. Bounded samples returned a studio-filtered total of 656 and a performer-scene total of 4,067; these are sample counts, not fixed product values. All filtering uses the provider's full query, not just loaded cards.
- An isolated neutral-data browser preview was prepared, but the in-app browser could not reach the local fixture listener. No visual screenshot validation is claimed. The temporary listener was stopped; component rendering tests and production compilation completed successfully.

The live catalog is StashDB. FansDB is not configured and its live capabilities are unverified. Unsupported provider queries propagate errors rather than silently showing unfiltered or empty results. No full-catalog crawl was performed.

## Bonus validation

Detailed credential-free evidence is retained in `.verification/portal-pass3-20261027/bonus-validation.md` in the shared workspace. Upstream popularity semantics are supported by [the performer query implementation](https://github.com/stashapp/stash-box/blob/bad1b8d69f2d1ac49b540f582ce555dc8007427f/internal/service/performer/query.go) and [the aggregate view definition](https://github.com/stashapp/stash-box/blob/bad1b8d69f2d1ac49b540f582ce555dc8007427f/internal/database/migrations/postgres/65_split_popularity_views.up.sql). The live sort was independently checked; the live service's exact upstream revision was not established.

- Genuine performer popularity is available and included in this pass.
- Native tag popularity and tag scene-count fields are absent. Count-only tag scene queries work; complete global usage sorting needs bounded cached count coverage in Pass 4. Scene usage must be labelled as usage, not popularity.
- Hydra's search API works. One bounded studio/date search for an already-owned scene returned zero results, demonstrating why empty results must not be labelled “Unavailable.” Supported response/history evidence did not establish per-indexer coverage or rate-limit completeness. The search created ordinary history/quota usage only; no grab or downloader call was made.
- FansDB remains pending. Portal currently chooses one instance-wide catalog; simultaneous providers and independent acquisition tracking still need the later integration work. Existing guards preventing unsupported IDs from entering Whisparr remain intact.

## Queued issues after passes 1 and 2

The five issues reported during this pass are tracked separately in `post-deployment-issues.md`, with root causes, acceptance criteria and Codex complexity. They are queued, not implemented by this discovery change:

1. Guided recovery when a file is imported but its Stash catalog match is absent.
2. Separate editable browser URLs from internal API URLs for connected services, without re-adding an integration.
3. Prefill re-request settings from valid saved/configured defaults.
4. Harmonize added buttons/dialogs with Portal's existing design.
5. Make single/batch re-request resume an existing acquisition consistently and record its history, while retaining uncertain-dispatch protection.

The source inspection found a contract mismatch in issue 5: single re-request reuses an existing Whisparr entry without starting another search, whereas batch preview rejects existing entries. An exact reproduction of the user's particular error is still part of that issue's acceptance work. Removing duplicate-dispatch safeguards is not its proposed fix.
