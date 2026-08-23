# Plan — v0.5.2: route the last advisory rules through tool outputs

**Written:** 2026-08-23, mid-run 5 (~min 70) · **Status:** awaiting approval
**Prior:** v0.5.1 (`fc54838`) + view_crop hotfix (`44db24b`, shipped mid-run)

Run 5 is the first field test of the full v0.5.1 stack. This plan collects what it
proved, what it broke, and the small set of changes that follow. The headline finding is
now confirmed across THREE runs: **every rule enforced by a tool held; every rule left
as skill prose decayed.** v0.5.2 is mostly about moving the last two advisory rules into
tool outputs, plus fixing what run 5 exposed.

---

## Run-5 evidence (as of minute ~70)

| v0.5.1 feature | Field result |
|---|---|
| Solver label prefix-grouping (A1) | ✅ **worked silently** — the exact per-line shape that hard-errored twice yesterday (`ridgeA_mainridge`…) grouped cleanly; verdict `usable` first call, LOO 4.6 px — best solve of any run |
| Aimed classify | ✅ crop on the very first call, no blind attempt |
| trace_edge / measure_pitch | ✅ heavy adoption (10+ / 1) |
| Gate luma (B1) | ✅ live — massing ratio 1.94 → detail pass 1.11, numbers in every save |
| Gate auto-rows in RECON (B5) | ✅ 5 rows appended automatically |
| Render trigger (B7) | ✅ adopted (`POST /__render` in use) |
| Batching (C2) | ✅ apparent — pass 2 was one huge batch: skyline 383→298, ratio 1.94→1.11 in a single pass |
| view_crop contact sheet (A4) | ❌ **regression**: schema union collapsed to an untyped field → agent sent strings → 6× validation errors → rebuilt crop.py. Hotfixed (`44db24b`), not in this run's in-memory server |
| `unproject` (A3) | ❌ **locked and silent**: solve used one vertical line → `camera_for_unproject: null` → nothing warned → the ~20-min saving never engaged |
| Massing-first boundary (C1) | ❌ ignored — detail measurement (door, deck, tile pitch) before any massing, placeholder still in `house.ts` at min 33 |
| RECON own sections | ⚠️ agent-written sections empty (gate rows only) |
| Delta block (B4) | ⚠️ cosmetic bug: zero-deltas on first saves (see A2 below) |

Timing, final (through pass 6, minute ~95): measurement ≈ flat vs run 4 (the two fixes
aimed at it were the two that failed); massing scored at min 45 (run 4: min 50).
**Refinement is the win**: five scored passes in 43 minutes reached skyline 138 px /
subject band 69 px —

| run | passes to reach ~this quality | refinement minutes |
|---|---|---|
| 3 | 11 (163/80) | ~95 |
| 4 | 12 (75/80) | 77 |
| **5** | **5 (138/69)** | **43** |

Roughly 2× the progress per pass and per minute. The lighting phase collapsed from five
blind passes (run 4) to ONE pass with live luma numbers (p3: ratio 1.94→1.26 in a single
correction). Batching is visible in the pass names themselves: p2-detail carried the
whole detail layer at once.

**The blank-render guard fired in anger and worked** (B2): p6-tune came back all-black
(the recurring page-error class), the gate refused it with the explicit message, no
garbage score was written — yesterday the identical event cost a silent diagnostic
cycle. One wording tweak below (A5): the agent responded by reading the GATE's source
rather than the page's console; the message should say harder that the pipeline is fine
and the PAGE is broken.

---

## A. Server (`mcp/`)

### A1. `solve_camera`: a `next` block in the result — the routing fix

**Evidence:** the massing-first boundary and the unproject unlock both live in skill
prose, and both decayed — third consecutive run in which advisory rules were skipped
while tool-carried rules held. Tool RESULTS are always read; that is where routing
belongs.

**Exactly what:** append to every solve result a `next` object, verdict-conditional:

- verdict `usable`:
  `"Build the MASSING now (footprint, eave, ridge, wings) and score it — do not measure
  windows/doors/trim until the massing has scored. After that, get feature positions
  with unproject, not per-feature crops."`
- `camera_for_unproject === null` adds, loudly and first:
  `"WARNING: unproject is LOCKED — no vertical family was formed (N vertical line(s)
  supplied; 2–3 needed: jambs, corners, downpipes). One more solve call unlocks
  world-coordinate feature placement."`
- verdict `weak`: the existing re-pick guidance moves in here too.

The skill keeps the rationale; the tool carries the instruction.

### A2. Gate: fix the delta keying

**Evidence:** both run-5 passes show `delta: {…: 0}` — the digit-stripped key
(`p1-massing` → `p#-massing`) collides with a re-save of the same render, so the pass
compares against itself. Double saves happen legitimately (manual POST + render-trigger).

