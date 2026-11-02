# Performer matching in scene discovery

Scenes > Performers in Scene has a match-mode selector: Any performer (OR), the existing default, and All performers (AND). AND requires every selected performer in the same catalog scene. Zero/one selected performer behaves the same in either mode. Performer matching combines with studio/tag criteria; tag AND/OR remains independent.

The choice is retained in the search URL as performerMode=AND, restored by Back/Forward and scene return links, and reset by Clear Filters. Changing it resets feed pagination. The API validates AND/OR and passes the mode to the provider: INCLUDES_ALL for AND, INCLUDES for OR. Filtering occurs before provider pagination, so counts and later pages are correct. Old URLs and API calls retain OR. No database/settings migration or acquisition behavior changes.

## Studio scene lists

Studio pages also offer performer chips with Any (OR) / All (AND) matching. Suggestions are scoped to the current studio. The studio remains a mandatory scene criterion when adding/removing performers or changing match mode. Performer IDs, JSON-encoded labels and mode persist in the studio URL and through scene return navigation. Filter changes reset scene pagination; stale results are ignored. Removing all chips restores the studio scene list while retaining the other filters. Changing studio invalidates earlier-studio suggestion results. Global Scenes search retains its unrestricted performer suggestions.
