# Acquisition recovery

Portal marks a requested scene available when Stash has its active catalog link and a file record. Whisparr reporting `hasFile` alone means the scene still needs its Stash scan or catalog association.

In Awaiting Import, open **Review Stash match**. It reads current Whisparr and Stash records on demand. **Open Stash scene** opens a single identified candidate directly; multiple candidates have individual links instead of a guessed destination. No candidate means there is no verified scene-specific Stash link yet.

- **Exact catalog match found:** verify the video, then choose **Refresh this scene** to reconcile Portal's observations.
- **File candidate with no catalog link:** compare the actual file with the requested catalog scene, review Identify in Stash and save the intended association, then refresh this scene.
- **Different catalog link:** compare the actual video and both scene versions first. If Whisparr assigned the wrong scene, correct the assignment through manual import while preserving the file. If Stash has the wrong link, correct it through Identify, retaining legitimate alternate-version links. Refresh Portal afterward.
- **No file candidate:** confirm that the completed folder is a configured Stash library path and scan it in Stash, then identify the scene and refresh Portal. A failed lookup is never evidence that the file is absent.

Refresh this scene updates Portal observations only. It does not change metadata, move files, start a download or mark a filename-only match available. Availability describes provider file records, not filesystem readability.

**Select all in Awaiting Import** and **Select all in Requested** include all pages of that section. Clear selection resets it. Bulk actions review the entire selection before submitting sequential batches of at most 20 scenes. Every batch keeps the same operation key, which the server combines with the scene ID for idempotency. Stop and inspect history if an outcome is uncertain. Deleting requests only dismisses them in Portal and preserves media.

Browser actions generate cryptographic UUIDs using `crypto.getRandomValues`, including on plain-HTTP LAN installations where `crypto.randomUUID` is unavailable.
