---
name: photo-to-threejs-building
description: Rebuild a building from a single reference photograph or archviz render as a procedural, measured Three.js model. Use when the user supplies a building image and wants a 3D model, a web-viewable reconstruction, a massing study from a photo, or asks to "do the img2threejs thing" / "reconstruct this building". Covers the measurement-first workflow, the render-vs-reference scoring loop, and a checklist of bugs that have each already cost a full review cycle.
---

# Photo → Three.js building reconstruction

Rebuild the building in a reference image as procedural Three.js code, then **score the
render against the reference numerically** and correct until the numbers converge.

There is no reconstruction algorithm here and no ML. The 3D comes from you writing
TypeScript that composes primitives and swept paths. What makes it reliable is not
better guessing — it is **measuring instead of eyeballing**, at both ends: measure the
photograph in pixels, and measure your own render the same way.

## Two shape classes, one method

**Extruded/swept subjects** (most buildings) — plan path swept or lofted vertically
via `lib/geometry.ts`. The rear is always invented.

**Solids of revolution** (machine parts, tanks — proven on a bolted hydraulic cylinder) —
a measured radius profile revolved with `THREE.LatheGeometry`, authored directly in the
model file without the sweep helpers. This is the one class where a single view is NEARLY
COMPLETE: revolving the profile reproduces all 360 degrees exactly, so only genuinely
asymmetric features (bosses, bolt clocking) are inferred. Under orthographic projection a
cylinder's silhouette half-width IS its true radius at any axis tilt, so radii are exact —
but axial foreshortening cannot be separated from the true aspect ratio, so lengths are not.

**2D orthographic elevations / CAD drawings** (proven on a villa facade drawing) — the
INVERSE of a solid of revolution. A drawing has no perspective at all, so every width and
height is exact to the pixel and the linear px->m scale is trustworthy. But it carries
**zero depth information**: building depth, roof form, projection depths and the side and
rear elevations are not mirrored from anything — there is nothing to mirror. Say
"fabricated", not "inferred". Scale comes from a standard component (a 2.4 m garage door,
a 2.0 m door leaf); find two that agree before trusting it.

The measurement-first workflow and the bug checklist apply to all three.

## Working reference implementation

The `viewer/` directory of this repository — three completed subjects sharing one library.
Read these before writing anything new:

| Path | What it is |
|---|---|
| `src/lib/geometry.ts` | Path/sweep/loft/cap/merge helpers. Every bug below is documented at its call site. |
| `src/lib/measure.ts` | `window.__measure()` — canvas readback scored against reference targets. |
| `src/lib/types.ts` | `BuildingModel` contract: build fn, views, light rig, measured targets. |
| `src/models/whiteHouse.ts` | White House — classical detail as geometry, shifted-lens camera solve. |
| `src/models/taipei101.ts` | Taipei 101 — chamfered plan, 8 flaring modules, 64 real floor rings. |
| `src/models/empireState.ts` | Empire State — notched Art Deco plan, attached-block base, bundled piers. |
| `src/scenes/*.ts` | Per-building camera/lighting/targets. Add a new building here + `models/`. |

Run it: `cd viewer && npm run dev` (port 5200, `--strictPort` — 5173 can be silently
shadowed by a Docker container binding it on IPv6). Add a building by writing
`models/<id>.ts` + `scenes/<id>.ts` and appending to `MODELS` in `main.ts`. **Never edit
an existing model to make a new one** — they share `lib/`, nothing else.

## Step 1 — Classify the reference. This changes everything downstream.

**Archviz render** (white massing context, no vertical convergence, clean sky):
pixels map **linearly** to metres. You can read dimensions straight off the image.
Almost certainly shot with a **shifted lens** — verticals dead parallel yet the building
centred. Reproduce with `camera.setViewOffset` on a horizontal camera, not a tilt.

**Elevated photograph** (shot from a nearby rooftop near mid-height): measure the floor
pitch in several height bands first. If it is constant, vertical foreshortening is
negligible and pixels map linearly after all — treat it like the archviz case. The
Empire State reference measured 11 px at every band, and the resulting linear scale
predicted ground level to within 8 px on a 1500 px image.

**Ground-level photograph** (real surroundings, converging verticals):
pixels **do not** map linearly. The top of a tall building is 20–30% further from the
camera than the base. On Taipei 101 the linear solve put ground level *above* the module
stack — a physical contradiction that proved the method fails. Use **local ratios**
instead (module height : plan width within one module, where perspective barely
distorts) plus one assumed floor-to-floor, and say plainly that absolute scale is
inferred.

## Step 2 — Measure the reference in pixels, never by eye

Decode the image programmatically — any decoder works; the point is that every number
comes from a scan, not an eyeball:

