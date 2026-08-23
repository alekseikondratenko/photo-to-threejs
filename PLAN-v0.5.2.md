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
