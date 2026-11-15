# Search ranking

Finding a place by typing: ranking, typos, categories, "nearest", and what happens when a result is picked.
Code: `apps/studio/src/lib/poiSearch.ts` (pure, no dependency) and `src/components/viewer/PoiSearch.tsx`.

## Matching

The query and each POI are normalised (lower case, accents and punctuation removed) and split into words. Every
query word must match some word of the POI's label, aliases, category name or description. A word match is, best
first:

| Tier | Rule | Example |
|---|---|---|
| prefix | the field word starts with the query word | `reg` → Registration |
| substring | the query word occurs inside the field word **and** covers at least half of it | `desk` → helpdesk |
| fuzzy | optimal-string-alignment edit distance (adjacent swaps count as one edit) to the word or to its prefix of the same length: 0 edits below 3 letters, 1 up to 5, 2 beyond | `strat` → Start, `bathrom` → Bathroom |

The half-the-word rule keeps short queries buried in long words out (`strat` inside "regi**strat**ion" is not a
match). Matches are weighted by field: label 1.0, alias 0.9, category 0.6, description 0.4, and the first word of
a label gets a small bonus. A POI's score is the mean over query words.

## Ordering

`rankPois` sorts by relevance band (score rounded down to 0.5), then by **walking distance** from the visitor,
then by score and label. Walking distance is the length of the planned route (see [PATHFINDING.md](PATHFINDING.md)),
not the straight line, and is cached per grid cell the visitor stands in. Unreachable POIs sort last and show
"no route". An empty query lists everything nearest first.

## Categories and "nearest"

- **Chips** filter to one category, with counts; they appear when the scene has more than one category.
- **`nearest door`, `closest exit`, `desk near me`**: `parseQuery` recognises the phrasing. A category word or
  synonym (exit/door/entry → entrance, desk/help/info → service, ...; typos allowed) selects that category;
  anything else is searched normally. `nearestByWalking` takes candidates from the spatial index in straight-line
  order and stops as soon as the next candidate's lower bound (straight-line distance minus approach offset and
  snapping slack) exceeds the k-th best walking distance, so it plans only a few routes. On a test grid of 120 POIs
  behind a wall it returns exactly the brute-force order while planning fewer than half the routes.

## Empty state

No match: close spellings are offered ("Did you mean Stage", edit distance ≤ a third of the query), else the three
nearest places, plus a way out of the active category.

## Keyboard and selection

`/` (or Ctrl/Cmd+K) focuses search; ↑/↓ highlight; Enter picks; Esc clears the query, then leaves the field.
Picking a result:

1. opens its POI card and selects its pin;
2. turns the camera to face it if it is **in view** (an unobstructed grid line of sight within 20 m, `poiInView`),
   over 450 ms, cancelled by any look or movement;
3. draws the route as a faint preview ribbon (`routeTo(id, { preview: true })`).

Enter on the already-picked result, **Route here** or **Plot route** starts guidance. **Go to view** flies along
the route (`src/lib/routeFlight.ts`: 0.7–3 s by length, eased in and out, looking ahead, turning to face the POI
over the last 30 %), or fades out and back in (360 ms) when there is no route, so the camera never passes through a wall.

## Deep links

`?scene=<name>&poi=<id>&route=1` opens the scene, selects the place and, with `route=1`, starts guidance from the
spawn point (a saved viewpoint is not restored). Without `route=1` the place is selected and its route
previewed. An unknown id shows a toast and nothing else. **Copy link** on a place card copies such a link (or shows
it when the clipboard is blocked). Helpers: `src/lib/deepLink.ts`; tests: `tests/deep-link.test.ts`.

Tests: `tests/poi-search-ranking.test.ts` (tiers, typos, categories, nearest by walking, suggestions),
`tests/poi-search.test.tsx` (markup, chips, empty state), `tests/route-flight.test.ts`, `tests/poi-in-view.test.ts`;
end to end in `tests/e2e/viewer-route.spec.ts`.