```python
from PIL import Image
im = Image.open('ref.png').convert('RGB')
w, h = im.size
px = im.load()          # px[x, y] -> (r, g, b)
```

Get, at minimum:
- **Floor pitch** — autocorrelate a vertical luminance profile down one face. This gives
  the floor count far more reliably than counting bands by eye.
- **Silhouette** per row (left/right edge) — reveals taper, flare, setbacks, and the
  sawtooth of stacked modules. Smooth with a median filter first or brackets and
  cornices produce false boundaries.
- **Corner position** → face-width split → camera yaw and plan aspect.
- **Colours**: lit face, shadow face, trim, sky zenith, sky horizon — and the
  **lit/shadow luma ratio**, which is what you tune lighting against.

Record which numbers are observed and which are assumed. Put it in the file header.

## Step 3 — Build, with detail as GEOMETRY not texture

**The single most important rule.** On the first slab-tower subject the horizontal rhythm
is 45 real projecting slab rings and it reads at any distance. The first Taipei pass used 8 smooth lofted
surfaces with floor lines painted into the map — and the mip chain averaged them into
uniform gloss. No material tweak recovers it. If a feature defines the building's
identity, model it.

Working split:
- **Geometry**: floor slabs/nosings, cornices, piers, fins, crown, spire, podium.
- **Texture**: per-pane tonal variance, mullion hairlines, corner channels — things that
  are genuinely sub-pixel at the intended viewing distance.

## Step 4 — Score the render, then correct

```js
window.__measure()   // after a frame has painted
```

Returns lit/shadow luma, their ratio, silhouette width fraction and banding contrast,
each as a percentage of the reference target. Correct the largest error first. Typical
convergence: archviz ≤7%, real photograph ≤15%.

Tuning map:
- lit face too dark → raise sun intensity (not exposure, which lifts shadows too)
- ratio too high → raise hemisphere fill; too low → lower fill, raise sun
- width fraction off → the plan ratio is wrong, or the framing is
- banding contrast low → floor detail is texture-only; make it geometry

## Bug checklist — each of these already cost a full cycle

1. **`prism()` double-offset.** After `rotateX(-PI/2)` an extrusion already occupies
   `y ∈ [0, height]`. Translating by `y0 + height` lifts every volume one body-length
   too high. *Symptom: a mystery black block floating above the building.*

2. **Inverted sweep winding.** Triangles must wind CCW **as seen from outside**.
   Reversed, every face is back-facing and Three.js flips the shading normal *inward* —
   the facade is lit from behind and renders ~2× too dark. *Symptom: reads exactly like
   "the materials didn't load". It is geometry, not materials.*

3. **Averaged normals on a faceted plan.** Smooth vertex normals are right for a rounded
   fillet and wrong for a chamfer — they round hard edges off. *Symptom: a faceted tower
   renders as a smooth barrel.* Use `sweepBand(..., flatShaded = true)`.

4. **Radial offset on a non-circular plan.** `offsetPath` pushes each vertex away from
   the origin, so corner vertices (further out) move further still. *Symptom: fins grow
   off the corners; a pedestal turns into a rocket.* Use `offsetChamferedSquare`, which
   offsets each edge along its own normal.

5. **Texel aspect ≠ surface aspect.** Set texture width:height to
   `perimeter : band-height`. A 2048-wide map on a slender tower squeezes 2048 texels
   into ~50 screen pixels and the isotropic mip chain averages the whole pattern away.
   Anisotropic filtering alone does not save it.

6. **Specular burying albedo.** High clearcoat + low roughness + strong envMap erases a
   curtain-wall pattern under a bright sky. Architectural glass wants roughness ≈ 0.2–0.4,
   metalness 0, clearcoat ≤ 0.2, envMapIntensity ≈ 0.3.

7. **Projecting elements casting shadows over a huge frustum.** 45 slab rings or 8
   cornices casting into a 600 m shadow camera smear shadow across the whole elevation.
   Set `castShadow = false` on repeated nosings and bake the soffit line into the map.

8. **Invalid CSS colour in a canvas texture.** A bad hex silently no-ops the fill and the
   canvas stays transparent. *Symptom: one element renders pure black.*

9. **Canvas readback before a painted frame** returns all zeros. Force a paint (take a
   screenshot) before calling `__measure()`. Needs `preserveDrawingBuffer: true`.

10. **Context massing contaminates the measurement.** The harness finds the subject by
    contrast against sky; grey neighbour blocks read as subject and the silhouette scan
    grabs them instead. Hide `site-context` before calling `__measure()`.

11. **Unset `envMapIntensity` defaults to 1.0.** A bright sky environment then lights the
    shadow face as hard as the key lights the front and the lit/shadow ratio pins at
    1.0 no matter how far you push the sun. Set it explicitly on every material.

