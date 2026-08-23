# Plan — v0.5.1: cut the two bottlenecks, fix what the field runs broke

**Written:** 2026-08-22 · **Status:** awaiting approval · **Repo:** this one

Self-contained: written to be executed cold. Every change below is funded by a specific
observation from the three validation runs of 2026-08-21/22 on the prefab-house photo,
and every change carries its own generality check so house-tuning cannot silently
regress tower subjects.

---

## 0. Where things stand

v0.5.0 shipped 2026-08-22 (commit `fcc7282`): auto-scoring gate, RECON.md ledger,
`view_crop`/`trace_edge` instruments, shifted-lens branch, plugin packaging. Three
validation runs since:

| Run | Stack | Wall-clock | Scored passes | Final (skyline mean / house band) | Delivered |
|---|---|---|---|---|---|
| morning | 0.4, no gate | 2h45+ | 1 | never converged | never |
| test-3 | 0.4 camera → 0.5 build | ~27m + 1h35 | 19 | 84 / 59 | ✅ + panel rendered |
| test-4 | full 0.5, clean | 2h07 | 21 | best 75 / 80 | ✅ + panel rendered |

Test-4 time split: scaffold 1 min · **measurement sweep 38 min (30%)** · build-to-first-
render 11 min · **refinement 77 min (60%)**. Those two bold numbers are this release.

**Targets:** house-class subject ≤45 min after one tuning iteration (~55–60 min expected
straight after implementation); 30 min is the stretch goal. Tower subjects get their own
calibration run afterward — budgets do not transfer across subject classes.

Reference fixtures for all validation (already on disk):
`viewer/public/reference-{empirestate,taipei101,whitehouse}.jpg`,
`/Users/alexbest/Desktop/skill-test/p3050792a.jpg` (Burj),
`/Users/alexbest/Desktop/mcp-test-3/house.jpg` (house).

---

## A. MCP server (`mcp/`)

### A1. `solve_camera`: family labels — accept what agents actually write

**Evidence:** two independent agents, same photo, identical failure: per-line labels with
the family encoded as a prefix (`v-win1-jamb`, `R_ridge`, `G_uppersill`). My solver
requires exact shared labels, saw N singleton families, and threw. Cost one round-trip
each (44 s and 73 s recovery — but only because both agents were sharp about it).

**Exactly what:** in `src/camera.ts`, before grouping, run label normalisation:
1. If ≥ half the labels are unique (singleton families), cluster by prefix: split each
   label on the first `-`, `_`, or `.`; labels sharing a prefix join one family.
2. If prefix clustering still yields mostly singletons, fall back to the existing
   direction-based `autoLabel` grouping.
3. Whatever grouping was applied is reported in the result (`label_grouping:
   "as-given" | "prefix" | "direction"`) plus a warning explaining it, so a wrong guess
   is visible and correctable — same honesty pattern as auto-crop.
The error path ("no horizontal family found") also gets a concrete example in its
message: *label lines by FAMILY — three eave lines all labeled "eave", not per-line names.*

**Generality:** grouping is label-shape logic, subject-independent. Regression: both
field runs' exact failing inputs (preserved in this repo's test fixtures, D1) must now
solve without error.

### A2. `solve_camera`: vertical-VP "infinity" threshold — the risky fix

**Evidence:** test-4's second solve had two shortish jambs whose fitted VP landed at
y ≈ 70,250 px — verticals parallel for all practical purposes, convergence pure noise —
but my 50-diagonal finiteness cap counted it as finite, so the shifted-lens branch was
skipped and the principal point wrongly stayed at frame centre. One extra solver
iteration to recover.

**Exactly what:** the *shifted-lens decision* (not the general finiteness report) gets
its own test: treat the vertical family as "effectively parallel" when its VP distance
from the frame centre exceeds **8 image diagonals** OR when the implied tilt is under
~1.5°. In that case: no-tilt + principal-point-on-horizon treatment, with the existing
explanatory `ppSource`. The general `at_infinity` reporting keeps the conservative 50-
diagonal rule (it only affects display).

