export function requestOutcomeMessage(outcome: string | undefined): string {
  return (
    (
      {
        REQUEST_CREATED: 'A new Whisparr entry was created.',
        ALREADY_AVAILABLE: 'Already available in Stash.',
        ENTRY_REUSED: 'The existing Whisparr entry was reused.',
        ALREADY_QUEUED: 'The existing acquisition is already queued or downloading.',
        ALREADY_SEARCHING: 'A search is already active; no duplicate search was sent.',
        SEARCH_STARTED: 'One search was started on the existing entry.',
        SEARCH_CONFIRMED: 'The search was confirmed without sending it again.',
        NEEDS_IDENTIFICATION: 'The file is imported. Review its Stash match or identification.',
        IMPORT_PENDING: 'The existing download needs import review in Whisparr.',
        UPSTREAM_BLOCKED: 'The existing Whisparr queue entry needs attention.',
        DISMISSED: 'Removed from Portal only.',
        RESTORED: 'Portal tracking restored.',
        OUTCOME_UNKNOWN: 'The outcome remains unknown. Check it before retrying.',
        NOT_SENT: 'The action was not sent.',
      } as Record<string, string>
    )[outcome ?? ''] ?? ''
  );
}
