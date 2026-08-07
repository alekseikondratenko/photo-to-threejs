# Plan — next MCP iteration (v0.3.1 → v0.4)

**Written:** 2026-08-08 · **Status:** ready to execute · **Repo:** this one; server code in `mcp/`

Self-contained: written to be picked up cold in a fresh session with no memory of the
conversations that produced it. Every claim below is backed by a field test that already
happened.

---

## 0. Where things stand

Server `photo-to-threejs` v0.3.1 (`mcp/`), five tools, all field-tested on real runs:

| Tool | State |
|---|---|
| `classify_reference` | works; validated on the Burj photo (tilt + non-linearity hints correct); honestly blind on occluded-margin photos |
| `measure_reference` | works; same blindness class — sky-margin detection fails on trees/crops (4 of 4 real photos) |
| `score_render` | works; agrees with an independent Python ruler on ranking and magnitude; per-band breakdown localises defects |
| `init_workspace` | works; scaffold compiles; **zero field adoption so far** (one agent built its own esbuild stack instead — single data point, no action) |
| `open_viewer` | server + URL + openLink all proven in Claude Desktop chat; panel renders; iframe CSP fix (whole port range, resource-level metadata) shipped in 0.3.1 — **panel-with-content retest pending** |

Host matrix (panels): reference host ✅ · Desktop chat ✅ (renders; iframe was blank pre-0.3.1) ·
Desktop Cowork ❌ (identifies as `claude-code`) · Claude Code ❌ (never fetches the View).

Debugging aid that already exists: `mcp/handshake.log` records every raw `initialize`,
`resources/read` and `tools/call` — read it before theorising about host behaviour.

Smoke-test pattern (used throughout; copy it):

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}' \
 | npx tsx main.ts --stdio
