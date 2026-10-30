# On-demand Stash availability

**Check Stash availability** is available in the acquisition row actions (inline when space permits, otherwise overflow) and scene Lifecycle actions. It makes a fresh read-only check, without needing a Whisparr entry or a Portal request. Nothing is prefetched per row.

Results distinguish Available in Stash, No match found, Couldn’t verify and Setup needed. Confirmed copies link directly to their Stash scene using the configured browser address. Exact catalog links use the instance's provider namespace; the existing source-identity fallback requires matching URL, studio and duration. Metadata-only records without listed files do not count as available. Explicit checks reject partial/malformed responses rather than interpreting them as absence. A file can still be imported but unidentified; a negative result explains identification and is not a filesystem search.

The check does not create/change tracking, update acquisition status, start Whisparr/Hydra searches, scan, identify, edit metadata or delete media. Existing automatic library synchronization remains responsible for Portal's cached lifecycle. The dialog offers Check again and the ordinary Stash library link. Provider errors leave availability unknown. No schema/settings migration is needed.
