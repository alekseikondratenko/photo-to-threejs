# Plan — v0.5.3: the minutes, named

**Written:** 2026-08-23, after run 6 · **Status:** awaiting approval
**Prior:** v0.5.2 (`ac2183e`), field-tested in run 6 (mcp-test-6, 96 min to delivery, ~110 with repairs)

This plan is ordered by ONE criterion: **minutes each fix removes from the next run.**
Every item names its cost in run 6, the mechanism that caused it, and the projected
saving. The law that has now held across six runs: the model is not the constraint —
the routing is. Every lost minute below is a minute where the capability existed and
nothing steered the agent to it at the moment of decision.

## Run-6 ledger (where the 96 minutes went)

| Phase | Window | Minutes | Verdict |
|---|---|---|---|
| Camera + measurement | 0–11 | 11 | ✅ best of any run — solve accepted, unproject UNLOCKED at min 11 |
| Measurement → model translation | 11–41 | **30** | ❌ hand-derived world coordinates in 4 Python files; `unproject` never called |
| Refinement | 41–96 | 55 | ⚠️ silhouette converged ~min 65; last ~30 min invisible to the metric, no stop verdict ever fired |
| Delivery + hole repair | 96–110 | 14 | ⚠️ three eye-passes finding mesh holes one at a time |

Baseline comparison: run 5 = 123 min with a worse model, no ledger, no clearance during
refinement. Run 6 = 96 min, best model of any run, correct shifted-lens call, 136-line
evidence ledger. The quality floor rose while the clock dropped.

---

## A. The big three — each worth 10–20 minutes

### A1. Unconditional unproject routing  — **cuts ~20 min**

**Cost in run 6:** 30 minutes (min 11→41). `camera_for_unproject` was PRESENT from
solve #2 onward. The agent then wrote `geo.py`, `geo2.py`, `geo3.py`, `geo4.py` —
rays through a hand-built camera basis intersected with named planes, i.e. `unproject`
reimplemented from scratch, including a hand-rolled bisection solver because scipy
wasn't installed.

**Mechanism:** my A1 (0.5.2) gated the routing on the verdict. The sentence "get
feature positions with unproject, not per-feature crops" ships ONLY with verdict
`usable`. Both run-6 solves were `weak`, so the agent never received it — the routing
was silent precisely on the verdict a real photograph usually produces.

**Fix, exactly:**
- The `next` block carries the unproject instruction on **every** verdict where
  `camera_for_unproject` is non-null. Re-picking a weak line and using the right
  instrument are orthogonal; a weak verdict carries BOTH sentences.
- The instruction includes a **worked call for this exact solve** — paste-ready:
  `unproject({image, camera: <the camera_for_unproject block above>, points: [[x,y]],
  plane: "ground y=0"})` — so using the tool is copy-paste and hand-rolling is
  visibly the slower path.
- Regression: a `weak` synthetic solve's `next.do` must contain both the re-pick line
  AND the unproject line (this is the exact case the 0.5.2 suite never asserted —
  it only tested the `usable` path, which is how the gap survived).

### A2. Variant-aware pass keying → the stop verdict can actually fire — **cuts ~10–15 min**

**Cost in run 6:** the agent rendered every pass twice (`p10.png` with context,
`p10-nc.png` without — a sensible move it invented to keep context out of the score).
My "most recent DIFFERENT name" delta keying then compared each save against the
OTHER VARIANT of the same pass: every delta was the ±190 px context gap, never
progress. Two consecutive sub-3% moves — the convergence condition — was structurally
unreachable. The aimed span number shows the run genuinely plateaued
(p4-nc 178.7 → p11-nc 192.3, seven passes, drifting UP), and the gate that exists to
say "stalled — stop tuning, re-measure" never got to say it. The agent declared
"geometry and lighting have converged" by feel — the exact pre-0.5.2 situation,
reached through my mechanism failure.

**Fix, exactly:** group renders into passes by stripping a variant suffix
(`-nc`, `-ctx`, `-wire` → same pass family; general rule: trailing `-<word>` after the
pass stem). Deltas and the convergence test compare a variant against the SAME variant
of the previous pass. Cross-variant saves within one pass get
`note: "variant of p10 — compared against p9-nc"`. Regression: the exact run-6
sequence (p9, p9-nc, p10, p10-nc with alternating ±190) must produce clean per-variant
deltas AND a stalled verdict by p11-nc.