**Exactly what:** key by exact filename; when the previous score for the SAME name is
numerically identical, report `note: "re-save, unchanged"` instead of a zero delta;
cross-name deltas (pass1 → pass2) come from the most recent DIFFERENT name. Regression
case: save A, save A again, save B — expect no-delta, "unchanged", real delta.

### A3. Span: make the subject window reachable without discipline

**Evidence:** `span: None` on every run-5 score — the aimed-scoring parameter exists but
nobody passes it, so flank vegetation still dilutes the headline number.

**Exactly what:** scene stub's `targets` gains `span: null` with a comment ("set after
measuring the subject's column extent — the scorer then reports a subject-band block on
every save"); the template's render-trigger and save helper forward `active.targets.span`
automatically when set. One measured pair of numbers, set once, applied to every pass.

### A1b. Converged verdict in the gate — the stop signal, routed like everything else

**Evidence (run 5, decisive):** passes 9–12 scored 108 → 110 → 110.4 → 110.4 — four
passes, ~25 minutes, net progress zero. The run stopped at EXACTLY the soft budget of
12, which means the number acted as an anchor, not the plateau rule: left uncapped it
would plausibly have kept going, and the plateau rule (skill prose) went the way of
every other prose rule. Same law, fourth confirmation: stop decisions must be routed
through tool output.

**Exactly what:** the gate already computes deltas. When a metric has moved less than
0.5% of the image diagonal across the last two DIFFERENT-named saves, the save response
says so explicitly and prescriptively:
`converged: {skyline: true, note: "geometry has not moved in 2 passes — further
geometry passes are waste. Move to the finish checks (__clearance, views) and
delivery."}`
Soft budget in the skill drops to **~8** with the existing justify-to-exceed escape —
the budget becomes a backstop, not the operative stop, because the gate now carries the
stop.

### A1c. Error localisation in the score — attack the thinking time itself

**Evidence:** refinement wall-clock barely moved (77 → ~70 min) despite 2× per-pass
efficiency, because each pass still costs 6–10 minutes of LOOKING — open the evidence
pack, stare at the overlay, decide which element is wrong. The score says HOW MUCH is
wrong; nothing says WHERE.

**Exactly what:** the skyline comparison already holds per-column errors. Report the
top-3 worst CONTIGUOUS SEGMENTS with pixel ranges and directions:
`worst_segments: [{x0: 1180, x1: 1400, mean_err: 42, direction: "render skyline too
HIGH"}, ...]`
The agent knows which element lives at columns 1180–1400 (it measured them); the fix
decision becomes near-mechanical, like a compiler pointing at the line instead of
saying "there are errors". Projected: per-pass think time from ~6–8 min toward ~3–4.

### A4b. Blank-guard message wording

**Evidence:** when p6 came back black, the guard's message worked — but the agent's
first move was to grep the gate's own source, suspecting the scorer. Add one sentence:
*"The scoring pipeline is healthy — the PAGE produced a black frame. Check the browser
console for the exception; do not debug the scorer."*

### A4. Document the schema rule

`mcp/README.md` gains one line: **no unions in MCP input schemas** — the SDK conversion
collapses them to untyped fields and models then guess (run 5: six string-typed guesses,
six rejections). Loose schema + handler normalisation is the house pattern
(`normalizeCrops` is the worked example, with the six field shapes as regression cases).

## B. Skill (`skills/photo-to-threejs-building/`)

- **B1.** Massing-first section: add one line pointing at the solver's `next` block as
  the operative carrier ("the solver will tell you when to stop measuring — listen").
- **B2.** RECON: soften the expectation honestly — the gate now writes the score
  history; the agent's job is Verified/REFUTED/Camera. One line in the loop grammar:
  "after each solve or measurement burst, move the numbers you now trust into RECON's
  Verified with their evidence" (run 5 kept everything in context and wrote nothing).

## C. Regression suite (`mcp/test/`)

- `next` block present and verdict-conditional; the unproject-locked warning fires when
  verticals < 2 (new solver case).
- Delta keying: the save-A/save-A/save-B sequence (new gate case — needs the scorer
  exercised through a scripted endpoint call, same pattern as the gate51 scratch test).
- Existing 31 checks stay green; the tower guard is untouched by any of this.

## Explicitly not in 0.5.2

- No new tools. Nothing in run 5 hand-built anything the server lacks (crop.py was a
  fallback from a regression, not a gap).
- No hard iteration caps, no sub-agent pipeline changes — refinement so far shows
  batching working; let the current rules finish their first full run before touching
  them.
- lib/context.ts stays cut.

## Validation

1. Finish run 5; final tally against the 12-pass budget, `__clearance()` at delivery,
   `open_viewer`, total wall-clock.
