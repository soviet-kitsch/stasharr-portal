# Performer matching in scene discovery

Scenes > Performers in Scene has a match-mode selector: Any performer (OR), the existing default, and All performers (AND). AND requires every selected performer in the same catalog scene. Zero/one selected performer behaves the same in either mode. Performer matching combines with studio/tag criteria; tag AND/OR remains independent.

The choice is retained in the search URL as performerMode=AND, restored by Back/Forward and scene return links, and reset by Clear Filters. Changing it resets feed pagination. The API validates AND/OR and passes the mode to the provider: INCLUDES_ALL for AND, INCLUDES for OR. Filtering occurs before provider pagination, so counts and later pages are correct. Old URLs and API calls retain OR. No database/settings migration or acquisition behavior changes.
