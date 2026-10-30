# On-demand Stash availability

**Check Stash availability** is available in the acquisition row actions (inline when space permits, otherwise overflow) and scene Lifecycle actions. It makes a fresh read-only check, without needing a Whisparr entry or a Portal request. Nothing is prefetched per row.

Results distinguish Available in Stash, No match found, Couldn’t verify and Setup needed. Confirmed copies link directly to their Stash scene using the configured browser address. Exact catalog links use the instance's provider namespace; the existing source-identity fallback requires matching URL, studio and duration. Metadata-only records without listed files do not count as available. Explicit checks reject partial/malformed responses rather than interpreting them as absence. A file can still be imported but unidentified; a negative result explains identification and is not a filesystem search.

The check does not create/change tracking, update acquisition status, start Whisparr/Hydra searches, scan, identify, edit metadata or delete media. Existing automatic library synchronization remains responsible for Portal's cached lifecycle. The dialog offers Check again and the ordinary Stash library link. Provider errors leave availability unknown. No schema/settings migration is needed.


**Search Stash for all** sits in the Acquisition header beside Refresh, outside the selection/bulk toolbar. It gathers all currently tracked acquisitions across all pages, ignoring the current filters and selection, then checks them sequentially with visible progress and per-scene results. Results paginate in groups of 50 and preserve direct links to matched copies. Stop checking and Close cancel remaining client requests; no queued checks are dispatched after cancellation. A provider lookup already received by the server may finish. Nothing is prefetched, and a changed/incomplete acquisition snapshot aborts before Stash checks begin. Unknown responses never count as negative matches.

The source-identity fallback also supports manually acquired scenes with no scene-level catalog IDs. It still requires an authoritative matching source URL, a provider-qualified matching studio ID, and a listed file with positive size and matching duration. Title/filename similarity alone never establishes availability. This does not write catalog associations to Stash.