**Generality — this is the one house-flavoured change that could break towers.** A
ground-level tower photo has REAL vertical convergence (Burj: visible tilt; Taipei:
converging verticals are the method's textbook case). Regression (D1) must show: Burj
and synthetic tilted-camera line sets keep their nonzero tilt and centred principal
point; only the archviz-crop cases (parallel verticals + off-centre horizon) get the
branch. The 12°-tilt synthetic sweep from v0.4 must stay exact.

### A3. New tool: `unproject` — the measurement sweep's biggest cut

**Evidence:** the single largest remaining sink. Test-4 spent ~15 magnify→look→measure
cycles (≈25 min) pixel-measuring windows, doors, eaves and base individually — *after*
its camera was solved at minute 22. The morning run hand-built exactly this tool
(`unproject.py`, with an axis bug that cost a debug cycle). Two independent runs = the
tool is earned under the standing rule.

**Exactly what:** `src/camera.ts` grows pure functions; `server.ts` registers:

```
unproject({
  camera: <the solve_camera result, passed back verbatim (or its intrinsics+pose)>,
  plane: {axis: "x"|"y"|"z", value: number},   // facade z=0, gable x=0, ground y=0
  points: [[px,py], ...],                       // image pixels
})
→ { world: [[x,y,z], ...], reprojection_check_px: [...] }
```

and the inverse `project` (world→pixel) in the same tool via a `direction` argument.
Every unprojection is verified by reprojecting and reporting the round-trip error —
the field bug in `unproject.py` (axis confusion producing (6370, 52) instead of
(900, 500)) is exactly the class a built-in round-trip check makes impossible to miss.
The skill's tool table adds the row: *after the camera is usable, feature positions come
from `unproject`, not from per-feature crops.*

**Generality:** planes and cameras are subject-independent. Regression: synthetic camera
round-trips exactly; the morning run's hand-derived unprojections (documented values:
eave 2.95 m, apex y 7.92 m) are reproduced from its line set.

### A4. `view_crop`: contact-sheet mode

**Evidence:** test-4 issued 9 separate `view_crop` calls, each costing a round-trip plus
an image read. Independent crops; serial calls.

**Exactly what:** `crop` parameter also accepts an array of up to 6 regions → one output
PNG, regions tiled side by side, each with its own coordinate grid and a corner tag
(`A`, `B`, …) mapping to a `regions` list in the JSON result. Single-crop behaviour
unchanged.

**Generality:** none needed. Regression: single-crop output byte-identical to v0.5.0.

### A5. README host matrix + tool table

**Evidence:** Claude Code 2.1.237 (Desktop-embedded) fetched the View and ran the panel
— both deliveries called `get_viewer_bundle` over the app→server channel and rendered.
The matrix's "Claude Code ❌ never fetches the View" is stale; also add `unproject`.

---

## B. Workspace template (`skills/…/assets/viewer-template/`)

### B1. Gate: luma blocks — the refinement phase's biggest cut

**Evidence:** test-4 passes 4–9 have near-identical silhouette scores — they were
lighting/texture passes, and the gate gave them **zero** numeric feedback because
`scripts/score.mjs` ports only silhouette+skyline, not the lit/shadow-luma blocks
`score_render` has. Five blind passes; the agent later called `score_render` manually to
get luma numbers the gate should have handed it.

**Exactly what:** port `bandStats` + in-silhouette luma percentiles + sky-luma samples
from `mcp/src/scan.ts` into `score.mjs` (same "keep the two in step" header contract);
gate response gains `luma: {lit_band, shadow_band, ratio, sky:[...]}`.

**Generality:** the identical blocks already run on towers via `score_render`.

### B2. Gate: blank-render message

**Evidence:** three all-black renders across the two runs (page exceptions mid-loop),
each scored as a mute `null` that the agent had to diagnose from nothing.

