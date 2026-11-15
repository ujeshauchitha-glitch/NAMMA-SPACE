# Pathfinding

From "Route here" to a line on the floor and turn-by-turn guidance. Code: `apps/studio/src/lib/navigation.ts`
(grid, A*, snapping, smoothing, line of sight), `routeGeometry.ts` (ribbon, chevrons), `routeGuidance.ts`
(progress, instructions), `src/engine/PlayCanvasViewer.ts` (drawing, follow, re-route).

## The grid

Each scene bundle has `navigation/grid.json`: an x/z occupancy grid with `cellSize`, `blocked[]` and `unknown[]`
cell indices, and `clearanceMetres`. For a captured scene, `pipeline/scene_bundle.py` builds it from the COLMAP
model: 10 cm cells; a cell is **blocked** when sparse points sit between knee and head height in it (desks,
walls), widened by a 25 cm clearance (the visitor's radius), so a route that keeps to free cell centres keeps its
clearance; cells the camera walked through are always free; cells far from the filmed path are **unknown**.
Unknown cells are treated like walls (`isWalkable`): the splat is unreliable there. The classroom grid is
120 × 123 cells, 7,497 blocked and 3,778 unknown.

## Route search

`planRoute(grid, from, to)`:

1. **Snap** both ends to the nearest walkable cell within 1.5 m (`snapToWalkable`). Beyond that it fails with
   "No walkable point nearby", instead of routing from inside a desk.
2. **A\*** (`findRoute`): 8-connected, diagonal moves only when both side cells are free (no corner cutting),
   octile-distance heuristic (admissible and consistent), binary-heap open set with lazy deletion over typed arrays.
   Failure modes are explicit: `invalid-start`, `invalid-goal`, `unreachable`.
3. **Smooth** (`smoothPath`): string pulling. From each kept point, jump to the farthest later point that is
   still in line of sight, where line of sight (`lineOfSight`) walks every cell the segment touches (a supercover
   traversal, conservative at exact corners) and fails on any blocked or unknown cell. So the smoothed route
   never crosses a cell the grid route would not, and is never longer.

## Benchmark (task 2, classroom grid, 15 audit routes, median of 5 runs, Node on a laptop)

| | Sort-per-pop open set | Binary heap |
|---|---|---|
| mean route | 37.7 ms | 0.96 ms |
| worst route | 209 ms | 2.46 ms |
| all 15 routes | 565 ms | 14.4 ms |

All 15 route lengths were identical before and after. Smoothing cut the waypoints from 58.7 to 4.8 per route on
average and the total length from 101.3 m to 95.7 m (5.5 % shorter); the worst route including smoothing took
8.9 ms. The harness was a throwaway script, not part of the repository.

## Drawing the route

One continuous floor ribbon (`ribbonMesh`: mitred joins, mitre capped at 2×) 22 cm wide, just above the floor,
opaque so furniture in front still hides it; chevrons scroll along it towards the goal (`chevronDistances`);
a beacon (pole and pulsing ring) marks the destination. A preview (from search) is drawn fainter without chevrons.

## Show walkable area

A toolbar toggle (off by default) draws the walkable cells as a translucent floor overlay, so the space routes
keep to (and the obstacles they avoid) is visible in 3D. `src/lib/walkableOverlay.ts` merges walkable cells
into row runs, one quad each (`walkableRuns`, `walkableMesh`); the engine builds the mesh once
(`setWalkableOverlay`). Tests: `tests/walkable-overlay.test.ts`.

## Guidance

`routeProgress` projects the visitor onto the smoothed route every frame: distance along, remaining, offset.

| Rule | Value |
|---|---|
| next instruction | first turn sharper than 30° ahead ("Turn left in 3 m"), else "Arrive in 12 m" |
| walk-time estimate | 1.2 m/s |
| off route | more than 1 m from the route for 0.5 s: re-plan from where the visitor stands ("re-routed") |
| arrived | within 0.75 m of the destination |
| Follow route | walks the camera along the route at 1.4 m/s looking 1.5 m ahead; any movement key, drag or pointer lock hands control back |

## Tests

`tests/route-planning.test.ts` (heap A* equals Dijkstra on 200 random grids; snapping; failure statuses),
`tests/route-smoothing.test.ts` (property test on 300 random grids: smoothed path stays on walkable cells and is
no longer than the raw path; classroom check), `tests/navigation.test.ts`, `tests/navigation-unknown.test.ts`,
`tests/route-geometry.test.ts`, `tests/route-guidance.test.ts`; end to end in `tests/e2e/viewer-route.spec.ts`.