### A3. Gap check beside `__clearance` — **cuts ~10 min, removes the last eye-dependency**

**Cost in run 6:** 14 post-delivery minutes across three separate eye-passes:
"far gable has holes but no window units behind them", "hole where the main roof stops
short of the wing's cheek", "sky shows through at the valley". All three are the same
defect class — surfaces that don't close — and none of the instruments can see it:
the silhouette only reads the outline, `__clearance` only tests openings-vs-roof
INTERSECTION, luma doesn't care. Second consecutive run to ship with visible holes.

**Fix, exactly:** `__gaps()` in the measure harness, next to `__clearance()`:
- every opening-class mesh raycasts INWARD — no backing surface within 0.5 m ⇒
  "unbacked opening";
- roof-plane boundary edges are tested for a coincident partner edge (another roof
  plane or a wall top) within tolerance ⇒ unmatched edge = "open seam", reported with
  its world position and length;
- same contract as clearance: reports what it matched, so nothing-matched ≠ pass.
- Delivery gate line in the skill becomes: `__clearance() && __gaps()` both clean.

## B. The supporting two — smaller, but they compound

### B1. Auto-derived span — **cuts ~5 min + removes a trust failure**

Two runs in a row hand-built a subject-scoped scorer because the full-frame number
measures vegetation and weather (run 6: 389 columns "detect" the skyline at row ≤ 20 —
clouds; flanks 475/568 px vs middle 101). The 0.5.2 fix (`targets.span`) shipped
opt-in, defaulted to null — a parameter nobody sets is not a fix; that is the
prose-vs-tool-output lesson one level down.

**Fix:** on the FIRST scored save, the gate derives the subject's column extent
itself — largest contiguous column run whose skyline sits meaningfully below the
top-margin sky rows — stores it in the score as `span_auto`, and reports the aimed
number on every save. `targets.span`, when set, overrides. When flank bands exceed
the middle by >2×, the response says explicitly: "flanks are measuring
vegetation/sky — trust subject_span."

### B2. Geometric vertical-family detection — **cuts ~3 min + one wrong camera**

Run 6 labelled its verticals `V-red-corner`, `V-white-gable-corner`. Prefix grouping
correctly formed family "V" — which then failed `startsWith("vert")`, was treated as a
third horizontal family, produced focal 771 px (wrong) and `camera_for_unproject:
null`, and my locked-warning told the agent it had supplied **0** verticals when it
had supplied two. Recovery cost one extra solve (the `next` block DID route it back —
the warning named the fix and the agent executed it).

**Fix:** a family is vertical if its lines are near-image-vertical (the `autoLabel`
test, applied to the family's median direction) OR its label starts with v/vert/plumb.
Regression: the exact run-6 labels must solve with unproject unlocked on the first call.

## C. Explicitly NOT in 0.5.3

- **No detail-scoring instrument.** The last ~30 refinement minutes were window/
  material/lighting work the silhouette cannot see — but that work was GOOD (it
  produced the best model of any run). The fix is not a new metric; it is A2's stop
  verdict saying "silhouette is done — switch to the finish checklist" so the detail
  phase starts explicitly instead of blending into scoring passes that measure nothing.
- No new tools beyond `__gaps()`. Run 6 hand-built nothing the server lacks except
  what A1 fixes.
- No budget changes. The budget was not the binding constraint in run 6; the missing
  stop verdict was.

## D. Projected run-7 arithmetic

| Phase | run 6 | run 7 target | via |
|---|---|---|---|
| Camera + measurement | 11 | ~11 | (already good) |
| Translation → first massing | 30 | **~12** | A1 |
| Refinement | 55 | **~30** | A2 stop verdict + B1 trusted number |
| Delivery + repair | 14 | **~7** | A3 gaps in one call |
| **Total** | **~110** | **~60** | |

## E. Validation

Run 7, fresh folder (mcp-test-7), restart Desktop first. Bar: ≤60 min;
`unproject` actually CALLED (≥3 times — the grep is the test); a stalled/converged
verdict fired at least once; `__gaps()` clean at delivery; zero hand-written
geometry/scoring Python. Then the Burj generality run, unchanged.