12. **Uniform pier spacing reads as corduroy.** Real masonry facades bundle: solid corner
    masses, then deep light-well notches, then groups of narrow mullions. Measure a
    magnified horizontal luminance profile across one face and reproduce the grouping —
    `notchedRectPath` exists for exactly this.

13. **`widthFrac` SATURATES on wide subjects.** The harness scans x from 0.20W to 0.90W,
    so any subject wider than that band reports exactly 0.700 — and if the target was
    also derived that way it reads as a perfect 100% match while measuring nothing.
    Seen on the White House. For low/wide buildings add subject-specific checks to
    `targets.notes` instead (silhouette width:height, bay pitch in px, baluster pitch)
    and verify them by scanning the RENDER the same way you scanned the photo.

14. **Compare at the reference's own aspect ratio.** `resize_window` the viewer to match
    the photograph before scoring. A 1.5:1 reference judged in a square viewport cut the
    White House's wings outside the frame and looked like a camera-solve error when the
    solve was correct.

15. **`normalBias` is tuned per-subject and lives in shared code.** `main.ts` sets 0.6 m,
    right for a 400 m tower but larger than the depth of a 1.5 m column or a 0.6 m
    cornice — those surfaces then fail to self-shadow. If you cannot edit the shared
    file, say so and label any albedo-baked occlusion as the approximation it is.

16. **A near-mirror metal needs an environment with CONTENT.** `metalness` near 1.0
    removes the diffuse term entirely — the surface shows only what the environment
    reflects. At `roughness` ~0.3 the reflection lobe is broad and averages a sky
    gradient into a believable grey, which is why the towers' masts look right. At
    `roughness` ~0.1 it mirrors one direction, and a featureless studio gradient
    mirrors as flat near-black. For machined steel in a CAD-style scene use
    metalness ~0.4-0.6, not 1.0.

17. **Point the camera at the identity feature.** A detail can be correctly modelled and
    still invisible because it faces away. The hydraulic cylinder's twelve bolt heads
    were perfect and completely hidden until the camera moved to the side the bolting
    face points toward. Before concluding a feature "didn't build", orbit to the other
    side or check the face normal.

18. **Verify the axial/coordinate mapping before authoring stations.** If a profile scan
    runs t = -1000..+880, model position is `t + 1000` — writing the raw t values
    collapses the part. Cheap check: the stations should sum to the measured total.

19. **Without CSG, an opening cannot be recessed — it must be built PROUD.** If the mass
    spans z = -D..0 then z=0 is the face and anything at negative z is inside the solid
    and invisible. Windows, doors and garage panels placed "into" a reveal simply vanish.
    Build them forward of the face and let a projecting frame read as the reveal, or
    build the wall as a pierced skin.

20. **A slat/louvre zone must be TALLER than the opening it surrounds.** If the zone and
    the window share a y-range, every row is interrupted and the bands above and below
    the opening — usually the whole motif — disappear.

21. **Width fraction is not comparable across aspect ratios.** A portrait photograph and
    a square viewport give different fractions for identical geometry. Compare the
    building's own width:height silhouette ratio, and add back any occluded base.

22. **A tapering profile above the top occupied floor is ROOF, not curtain wall.** The
    silhouette scan gives widths, not materials, and the seductive mistake is to loft the
    facade glazing through the whole measured profile — which produced a 53 m habitable
    glass vase on a tower whose photograph shows a short dark roof with a crown rising
    out of it. Before assigning any material above the last floor plate, check the
    reference for the material break (darker, matte, sloped, no window grid) — and
    expect the crown structure to repeat the building's own formal language (Taipei's
    crown flares outward exactly like its modules).

23. **Invent occluded base massing as ATTACHED BLOCKS, never as concentric tiers.**
    Scaling the tower plan by 2x and stacking shrinking copies is the path of least
    code, and it reads as a wedding cake. Real setback massing is a cluster of vertical
    masses hugging the shaft — each wing with its own roof height, stepping by
    different amounts on the two axes. Overlapping plain boxes produce that silhouette
    directly. Bonus: scaling a *notched* shaft plan up to base size also scales the
    notch geometry, which sprays pier artefacts; base blocks want their own plain plan.

## Honesty requirements

State these every time, in the file header and to the user:
- **Rear and hidden elevations are mirrored, not reconstructed.** Say which views are invented.
- **Absolute scale** from a photograph is inferred from an assumed floor-to-floor.
- **Plan axis split** is unconstrained when corners are rounded or chamfered — only the
  projected width is pinned.
- Report the measured match as numbers, not adjectives.
- This is a massing/visualisation model: no survey accuracy, no BIM, no IFC.
