# Casebook — the worked measurement stories

One page per subject: what was measured, the numbers, the procedure, what failed. No
Three.js code — the engine ships in `assets/viewer-template/`; this file ships the
*practice*. Failures are entries too: a cautionary worked reading is worth three success
stories.

---

## Residential tower (archviz render) — the shifted lens

Floor pitch 15.5 px, constant top to bottom → pixels map linearly (archviz class).
Shaft 670 px tall / 192 px wide at 45 floors × 3.25 m. Verticals dead parallel with the
tower off-centre = **shifted lens**: reproduced with `setViewOffset` on a horizontal
camera. Lit/shadow ratio 1.60 (soft archviz light). Lesson that stuck: at 45 floors the
horizontal rhythm must be 45 real projecting slab rings — painted floor lines mip-average
away (checklist 5's origin).

## Taipei 101 (ground photo) — the linear solve falsified

Eight modules, boundaries at rows 416/497/579/663/745/830/913/998 → median pitch 83 px,
each module flaring ~9–10%. The linear pixel→metre solve put ground level ABOVE the
module stack — impossible, therefore the *method* was wrong (ground photos do not map
linearly): switched to local ratios (module height : plan width within one module) plus
an assumed 4.05 m floor. Corner face-split 79:96 px → yaw ≈ 39°. Lit/shadow 2.09 (hard
tropical sun). Later correction (paid for twice): the tapering profile above the stack is
ROOF, not curtain wall — and the crown flares like the modules do.

## Empire State (elevated photo) — constant pitch, and the 73° yaw trap

Floor pitch 11 px at EVERY height band → near-linear mapping; scale 0.334 m/px predicted
the ground row within 8 px of frame bottom — the cross-check that earned the scale.
Corner split 134:75 px, but pier pitch sat at the JPEG noise floor (bays 5–10 px): raw
autocorrelation locked onto ringing at lags 3–5 and once yielded a physically impossible
73° yaw. Fix: smooth, reject lags < 6 px, confirm by direct counting — and when the yaw
stayed unsolvable, parameterise the plan and fit (checklist 24). Horizon row 1002 ×
0.334 m/px → eye at ~169 m: a mid-height rooftop camera, which is *why* the pitch is
constant. Overcast ratio 1.27. Base massing below 209 m is occluded → invented as
attached blocks (checklist 23).

## White House (web photo, low + wide) — distance from a fountain

The fountain ring images as a 1358 × 36 px ellipse → axis ratio 0.0265 = eye height /
distance → ring ~64 m out, facade at ~95 m. Level camera (window-bay pitch 104.0 vs
104.5 px at two storeys — no keystone) → shifted lens: fov 38.9° over a `fullScale` 1.6
virtual frame, `offsetYFrac = 0.8 − 788/1067 = 0.0615` drops the horizon onto row 788.
`widthFrac` **saturated at 0.699** (subject wider than the scan band) and read as a false
100% — the honest checks were bay pitch (104.0 px) and baluster pitch (9.0 px), scanned
identically in photo and render. Hard sun ratio 2.16, sampled wall-vs-portico.

## 20 Fenchurch St (387 px web photo) — the low-resolution ladder

At 387 px wide, every repeating unit sits at the autocorrelation noise floor: the scan
returns noise that looks like signal. The ladder: (1) magnified crop + direct band
counting; (2) parameterise and fit to the render loop instead of measuring; (3) name the
unreliable numbers in the file header. Scoring found both faces at ~76% of target with
the ratio already at 106% — the fix was **exposure alone** (1.10 → 1.44), the only lever
that moves both faces equally.

## Bolted hydraulic cylinder (CAD render) — the tilted axis and the ellipse bound

Subject lay at −29.9° in frame: solved the axis by image moments (PCA over the part
pixels), then all "width" measurements are half-extents PERPENDICULAR to that axis.
Radius profile = station-wise perpendicular extents → median smoothing → step detection
→ a `[radius, y]` polyline for a lathe. CAD class: radii exact, axial lengths
foreshortened — but the rod-eye bore is circular in reality and imaged 376.3 px
along-axis vs 315.8 px across → foreshortening 1.192, measured, not guessed. Chrome rod
nearly vanished white-on-white: the sky-distance detector needed rebuilding around
saturation. Solid of revolution = the one class with no invented rear.

## Villa elevation (drawing) — ink profiles and the near-ortho camera

A drawing has no lighting: row/column **ink-density profiles** give the structure —
strong horizontal lines are slabs/parapet/ground, strong verticals are wall edges and
jambs, openings sit at the intersections. Threshold chosen to *exclude* the pale
watermark (ink `luma < 170`). Scale from two standards that must agree: 2.40 m garage +
2.00 m door leaf. The reference view of a drawing must be **near-orthographic** (long
lens, ~10° fov): any perspective view is already showing invented depth. Photometric
targets would be fabrications — geometry-only scoring, light rig declared as chosen.

## Burj Al Arab (dusk photo) — gradient sky, solved camera, honest plan ambiguity

Dusk sky grades in BOTH axes: single-sample and pooled-margin sky models both fail;
silhouettes need a per-row sky interpolated between the left and right margins. Camera
solved in closed form: horizon row 878, right-silhouette slope 0.0804 → vertical
vanishing point → f = 700 px, tilt 26.2°, distance 234 m — verified by reprojecting the
spire tip to within 13 px. Scale cross-check: ~14 duplex bands × 6.8 m floors → spire at
320 m vs 321 m published. The plan (V half-angle φ = 16°) rests jointly on one corner row
and the membrane band width; a few degrees either way changes the plan a lot and this
elevation almost not at all — stated as the model's weakest link, which is what honest
ambiguity reporting looks like.

## FAILURE — the shingle house modelled frontal (read this one twice)

A Cape-style house at ~10–15° yaw: the porch wraps BOTH corners, the right flank
recedes, and the balusters run visibly tighter at the right end. Two independent 2-hour
runs both anchored on "front elevation" in minute one and never re-litigated it — one
camera was literally zero-yaw. Everything after was precise measurement inside a wrong
frame, then hours of detail (foliage textures, lattice, blooms) decorating it. What
would have caught it: the Step 1 frontality test (end-pitch comparison — five minutes),
and the Step 3 massing gate (a scored massing shows systematic edge error at the
receding end before any detail exists). No lit/shadow split warned anyone: hazy light,
white trim both ways. Shallow corners are silent.