**Exactly what:** in the save endpoint, before scoring: if the decoded render's luma
range is degenerate (max − min < 2), respond
`{scored:false, warning:"render is uniform (black) — the page is erroring or the canvas
was read before a paint (bug checklist #9). Check the browser console, then re-save."}`
and skip the scorer.

### B3. Gate: aimed scoring span

**Evidence:** on the house photo the skyline's flank bands measure *trees*, not
building (pass-1 flanks 487/585 px vs middle 107). Test-3 judged the generic number
insufficient and hand-built a subject-scoped checker (column range 600–1330) — the
second independent demand for aimable scoring in one day.

**Exactly what:** the POST body accepts optional `span: {x0, x1}` (reference-image
columns). When present, `subject` blocks (skyline + row-scan) are computed within the
span and reported alongside the full-frame numbers, never replacing them. The scene
stub's `targets` gains an optional `span` the agent fills from measurement; the save
helper passes it automatically.

**Generality:** optional; absent = today's behaviour. Towers rarely need it (row-scan
dominates there).

### B4. Gate: score deltas

**Exactly what:** the endpoint keeps the previous score per render name prefix in
memory; response gains `delta: {mean_top_error_px: -14.2, ...}` vs the previous pass.
Cheap; removes the re-open-old-score-files step observed between passes.

### B5. Gate: RECON score-history auto-row

**Evidence:** both runs' RECON "Score history" tables stayed empty — the `.score.json`
files made manual logging feel redundant, so the ledger lost its at-a-glance trend.

**Exactly what:** if `../RECON.md` (relative to the workspace) exists and contains the
`## Score history` marker, the endpoint appends the row
`| <name> | <mean_top / mean_edge> | <house band> | <area> | auto |` after scoring.
Purely additive; agent prose still owns the "what changed" column via edit.

### B6. `__clearance()` — the window-through-the-roof check

