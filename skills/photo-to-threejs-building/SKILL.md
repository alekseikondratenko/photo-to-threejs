---
name: photo-to-threejs-building
description: Rebuild a building from a single reference photograph or archviz render as a procedural, measured Three.js model. Use when the user supplies a building image and wants a 3D model, a web-viewable reconstruction, a massing study from a photo, or asks to "do the img2threejs thing" / "reconstruct this building". Covers the measurement-first workflow, the render-vs-reference scoring loop, and a checklist of bugs that have each already cost a full review cycle.
---

# Photo → Three.js building reconstruction

Rebuild the building in a reference image as procedural Three.js code, then **score the
render against the reference numerically** and correct until the numbers converge.

## The working ledger — RECON.md, before anything else

Keep ONE file, `RECON.md`, next to the workspace (init_workspace scaffolds it; create it
by hand otherwise) and **rewrite it at every step**:

- **Verified** — measurements WITH their evidence ("eave y=2.95 m — gutter rows + rake
  unprojection agree").
- **Assumed** — working values with their source ("storey 2.85 m, standard").
- **REFUTED** — hypotheses killed, with what killed them. **Once buried, they stay
  dead** — re-litigating settled questions cost one observed run three separate
  re-investigations of the same roof step.
- **Camera** — the accepted solve, pasted verbatim.
- **Score history** — one row per scored render pass.

Read it before re-deriving anything: a fact not recorded here WILL be re-measured, and
that re-measurement will not agree pixel-for-pixel with the first one, and reconciling
the two will cost more than the ledger ever does. The ledger is also the run's audit
trail — hand it over at the end instead of a transcript.

## The loop grammar

The whole method is one loop, and each pass has the same grammar:

1. **Predict** — say (in RECON.md) what the change should do to the numbers.
2. **Act** — make the change; save a render via `POST /__save-render`.
3. **Read the grade** — the save response carries the score (the endpoint scores every
   save automatically; there is no unscored render). Log it in Score history.
4. **Fix the largest measured error — and every independent smaller fix — in the SAME
   pass.** Passes are expensive (3–5 minutes each: edit, render, score, look); edits are
   cheap. A gutter colour, a tree position and a window reveal do not interact, so they
   do not each deserve their own pass. One field run spent 21 passes fixing roughly one
   thing at a time.
5. **One eye pass per numeric pass.**

**Stop rules — converged is a number, not a feeling.** A metric that has improved by
less than **0.5% of the image diagonal** over the last two passes is converged: stop
optimising it and move to the next phase. Soft budget: **~12 scored passes** for a
building-scale subject; going beyond is allowed but write one line in RECON.md saying
what is still moving and why. Never iterate on eyeballed screenshots — an observed run
scored once, eyeballed for an hour, and did not converge.

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

Two places to find the engine, depending on how this skill reached you:

- **Repo cloned** ([photo-to-threejs](https://github.com/alekseikondratenko/photo-to-threejs)):
  use its `viewer/` — three completed subjects sharing one library. Read the worked
  examples before writing anything new.
- **Skill installed standalone** (`npx skills add`, plugin marketplace, or a copied
  folder): the same library ships in this skill's `assets/viewer-template/` — copy it
  into the workspace, `npm install`, and add subjects to it. No repo needed.

Either way, the files that matter:

| Path | What it is |
|---|---|
| `src/lib/geometry.ts` | Path/sweep/loft/cap/merge helpers. Every bug below is documented at its call site. |
| `src/lib/measure.ts` | `window.__measure()` — canvas readback scored against reference targets. |
| `src/lib/types.ts` | `BuildingModel` contract: build fn, views, light rig, measured targets. |
| `src/models/whiteHouse.ts` | White House — classical detail as geometry, shifted-lens camera solve. *(repo only)* |
| `src/models/taipei101.ts` | Taipei 101 — chamfered plan, 8 flaring modules, 64 real floor rings. *(repo only)* |
| `src/models/empireState.ts` | Empire State — notched Art Deco plan, attached-block base, bundled piers. *(repo only)* |
| `src/scenes/*.ts` | Per-building camera/lighting/targets. Add a new building here + `models/`. |
| `scripts/measure_reference.py` | *(in this skill)* Deterministic reference scan: silhouette, floor-pitch autocorrelation per band, lit/shadow bands. Run it before hand-measuring; read its docstring for known limits. |
| `references/casebook.md` | *(in this skill)* The worked measurement stories — every subject's numbers, procedures and failures, including a corner view modelled frontal. **Standalone installs: this is your substitute for the repo-only model files above.** |
| `references/roof-geometry.md` | *(in this skill)* Pitched-roof cookbook: Zwerchgiebel flush-vs-projecting test, valleys, Wangen, verge-overhang offsets, pitch from rake VPs, the stepped-eave decision tree. **Read it BEFORE fighting any cross-gable** — every fact in it was re-derived from pixels by two runs at 15–20 min each. |
| `references/scale-anchors.md` | *(in this skill)* Standard-dimension anchor table (door 2.0 m, window head 2.135 m, Traufhöhe by storey class), the 1.5-storey test, and the sanity checks that catch a wrong anchor before it poisons the run. **Read it BEFORE converting any ratio to metres.** |

Run it: `cd viewer && npm run dev`. Vite asks for 5200 and auto-increments if it is
taken — **the URL vite prints is the truth**; never assume the documented port, and
never hand-pick 5173 (a Docker container can bind it on IPv6 and shadow it silently).
Add a building by writing
`models/<id>.ts` + `scenes/<id>.ts` and appending to `MODELS` in `main.ts`. **Never edit
an existing model to make a new one** — they share `lib/`, nothing else.

## Step 1 — Classify the reference. This changes everything downstream.

**First, before anything else: determine the view topology.** How many faces of the
subject are visible, and where are the corner (arris) lines in pixels? **Frontality is a
claim, not a default, and it must be falsified before you choose a coordinate frame:**

- Repeating elements (bays, windows, balusters, columns, courses) must show **equal pixel
  pitch at both ends** of a facade for it to be parallel to the sensor. Pitch tightening
  toward one end = that end recedes = a second face is visible.
- The horizontal edge families (eaves, rails, string courses) must converge to **at most
  one vanishing point**. Two convergence families = two visible faces.

If either test fails, locate the arris, solve the yaw (Step 2 recipe), and model both
faces. Shallow corner views are the trap: at 10–15° of yaw nothing "looks" oblique, there
may be no lit/shadow split to warn you, and an anchored frontal reading then absorbs the
foreshortening into wrong dimensions for the rest of the run. Write the topology finding
down before building the frame — the first structural reading freezes everything after it.

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

For this class, **solve the camera before trusting any measurement** — it is cheap and
it is not optional, because the tilt alone can distort apparent proportions by tens of
percent. Three image facts pin it: the horizon row (eye level), the slope of a known
vertical edge (fixes the vertical vanishing point, hence focal length and tilt
together), and one known height (fixes distance). Then verify by projecting one known
point back into the image before building anything. Two runs on the same photo have
produced wildly different cameras when this was improvised — it is a high-variance
step precisely when it is done by feel. And remember the topology finding: the recipe
above uses ONE horizontal family; if Step 1 found two, solve the yaw first.

Three worked camera solves, as recipes (numbers in `references/casebook.md`):

- **Shifted lens (the default archviz case).** Verticals dead parallel yet the building
  off-centre means a shift, not a tilt. Derive it: pick the fov whose vertical extent at
  the solved distance matches the measured metres-per-pixel over a virtual frame
  `fullScale` times taller than the render; then `offsetYFrac` drops the horizon onto the
  reference's measured horizon row (`offsetYFrac = fullScale/2 − horizonRow/imageH`).
  Reproduce with `camera.setViewOffset`, never a tilt.
- **Horizon row → eye height.** The horizon row times the solved metres-per-pixel IS the
  camera's height. A mid-height eye explains a constant floor pitch (near-linear pixels);
  a ground eye predicts pitch compression with height. Check the two agree.
- **Ground ellipse → distance.** Any circular ground feature (fountain, plaza ring)
  images as an ellipse whose minor:major axis ratio equals eye height : distance. One
  measurement pins the standoff.

## If the photo-to-threejs MCP server is available — the instruments

When this skill arrives alongside the MCP server (the plugin ships both), the
deterministic steps are tool calls, not scripts you write. **If your host defers tool
schemas, load them ALL in one search first** (`select:` with every photo-to-threejs tool
name) — otherwise each first use costs a round-trip and writing Python starts to look
cheaper than calling the tool, which is how a run ends up rebuilding the toolset:

| Need | Tool | The rule that matters |
|---|---|---|
| Look closely, keep coordinates | `view_crop` | magnified crop with a labelled pixel grid — read positions off the zoom. Pass an ARRAY of up to 6 regions for a contact sheet: one call instead of six |
| Feature positions, after the camera | `unproject` | image points + a plane → world coordinates. **Use this instead of measuring features**; it is the single biggest time saving in the method |
| An edge as numbers | `trace_edge` | eyes locate the edge, the tool reads it off; feeds `solve_camera` directly |
| The camera | `solve_camera` | **call it EARLY with rough lines** — 'weak' + a named worst line IS the workflow; iterate through the residuals, 2–3 calls. Never derive vanishing points by hand, and never "collect confident lines first" (measured cost of that strategy: a 30-minute detour the solver then confirmed in one call) |
| Any repeating rhythm | `measure_pitch` | aimable autocorrelation, warns at the noise floor |
| Numeric Step-1 hints | `classify_reference` | one witness, never the verdict; weak on wide/occluded subjects and says so |
| The workspace | `init_workspace` | scaffolds the viewer, RECON.md, and the auto-scoring save endpoint |
| Evidence pack + score | `compare_images` | overlay/wipe/edge-diff + the full score block, every pass |
| Delivery | `open_viewer` | the run is not done until this has been called on the built workspace |

Without the server, the same steps run on this skill's scripts (`measure_reference.py`)
and hand-written scans — the method is identical, only slower.

## Step 2 — Measure the reference in pixels, never by eye

Start with the shipped scanner — it does the silhouette, per-band floor-pitch
autocorrelation and lit/shadow bands deterministically:

```bash
python3 scripts/measure_reference.py ref.jpg          # needs Pillow
```

For anything it does not cover, use the server's instruments — `view_crop` to look,
`trace_edge` to turn an edge into numbers, `measure_pitch` for a rhythm. Only if this
skill arrived WITHOUT the MCP server (no photo-to-threejs tools in your toolset) fall
back to scanning by hand; the appendix at the end of this file has the snippet. Either
way the rule is the same: every number comes from a scan, not an eyeball.

Get, at minimum:
- **Floor pitch** — autocorrelate a vertical luminance profile down one face. This gives
  the floor count far more reliably than counting bands by eye.
- **Silhouette** per row (left/right edge) — reveals taper, flare, setbacks, and the
  sawtooth of stacked modules. Smooth with a median filter first or brackets and
  cornices produce false boundaries.
- **Corner → yaw**, when Step 1 found two faces:
  1. Measure the repeating-unit pitch on each face separately (`pitchL`, `pitchR`), in a
     band at the same height.
  2. Yaw = `atan2(pitchR, pitchL)` — the face with the tighter pitch is the more
     foreshortened one.
  3. True unit width = measured pitch / cos(face's angle to the sensor); plan widths
     follow from the face-width split at the arris.
  4. **Bailout:** if either pitch sits at the noise floor (≲8 px), the yaw is unsolvable
     from pitch — parameterise the plan and fit it numerically (checklist item 24)
     instead of forcing a number.
- **Identity features, with pixel positions.** Inventory the features that make the
  building recognisable — column x-positions, window centres, brace endpoints, feature
  counts — while you are measuring. Each becomes a `targets.notes` entry. If it is not
  a target now, the scoring loop will sacrifice it later (Step 4's first rule).
- **Colours**: lit face, shadow face, trim, sky zenith, sky horizon — and the
  **lit/shadow luma ratio**, which is what you tune lighting against.

Record which numbers are observed and which are assumed. Put it in the file header.

### Which rigor applies — decide at triage, not by momentum

Every heavy procedure below has a trigger; running them unconditionally is how a small
house eats a landmark-sized budget. Everything else starts manual-and-cheap, and
escalates only on misfit.

| Procedure | Fires when |
|---|---|
| Two-VP camera solve | topology found two families AND the massing overlay misfits |
| Shipped scanner | photo class with a sky-bounded silhouette (docstring lists its limits) |
| Corner→yaw recipe | two faces AND the yaw materially changes the massing |
| Banded pitch autocorrelation | repeating elements ≥ ~8 px |
| Full shifted-lens derivation | archviz class with parallel verticals |

**Proportionality:** measure until the massing gate passes; after that, measure only
where the overlay shows error. A camera residual smaller than your silhouette's line
width is finished, not perfectible. For a building-scale subject, aim to reach the
first scored massing within ~25 minutes; a landmark or hostile reference may take
longer — say why in the header. Minutes saved here are spent in Step 5, where the eye
actually looks.

## Step 2.5 — Cross-check before you build

Autocorrelation hygiene first: smooth the profile, reject lags below ~6 px (JPEG ringing
autocorrelates there and once produced a physically impossible 73° yaw), and confirm the
winning lag by directly counting bands on a magnified crop.

Then the method's core epistemic move: **every solved quantity predicts one thing you did
not measure — check it before building.** A scale predicts the ground row; a camera
predicts a landmark's image position; a floor pitch predicts the total height. Agreement
within a few pixels earns the number. **A contradiction falsifies the method, not the
building** — the linear solve that put ground level above Taipei's module stack was the
method failing loudly, and the correct response was to change method, not to bend the
building until the contradiction hid.

## Step 2.9 — the measurement boundary

**Do not measure windows, doors or trim before the first scored massing.** The massing
gate needs only footprint, eave, ridge and the big wings; everything else waits.

This is a deferral, not a skip, and it makes the details SAFER rather than riskier: a
feature measured before the frame is verified is measured against an unverified camera
and an unverified scale, and goes stale the moment either moves. One run measured its
windows early, then corrected its storey count (2-storey → 1.5-storey), and every
pre-measured position had to be redone. After the massing scores, the overlay tells you
which details are actually wrong, and — with the camera solved — `unproject` turns
image points into world coordinates directly, which is faster than pixel-measuring
each feature was in the first place.

## Step 3 gate — massing before detail, always

Block out the ENTIRE building as plain massing first — every visible face, the roof
planes, the big moves only — and score it against the photograph (Step 4) before adding
any detail. A wrong topology or a wrong yaw shows up in the massing overlay in minutes;
found later, it invalidates hours of decoration. Two two-hour runs have been spent
detailing geometry whose frame was wrong from minute five.

Scope rule, from every worked subject: **context is massing only** — ground plane, grey
neighbour blocks, low-poly trees. Lawns, hedges and planting are not the subject; if the
photograph makes a context element load-bearing (an occluder, a scale anchor), massing
still suffices to stage it.

**Context budget: ~2 passes, total.** The subject is what converges; flank bands of the
score are advisory, because on a real photograph they measure vegetation as often as
building. A field run spent a large share of its late passes hand-staging a garden that
no metric was ever going to reward.

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

Two rules that keep the loop honest:

- **The loop optimises only what it measures.** Anything without a number of its own
  will be sacrificed to the things that have one. Give every identity feature its own
  entry in `targets.notes` (a pitch, a count, a contrast — measured off the photo) and
  re-check them every pass.
- **One eye pass per numeric pass.** After correcting the largest measured error, look
  at render and reference side by side at matched framing. Numbers can converge while
  the picture diverges; the eye is the only detector for features the metrics miss.
- **Legibility floor.** Photometric targets constrain the REF-MATCHED view, not the
  product: the default orbit view must read in neutral light. If the reference is
  stylised (dusk, night, heavy grading), say so, score against it in the ref view, and
  stage the default view legibly. A numerically converged black-on-black render is a
  failed deliverable — one model run produced exactly that and was disqualified on
  sight.

For exact-size render files, the dev server accepts `POST /__save-render {name, dataUrl}`
and writes `renders/<name>` — read the canvas with `toDataURL()` and post it, never a
screenshot (checklist item 27). **The endpoint scores every save automatically** against
the reference in `public/` and returns the numbers in the response (also written to
`renders/<name>.score.json`): row-wise silhouette AND column-wise skyline — on wide
subjects trust the skyline block (`rows_compared` small means the row scan was blind,
not that the model is right). Log every pass in RECON.md's Score history.

Tuning map:
- lit face too dark → raise sun intensity (not exposure, which lifts shadows too)
- ratio too high → raise hemisphere fill; too low → lower fill, raise sun
- width fraction off → the plan ratio is wrong, or the framing is
- banding contrast low → floor detail is texture-only; make it geometry

## Step 5 — Finish pass: make it read as architecture

Runs ONLY after Step 4's targets pass, and its law is: **polish is additive — it must
not move a measured line.** Staged elements are a third declared category in the file
header, alongside observed and invented.

The elements that make a building read as finished (translate per building type — a
tower's version of gutters and plinth is copings and podium reveals):

- **Edge members**: ridge/hip caps, verge boards, fascia. The eye traces a building by
  its trim lines; every one is a thin, cheap member.
- **Rainwater goods**: gutters and downpipes (or scuppers) — their dark lines anchor
  the eaves and corners.
- **Plinth/base**: the building meets the ground on a visible base course, never a wall
  sinking into lawn.
- **Openings with depth and life**: reveals are holes in extruded walls, never decals —
  and put an interior behind the glass. A lit room texture reads as occupancy; a bare
  emissive pane reads as film. Construction in `references/polish.md`.
- **Paired maps**: every large surface gets colour + bump from the same generator, at
  metre-true UV scale.
- **Human-scale staging**: the context the photograph shows, massing-level but composed.
  Furniture at true scale is the strongest scale cue in the render.
- **Atmosphere**: the sky you scored against doubles as the environment light; the
  default view obeys the legibility floor.

This pass is funded by the proportionality rule — the minutes not spent over-polishing
a camera are spent here. Worked techniques, mined from a run that did this superbly:
`references/polish.md`.

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
    It also saturates when the sky reference fails: the harness samples one sky pixel,
    and against a strongly graded sky (dusk, haze) that mislabels half the frame.
    Check the sky sample is representative before trusting `widthFrac` at all; if it
    is not, score silhouettes with a per-row sky model instead.

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

24. **One elevation cannot pin a plan.** Projected widths constrain a family of plans,
    not one; attempting to solve plan angles in closed form from a single view leads
    to contradictions and burned time. Parameterise the plan, fit the parameters
    numerically against the measured projections, and record the ambiguity honestly
    (state which alternative plans would render identically from this camera).

25. **A member swept along a path needs an explicit reference direction.** Deriving
    the frame from the tangent alone (Frenet-style) degenerates where the tangent
    approaches the up axis — the member visibly twists or wobbles there. Pass a
    stable "right"/normal direction in and re-orthogonalise per station.

26. **A texture map multiplies the material colour.** Setting both a coloured map and
    a coloured `material.color` darkens the product twice. Whichever one carries the
    albedo, set the other to white.

27. **Score against the drawing buffer, never a screenshot.** Screenshot pipelines
    rescale: CSS pixels, device pixels and captured pixels are three different sizes,
    and the failure is silent — the numbers are simply measured on a resampled image.
    Read the canvas itself (or save it server-side) at its true size.

28. **Read whether a profile is stepped or fair off the reference — then build it
    that way.** Both failure directions have now been paid for: a stepped pinnacle
    smoothed into a cone lost the building's identity, and a fair sail built by
    linearly connecting measured waypoints gained kinks the photograph does not show.
    Measured waypoints are *samples* of the profile, not its vertices: for a fair
    profile, fit a smooth function through them; for a stepped one, model the steps.
    The photograph, not the fitting convenience, decides which.

## Delivery gate — two checks nothing else performs

Every metric in this method compares the render to the photograph from ONE viewpoint.
Two failure classes survive that, and both have shipped:

1. **The model intersecting itself.** Run `window.__clearance()` in the viewer. It
   reports openings (window/door meshes) that pass through roof planes — the defect a
   field run delivered with wing windows driven through the main roof: invisible in the
   reference view, obvious from 3/4. **Any penetration blocks delivery.** If it reports
   zero openings or zero roofs matched, your meshes are unnamed — name them and re-run
   rather than reading that as a pass.

2. **Everything the metrics do not measure.** Save the 3/4, side, rear and top views,
   then get FRESH EYES on them. If the Agent tool is available, spawn a sub-agent given
   ONLY those renders plus the photograph and prompted adversarially — *"find visual
   defects: floating geometry, interpenetration, missing faces, wrong proportions"* —
   because the builder is demonstrably blind to its own model (the run above inspected
   that very region of its own render and saw nothing). Without an Agent tool, do the
   same review yourself on fresh `view_crop`s of the view renders, which at least
   changes what you are looking at.

Sub-agents are for this check and NOT for measurement or refinement: measuring is
hypothesis-forming (a parallel measurer returns numbers without the mental model that
makes them meaningful), passes are inherently serial, and two agents editing one model
file is a merge conflict rather than a speed-up.

Then build (`npm run build`) and call `open_viewer` on the dist directory — the run is
not finished until the viewer is delivered.

## Honesty requirements

State these every time, in the file header and to the user:
- **Rear and hidden elevations are mirrored, not reconstructed.** Say which views are invented.
- **Absolute scale** from a photograph is inferred from an assumed floor-to-floor.
- **Plan axis split** is unconstrained when corners are rounded or chamfered — only the
  projected width is pinned.
- Report the measured match as numbers, not adjectives.
- This is a massing/visualisation model: no survey accuracy, no BIM, no IFC.

## Appendix — scanning by hand (no MCP server)

Only when the photo-to-threejs tools are absent. Any decoder works:

```python
from PIL import Image
im = Image.open('ref.png').convert('RGB')
w, h = im.size
px = im.load()          # px[x, y] -> (r, g, b)
```

Column-wise skyline (wide subjects), row-wise edges (tall ones), autocorrelation for
rhythms. This is what the instruments do; doing it by hand costs about 20 minutes per
run and produces the same numbers with more variance.
