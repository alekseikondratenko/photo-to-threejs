# Polish — worked finishing techniques

Mined from a run that produced the best-looking house model of the acceptance tests, in
roughly the order the finish pass applies them. Everything here is additive presentation:
none of it moves a measured line.

## Paired colour + bump maps from one generator

One canvas-drawing function returns BOTH the colour map and a bump map drawn from the
same strokes (`stuccoMaps(hex)` → render speckle + relief; `roofTileMaps()` → course
lines in both). Bump without matching colour reads as noise; colour without bump reads
as wallpaper. Keep UV scale metre-true (set repeat from real dimensions) so one texture
serves every wall without stretching, and course/plank pitches stay honest.

## Windows that read as rooms

The single highest-value trick. Construction, back to front:

1. The wall is an extruded `Shape` with the window as a **hole** — a real reveal at
   wall thickness, never a decal on the surface.
2. A frame box sits in the reveal; glazing is `MeshPhysicalMaterial` with modest
   clearcoat.
3. **Behind** the glazing, a shallow interior box faced with a `roomTexture()` — an
   unlit (`MeshBasicMaterial`) canvas painting warm gradients, a hint of wall/ceiling
   division, one or two dark furniture masses. Vary the warmth per room.

Result: occupancy. A bare emissive pane reads as film stuck to the wall; a lit room
reads as someone home. For a dusk reference this carries the whole mood without
darkening the model itself (see the legibility floor).

## A window schedule, not ad-hoc openings

Define openings once, as a table (position, w×h, sill height, type), and punch them
from it with one `makeWindow()` factory. Uniformity-by-construction is why the result
looks *drawn* rather than assembled; it also makes the reveal depth and frame profile
consistent everywhere — which is what the eye checks.

## The finishing-members sequence

In build order, each one a few thin boxes or a swept profile:
ridge caps → verge boards + purlin ends → fascia → gutters → downpipes →
exterior wall lights → plinth course. Translate per type: copings, parapet trims,
scuppers, podium reveals on a tower. None takes more than minutes; together they are
the difference between a massing study and architecture.

## Staging palette

Three plant forms are enough: clipped bush (squashed sphere), conifer (stacked cones),
canopy tree (trunk + blob). Two or three greens, not one. Gravel/path strips where the
photo shows them. Furniture at true scale on terraces — a 0.75 m table instantly
calibrates the whole building. Distant context gets lifted/hazed toning so it reads far.

## Atmosphere

The sky gradient you scored against becomes `scene.environment` (PMREM) as well as the
backdrop, so the light and the backdrop agree. ACES tone mapping with gentle exposure;
soft shadow map. The scored ref view keeps the reference's light; the default orbit
view obeys the legibility floor.
