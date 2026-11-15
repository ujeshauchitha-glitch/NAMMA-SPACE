# POIs and the spatial index

A point of interest (POI) is a named place in a scene: a desk, a door, a room. This page covers how POIs are
stored, indexed, shown in 3D and edited. Paths are relative to `apps/studio/`.

## The POI record

`semantic/pois.json` in each scene bundle, validated by `PoiSchema` in `src/types/scene.ts`:

| Field | Meaning |
|---|---|
| `id`, `label`, `category` | stable id, display name, one of room / service / landmark / furniture / entrance / other |
| `position` | where the pin is drawn (metres, scene frame, y up) |
| `approachPoint` | where a visitor stands to reach it: always a walkable cell centre at eye height, so routes end there |
| `aliases`, `description` | extra words for search; card text |
| `zone` (optional) | floor polygon in x/z metres (≥ 3 vertices, non-zero area, checked by the schema) |
| `confidence`, `source` | provenance (shown only in the authoring view, `?edit=1`) |

An approach point is snapped to the nearest walkable cell (`nearestWalkableCell`, breadth-first over the grid)
when a POI is created or moved. One that is not walkable is flagged in the editor ("not walkable: move the POI
closer to open floor") and, when routed to, reported ("no verified walkable approach point") instead of producing
a route into a wall. `scripts/make_pois.py` does the same snapping offline and
`scripts/validate_scene.py` checks a whole bundle.

## Spatial index

`src/lib/poiIndex.ts`, class `PoiSpatialIndex`: a uniform grid of 2 m buckets on the floor plane. A plain POI
sits in the bucket containing its position; a POI with a zone is stored in every bucket its zone's bounding box
overlaps. Distance to a POI is 0 inside its zone, the distance to the zone edge outside it, and the distance to
its position otherwise.

| Query | Use |
|---|---|
| `within(x, z, r)` | "Nearby" on the POI card (other POIs within 3 m) |
| `nearest(x, z, k)` | ring-by-ring search outward, stops once k hits are closer than the next ring; feeds `nearest <category>` (see [SEARCH.md](SEARCH.md)) |
| zone tests (`pointInPolygon`, `polygonBounds`, `polygonCentroid`, `triangulatePolygon`) | which zone the cursor or visitor is in; zone meshes |

Queries look only at buckets near the query point, so they stay cheap as a venue grows to hundreds of POIs.
Tests: `tests/poi-index.test.ts`, `tests/poi-zone-schema.test.ts`.

## In-world pins and labels

`src/lib/poiOverlay.ts` (pure) and `src/engine/PlayCanvasViewer.ts` (`updatePoiOverlay`, run every frame before
rendering):

- **Pins** keep a readable on-screen size: 0.14 m nominal, clamped to 12–40 px (`pinScreenPx`, `pinWorldDiameter`).
- **Labels** are HTML over the canvas. `layoutLabels` places them nearest-first and hides any that would overlap
  one already placed; labels fade from 8 m and disappear at 22 m (`labelOpacity`). Labels behind the camera are
  not shown; labels are not occluded by walls (like zones, see Limitations in the README).
- **Picking** uses `hitTestScreen` on the projected pins (6 px slop), for mouse, touch and the crosshair in
  immersive mode. Zones are picked by casting a ray onto the floor (`rayFloorHit`) and testing the polygon.
- **Zones** are drawn as translucent floor polygons. They are not occluded by the splat (a known limitation).

Tests: `tests/poi-overlay.test.ts`, `tests/poi-card.test.tsx`.

## Minimap

`src/components/viewer/Minimap.tsx`, maths in `src/lib/minimap.ts`. A 2D canvas in the stage corner (on phones,
a **Map** button opens it full width): the nav grid as a one-pixel-per-cell bitmap in three tones (walkable,
obstacle, unfilmed), zone outlines, POI pins, the active route and the visitor with a heading cone. North-up puts
the scene's -z (the yaw-0 view direction) at the top; heading-up rotates the map about the visitor by their yaw
(`minimapTransform`, an affine map with an exact inverse `toFloor`). A click picks the nearest pin within 9 px or
a zone containing the point (`poiAtMapPoint`); otherwise, on a walkable cell, it routes there
(`walkableAtMapPoint`, engine `routeToFloor`). The canvas is redrawn only when `minimapDrawKey` (pose rounded to
5 cm and 1°, route, selection, mode, size) changes. Tests: `tests/minimap.test.ts`.

## Editing POIs in the app

`?edit=1` (or **Edit POIs** in the authoring view) opens `src/components/viewer/PoiEditorPanel.tsx`, backed by
`src/lib/poiEditor.ts`:

- **Add POI**, then click the floor: `createPoi` places a pin 1 m above the floor and snaps its approach point.
- **Select / move**: drag a pin; `movePoi` re-snaps the approach point.
- **Draw zone**: click floor corners, then **Finish zone**.
- Label, aliases (comma separated), category and description are edited in the panel.
- The draft is saved per scene in `localStorage` (`namma.poiDraft.<sceneId>`). **Export pois.json** downloads a
  schema-checked file; **Import** loads one; **Discard draft** returns to the shipped POIs.

Tests: `tests/poi-editor.test.ts`, `tests/poi-editor-panel.test.tsx`, `tests/make-pois.test.ts`.