**Evidence:** test-4's delivered model has wing windows interpenetrating the main roof
plane — invisible in the reference view, obvious in 3/4. No mechanism checks the model
against itself; the agent even inspected that region of its own render and missed it.
Deterministic check required (eyes demonstrably insufficient — builder's blindness).

**Exactly what:** in `src/lib/measure.ts`, add `window.__clearance()`:
1. Collect meshes whose names match `/window|door|opening/i` ("openings") and
   `/roof|rake|verge/i` ("roofs") — the template's stub establishes the naming
   convention, and the result lists which meshes matched so a silent nothing-matched is
   visible.
2. For each opening: sample its front face (4 corners + centre, world space), raycast
   along the face normal both ways a short distance (~0.5 m), and flag any roof-mesh hit
   as a penetration, reporting mesh names + depth.
3. Returns `{checked, penetrations: [...]}`. The skill's finish gate (C-section) makes a
   non-empty `penetrations` a delivery blocker.

**Generality:** towers without pitched roofs simply match zero "roof" meshes — check
degrades to a no-op and says so.

### B7. Render-trigger endpoint

**Evidence:** every pass pays browser-driving overhead (switch view, execute
`toDataURL`, POST) — one to two minutes per pass across ~20 passes per run.

**Exactly what:** the dev server adds `POST /__render {view, name, span?}` which places
a command in a queue; the viewer page polls `GET /__render-queue` every second (plain
fetch, dev-server only), renders the requested view at exact size, and posts it to
`/__save-render` as today. The agent's pass becomes: edit file → one curl → score in
response. No websockets, no new deps; the polling loop lives in `main.ts` behind
`import.meta.env.DEV`.

---

## C. Skill (`skills/photo-to-threejs-building/SKILL.md`)

All are text edits; each is one tight clause where the runs showed drift.

- **C1. Massing-first boundary.** New hard step rule: *detail measurement (windows,
  doors, trim) happens only after the first scored massing; the scored overlay directs
  which details to measure; use `unproject` for positions once the camera is usable.*
  Why safer, stated in the text: features measured against an unverified frame go stale
  when the frame moves (the morning run re-measured its windows after the scale
  correction).
- **C2. Batch independent fixes.** Replace the literal reading of "fix the largest error
  first": *fix the largest error AND every independent smaller fix in the same pass;
  passes are expensive, edits are cheap.* (Test-4: 21 passes, most single-fix.)
- **C3. Plateau stop rule + soft budget.** *A metric that improved less than 0.5% of the
  image diagonal over the last two passes is converged — stop optimising it and move
  phase. Soft budget ~12 passes; exceeding it requires a one-line justification in
  RECON.* Percent-of-diagonal, not absolute px, so it scales across subjects. No hard
  cap — accuracy is not traded, aimlessness is.
- **C4. Context cap.** *Context is massing-only (existing rule) and gets at most ~2
  passes total; the subject band converges, flank bands are advisory.* (Test-4 spent a
  large share of late passes hand-staging garden.) Replaces the cut `lib/context.ts`.
- **C5. Verifier sub-agent at the finish.** *Before delivery: run `__clearance()` (any
  penetration blocks); then, if the Agent tool is available, spawn a fresh-eyes verifier
  with ONLY the multi-view renders + the photo, prompted adversarially ("find visual
  defects"); fix what it finds. If no Agent tool, do the same review yourself on fresh
  `view_crop`s of the view renders.* Sub-agents deliberately NOT used for measurement or
  refinement: measuring is hypothesis-forming (parallel measurers return numbers without
  the mental model), passes are serial, and two agents in one `house.ts` is a merge
  conflict, not a speedup.
- **C6. Tooling hygiene.** Demote the Step-2 PIL snippet to a "no-server fallback"
  appendix (the worked example was observed out-competing the tool table); add one line:
  *load all photo-to-threejs tools in a single ToolSearch call before starting.*

---

## D. Regression suite (`mcp/test/`) — gates every release

**Evidence:** the user's standing requirement: five subjects, different scales; house
tuning must not regress towers. Today's ad-hoc scripts become permanent.

- **D1. `regression.md` + `run.mjs`:** one command runs, against all five photos:
  - scorer identity checks (photo vs itself: 0.0 error, both axes);
  - classify sanity (expected bounded-rows ranges per photo; house auto-crop fires);
  - solver: synthetic 12°-tilt camera exact; the two field label-failure inputs solve
    via A1; shifted-lens fires on the house archviz lines and does NOT fire on the
    Burj/synthetic tilted sets (A2's guard);
  - unproject round-trips (A3).
- Wired as `npm run test` in `mcp/`; the rule goes in `mcp/README.md`: no push without it.

---

## Explicitly cut / rejected

- **`lib/context.ts`** — cut per priority call: context is not the subject. C4's cap
  recovers the minutes without new code.
- **Hard iteration cap (e.g., 5 passes)** — rejected: trades accuracy unpredictably;
  C3's plateau rule + soft budget achieves the same discipline without the risk.
- **Sub-agents for measurement/refinement** — rejected for workflow-shape reasons
  (C5 rationale); kept only as the finish verifier.
- **Auto-line-detection for the solver** — still parked; picking lines is judgement.

---

## Validation protocol

1. **House run** (fresh folder, plain terminal — single server, cold context, same
   minimal prompt). Pass bar: ≤60 min converged + delivered, gate luma numbers used in
   lighting passes, `__clearance()` clean, ≤ ~12 passes, `unproject` adopted.
2. **Tuning iteration:** the run will surface what desk-checking cannot (today's runs
   surfaced six such items); apply small fixes; re-run → target ≤45 min.
3. **Generality run: Burj** (hardest camera, curved silhouette, tall class). Own
   budget calibrated from the run, not assumed; regression suite green throughout.

## Projected effect (house class)

| Phase | Today | After v0.5.1 |
|---|---|---|
| Measurement + camera | 38 min | ~15 (A3, C1, A4) |
| Build to first render | 11 min | 11 |
| Refinement | 77 min | ~25–30 (B1, C2, C3, C4, B7, B2) |
| **Total** | **127 min** | **~55 min → 45 after tuning** |

30 minutes remains the stretch goal, reassessed after the tuning iteration with real
numbers rather than promised now.