2. Run 6 (fresh folder, restart first, plain single server): the full v0.5.2 stack.
   Bar: ≤60 min, unproject actually used, massing before detail (the `next` block's
   test), subject-band span reported on every save.
3. Burj generality run afterwards, unchanged from the 0.5.1 plan.

---

## Implementation record — shipped 2026-08-23

All of A1, A1b, A1c, A2, A3, A4, A4b, B and C are implemented. Two things changed
against the plan as written, both because the evidence said so once the code existed:

**1. The stop rule is relative, not absolute — and it has TWO verdicts.** The plan's
literal rule ("delta < 0.5% of the image diagonal over two passes") is wrong as a stop
signal: on a 2200 px diagonal that is an 11 px threshold, so two honest 8 px
improvements against a 150 px error would have been declared converged while the render
was still visibly wrong. The shipped rule asks whether a pass BUYS anything, which is
relative: a metric that moves less than 3% of its own value, twice running, is not being
improved by the kind of pass being taken. The 0.5%-of-diagonal number was reused where
it belongs — as an absolute *delivery floor* (1% of the diagonal) that decides WHICH
verdict is issued:

- `converged` — not moving, error inside the floor → go to the finish checks and deliver.
- `stalled` — not moving, error still large → **more passes of this kind will not close
  it**; read `worst_segments`, find the element in those columns, re-MEASURE it.

**2. Replaying run 5's own renders through the new gate reclassified its ending.** The
twelve saved renders in `mcp-test-5/viewer/renders/` were fed to the new scorer in order.
The gate's verdict at p12 is **stalled, not converged**: skyline 110.4 px against a
21.9 px delivery floor, having moved 0.2 px then 0.0 px. So run 5 did not finish early
because it was done — it stopped because it hit the pass budget while stuck, and the
run's last hour was spent tuning parameters against a residual that was structural. The
localiser says where it was structural, and says the same thing on all three of the last
passes: **x 169–433 off by 228 px (render too LOW)** and **x 919–1115 off by 166 px
(render too HIGH)** — a whole element wrong in the left third, unchanged across three
passes that never addressed it. That is the exact failure the two new blocks are built
to break, and it is now a fixture rather than an anecdote.

**Regression suite: 31 → 54 checks**, all green, including the tower guard. New coverage:
the solver's `next` block (present, verdict-conditional, unproject-locked warning fires
and counts the verticals actually supplied), the gate's delta keying (save A / save A /
save B), both stop verdicts, an unreliable row scan not being allowed to drive a stop,
identity localising nothing, and a re-save never counting as one of the two passes.

---

## Implementation record — shipped 2026-08-23

All of A1, A1b, A1c, A2, A3, A4, A4b, B and C are implemented. Two things changed
against the plan as written, both because the evidence said so once the code existed:

**1. The stop rule is relative, not absolute — and it has TWO verdicts.** The plan's
literal rule ("delta < 0.5% of the image diagonal over two passes") is wrong as a stop
signal: on a 2200 px diagonal that is an 11 px threshold, so two honest 8 px
improvements against a 150 px error would have been declared converged while the render
was still visibly wrong. The shipped rule asks whether a pass BUYS anything, which is
relative: a metric that moves less than 3% of its own value, twice running, is not being
improved by the kind of pass being taken. The 0.5%-of-diagonal number was reused where
it belongs — as an absolute *delivery floor* (1% of the diagonal) that decides WHICH
verdict is issued:

- `converged` — not moving, error inside the floor → go to the finish checks and deliver.
- `stalled` — not moving, error still large → **more passes of this kind will not close
  it**; read `worst_segments`, find the element in those columns, re-MEASURE it.

**2. Replaying run 5's own renders through the new gate reclassified its ending.** The
saved renders in `mcp-test-5/viewer/renders/` were fed to the new scorer in order. The
gate's verdict at p12 is **stalled, not converged**: skyline 110.4 px against a 21.9 px
delivery floor, having moved 0.2 px then 0.0 px. So run 5 did not stop because it was
done — it stopped because it hit the pass budget while stuck, and its last hour went on
tuning parameters against a residual that was structural. The localiser says where, and
says the same thing on all three of the last passes: **x 169–433 off by 228 px (render
too LOW)** and **x 919–1115 off by 166 px (render too HIGH)** — a whole element wrong in
the left third, unchanged across three passes that never addressed it. That is the exact
failure the two new blocks are built to break, and it is now a fixture, not an anecdote.

**Regression suite: 31 → 54 checks**, all green, tower guard included. New coverage: the
solver's `next` block (present, verdict-conditional, unproject-locked warning fires and
counts the verticals actually supplied), the gate's delta keying (save A / save A / save
B), both stop verdicts, an unreliable row scan not being allowed to drive a stop,
identity localising nothing, and a re-save never counting as one of the two passes.