```

Fixtures for validation (already on disk, from the acceptance tests):
- `/Users/alexbest/Desktop/skill-test/p3050792a.jpg` + `renders/final.png` (Burj — scorer ground truth)
- `/Users/alexbest/Desktop/mcp-test/csm_variant-45-130-hero-hell_25204b3c0b (1).jpg` (prefab house — the occlusion case)
- `/Users/alexbest/Desktop/skill-test-3|opus|fable/` (three more runs on the prefab photo)

---

## 1. The evidence: where agent time actually goes

Mined from eight observed runs (two Burj, four house/prefab, one MCP-condition, plus the
original seven-subject session). **Selection rule, use it for everything:** *a capability
earns a tool when ≥2 independent runs hand-built it or burned >15 minutes on it. One
data point = log it, don't build it.*

| # | Time sink | Evidence | Cost | Answer |
|---|---|---|---|---|
| 1 | Camera / vanishing-point algebra | skill-3 (~40 min two-VP solve), MCP run (~30 min spiral, five re-derivations, arithmetic slips), T1 Burj | **#1 sink** | **`solve_camera`** (build §2.2) |
| 2 | Measurement blinded by real backgrounds | shipped scanner failed 4/4 field photos (dusk gradient, sea horizon, vegetation, hero-crop margins) | 10–20 min/run | **crop params** (build §2.1) |
| 3 | Photo-matched Three.js camera construction | MCP run (setViewOffset frustum math), skill-3, T1, White House originally | folded into #1 | `solve_camera` also **emits the ready-to-use camera/View block** |
| 4 | Aimed pitch measurement (balusters, courses, per-face end-pitch) | every run, odd places each time | recurring | **`measure_pitch`** (build §2.3) |
| 5 | Evidence/overlay plumbing (side-by-sides, wipes, blends) | T0 built 6 evidence images by hand; T1 wipes; skill-3 `work/blend*.png` | 10–15 min/run | **`compare_images`** (build §2.4) |
| 6 | Workspace boilerplate | all template runs | ~10 min | ✅ done (`init_workspace`) |
| 7 | Lighting/shadow debugging | MCP run's dark-gable hunt; Fable's fatal black render; Opus dark | real but shapeless | **knowledge, not a tool**: scene-graph probes reference (query normals / material props / map sizes) + the skill's legibility floor. Do NOT build a tool here — no two runs built the same artifact. |
| 8 | Roof-construction geometry (valleys, Wangen, hips) | MCP run, house runs | ~10 min | **reference text** (roof-geometry cookbook page), not a tool — reasoning is subject-coupled |
| 9 | Procedural textures rewritten per run | pure + skill house runs | ~10 min | template `lib/finish.ts` helpers — belongs to the skill's Batch 3, not MCP |
| 10 | **Routing failures** (capability exists, agent never told the user wants it) | agent never called `open_viewer` unprompted; mapped "show inline" to host-native tools; my own anti-narration warning deterred selection | 0 min, product-critical | **delivery clauses** (build §2.5) |

Together, items 1–5 attack roughly 60–70 of the 94 minutes the best skill run spent.

---

## 2. Build list, in order

### 2.1 Crop-region params (smallest, unlocks everything)

Add optional `crop: {x0, y0, x1, y1}` (reference-image pixels) to `classify_reference`,
`measure_reference` — and to the new tools below. Implementation: crop the decoded bitmap
before scanning (`src/scan.ts`, trivial slice), and **report coordinates back in
full-image space** so numbers stay comparable. Rationale: agents already crop by hand
within minutes; "detectors blind" becomes "agent aims, tool measures". The division of
labour is the architecture: judgement in the agent, determinism in the tool.

### 2.2 `solve_camera` (the big one)

Input: `image`, `lines: [{x0,y0,x1,y1, label?}]` — 4–10 line segments the agent picks
(edge/eave/ridge/sill families; picking is judgement and stays with the agent), optional
`known: {height_m?, pitch_deg?}`.

Output:
- vanishing points per family (robust fit, report residuals per line)
- horizon row, focal length, principal-point assumption **with the ambiguity stated**
  (the cx/f tradeoff is real — field runs proved measurements can't pin both; say which
  was assumed and why)
- camera pose: yaw/tilt/eye-height ratios; absolute values only if `known` given
- one **reprojection cross-check** (predict a point the agent didn't supply; the skill's
  Step 2.5 rule as code)
- **ready-to-paste camera block**: `View`-shaped `{pos, target, fov, shift?}` for the
  template AND raw `setViewOffset` params for non-template stacks

Why: the observed spirals are algebra churn — five re-derivations with sign slips — not
line-finding. Deterministic math with residuals ends the class. Keep the solver honest:
inconsistent inputs must return "inconsistent, residual X px on line Y", never a forced
answer (impossible answer = broken method, not weird building).

### 2.3 `measure_pitch`

Input: `image`, `crop`, `axis: "vertical"|"horizontal"`. Output: `autocorrPeaks` result
(already exists in `scan.ts` — this is a thin aimable wrapper) + the noise-floor warning
below ~8 px. Generalises floor pitch, baluster pitch, tile courses, and the corner
end-pitch comparison (call twice, two crops).

### 2.4 `compare_images`

Input: `imageA`, `imageB`, `out_dir`. Output: writes `overlay.png` (50% blend),
`wipe.png` (split), `edge_diff.png` (both silhouettes drawn on A), returns paths +
the existing `scoreImages` numbers. One call replaces the evidence pack every run
hand-builds. Reuse `decodeImage/resize/silhouette`; PNG encode with `pngjs`.

### 2.5 Delivery clauses (routing fix — two sentences, no code)

- `open_viewer` description: add *"In hosts that support MCP Apps this is the way to
  show the viewer inline in the conversation — prefer it when the user asks to see the
  result in chat."* (The existing anti-narration warning stays, but it currently reads
  as "unreliable option" and deters selection — the positive clause balances it.)
- `reconstruct_from_photo` prompt: add final step — *"When the reconstruction is done,
  build the workspace and call `open_viewer` so the result appears in the conversation."*

### 2.6 Housekeeping while in there

- Bump to 0.4.0; update `mcp/README.md` tool table + host matrix (incl. Cowork ❌).
- If the pending Desktop panel retest (0.3.1 CSP fix) failed, next suspect is the host
  not honouring `frameDomains` at all — verify in the ext-apps reference host
  (`examples/basic-host`, port 3001 serve mode) before touching code again.

---

## 3. Explicitly rejected (do not build)

- **Occlusion-proof auto-segmentation** in the scanner — real fix, wrong cost tier;
  crop params deliver 80% for 5% of the work. Revisit only if crops prove insufficient.
- **Lighting-debug tool** — see table row 7.
- **"Lite scaffold" variant of `init_workspace`** — one agent ignoring the template is
  one data point.
- **Roof-geometry calculator** — cookbook reference page instead.

---

## 4. Validation

Rerun on the prefab photo (`mcp-test` folder pattern), fresh session, **method + tools
together**: user invokes the `reconstruct_from_photo` prompt, tools available, same
minimal user prompt as all prior runs. Pass bar:

1. Tools actually used where they apply (crop-aimed measure, `solve_camera` instead of
   a hand spiral, `compare_images` for evidence, `open_viewer` at delivery).
2. Wall-clock **≤ 60 min** (best prior: 94 min skill / ~51 min pure with worse accuracy).
3. No transform-bug geometry (the MCP-only run shipped floating bargeboards and a roof
   sliver — multi-view checks are the method's job; the run must show them).
4. Scored with `score_render` against the photo; compare against the four existing runs
   on the same subject (their renders are on disk, §0 fixtures).

Log per run, as always: start/end, interventions, which tools fired unprompted.

---

## 5. After this iteration (parked, in order)

1. Skill Batch 3: lean-core restructure + `lib/finish.ts` (waits for these tools).
2. Occlusion-tolerant detection, only if crop params prove insufficient in validation.
3. Phase 3 distribution: npm publish (`npx -y photo-to-threejs-mcp`), `.mcpb` bundle,
   MCP Registry — discovery, not capability; only when testing says the product is ready.
