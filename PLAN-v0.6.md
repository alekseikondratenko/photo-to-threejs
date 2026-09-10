# Plan — v0.6: the IFC target (photo-to-bim)

**Written:** 2026-09-10, after the two Blender baseline runs · **Status:** awaiting approval
**Prior:** v0.5.2 (`ac2183e`) + PLAN-v0.5.3 (approved in principle, folded in here as Part D)

## Evidence this plan is built on

| Run | Agent | Setup | Time | Result |
|---|---|---|---|---|
| blender-test-1 | Claude | Blender MCP + Bonsai; our instruments visible globally | ~40 min | Valid IFC4; agent **voluntarily discovered and adopted** solve_camera, trace_edge ×5, view_crop, compare_images mid-run and re-authored the IFC with corrected dimensions |
| blender-test-2 | Codex | Blender MCP only — true naive baseline | 16m38s | Valid IFC4, schema-validated, richly decorated (781 scene objects), **zero measurement** — every dimension a typed guess |

Three conclusions. (1) Photo→IFC works mechanically, fast. (2) Modelling ability is a
commodity — both agents authored real IFC through ifcopenshell.api unprompted; the value
we add is FIDELITY: measured dimensions, a solved camera, pixel-scored convergence,
evidence. (3) The instruments get adopted on merit when present — the routing law holds
across a build target we never designed for.

## Part A — Repo: one repo, renamed, nothing lost

- Rename the GitHub repo **photo-to-threejs → photo-to-bim** (GitHub preserves
  redirects; history, evidence chain, and test suite stay).
- Two skills, side by side, one shared MCP server:
  - `skills/photo-to-ifc-building/` — **the flagship** (Blender + Bonsai, IFC deliverable)
  - `skills/photo-to-threejs-building/` — kept whole, repositioned as the web target
- **Nothing is deleted or rewritten in the existing skill.** Inventory of what is
  already generic and therefore SHARED by reference, not duplicated:
  - Steps 1–2.9 (classify, measure, solve, the measurement boundary) — no Three.js in them
  - The loop grammar, stop rules, RECON ledger, context budget (~2 passes — the
    781-object run is the new cautionary tale for exactly this rule)
  - The two shape classes (extruded/swept + stacked/lofted) — these are what keep the
    IFC helpers tower-safe
  - references/roof-geometry.md, scale-anchors.md — pure geometry, moved to a shared
    `references/` both skills cite
  - The regression suite and all five photos
  - Three.js-specific assets (viewer-template, lib/, bug-checklist items 9/27 etc.)
    stay in the threejs skill, untouched.
- README leads with the IFC story; the web viewer becomes "the presentation target".

## Part B — MCP server changes (shared core)

### B1. `camera_for_blender` in every solve result
Alongside `camera_for_unproject` and the Three.js block: `lens_mm`, `sensor_width_mm`
(fixed 36), `shift_x/shift_y` from the principal-point offset (Blender's NATIVE lens
shift — our shifted-lens branch maps cleaner here than to Three.js), position/rotation
convention, and a paste-ready `bpy` snippet. Claude's Blender run spent ~10 min hand-
deriving this; Codex never tried (and its camera never matched the photo).

### B2. Server profiles — stop wrong-target tool calls structurally
`--profile web|ifc|all` (default `all`). Profile `ifc` hides the web-target tools
(`init_workspace`, `open_viewer`); profile `web` hides nothing (unproject etc. are
universal). Each plugin registers the server with its own profile, so an IFC session
never SEES a Three.js tool. Tool descriptions also name their target as backup.

### B3. Render engines stay native — explicit, not incidental
The web target renders in the browser; the IFC target renders in Blender (Eevee).
The SHARED piece is the ruler: `score_render`/`compare_images` on exact-size PNGs.
No cross-target render dependency, documented in the README as an architecture rule.

## Part C — The IFC skill (`photo-to-ifc-building`)

Method sections identical to the proven skill (by shared reference). New content only
where the target differs:

### C1. Build phase, Codex-informed
- **Introspect before authoring**: one `execute_blender_code` call running `inspect`
  over the `ifcopenshell.api` modules to learn signatures, THEN one script per phase.
  (Claude's Three.js runs debugged API guesses for 30 minutes; Codex learned the API
  in 2 calls and wrote a first-time-correct 13 KB script.)
- **One script per phase, executed whole**: build → detail → refine → finish. Four big
  executions, not forty snippets.
- `assets/blender-template/`:
  - `photostudio.py` — builds PhotoCam from `camera_for_blender`, sets exact reference
    resolution, neutral world + sun, and `render_and_score(name)`: renders AND invokes
    the scorer in one action (the gate's law, no dev server needed).
  - `ifc_helpers.py` — GENERAL-SHAPE wrappers mirroring the two shape classes:
    `spatial(project→site→building→storeys)`, `massing(footprint_polygon, storey_heights)`,
    `roof(planes)` (a gable is two planes; a tower cap is none), `setback(level, inset)`,
    `opening(wall, x, sill, w, h)`, `opening_grid(face, rows, cols)` (tower fenestration).
    NOTHING house-shaped: no "gable_roof", no assumptions of 2 storeys.
- **Context rule, verbatim + sharpened**: context is massing only, ~2 passes. Trees are
  cones, terrace is a slab, NO per-tile roofs (blender-test-2: 781 objects of garnish,
  zero fidelity gained). Decoration lives in Blender-only objects, never exported.

### C2. The IFC delivery gate (Codex's best idea, made mandatory)
Before delivery, in one script:
1. `ifcopenshell.validate` — schema clean;
2. every element opened through the IFC geometry engine — all parse;
3. **entity census** printed and checked: walls/roofs/slabs/windows/doors counted,
   `IfcBuildingElementProxy` count must be ~0 (garnish must not masquerade as BIM);
4. spatial containment: no element outside a storey;
5. our pixel gate unchanged: final render from PhotoCam scored against the photograph.
Plus README.md manifest in the folder (deliverables, storey table, entity census).

### C3. Time target
Codex's 16m38s is the anchor for the UNMEASURED pipeline. Our bar for the measured
one: **≤45 min** to a scored, validated IFC (measurement floor ~10–12 min is the price
of fidelity — the pitch is "Codex-class speed, evidence-class output"). Stretch: 35.

## Part D — 0.5.3 fixes ride along (shared core, both targets benefit)
Unchanged from PLAN-v0.5.3: unconditional unproject routing (3rd consecutive run
hand-rolled projection math), variant-aware delta keying, auto-derived span,
worst_segments floor fix, geometric vertical-family detection, `__gaps()` for the web
target (the IFC target gets C2 instead — same class of check, format-native).

## Part E — Validation protocol
1. Run 7 (house, IFC skill, mcp-test-7 style folder): ≤45 min, unproject called ≥3×,
   camera_for_blender pasted not derived, IFC gate green, census clean, scored render.
2. **Tower run immediately after** (Taipei or Empire State photo, same skill): the
   helpers' general-shape test — storey stack, setbacks, opening grids. A house-shaped
   helper fails here loudly. THIS IS THE ANTI-OVERFIT GATE; nothing ships without it.
3. Web-target regression: `npm test` all green (54 checks), one Three.js smoke run to
   confirm the renamed repo + profiles broke nothing.

---

## Execution note (2026-09-10)

Part A was executed in the NEW-REPO shape after reconsideration: a clean public
repo beats a renamed mixed-history one for a single-story product. Shipped as
https://github.com/alekseikondratenko/photo-to-bim (0.6.0): instruments +
profiles + camera_for_blender + unconditional routing + geometric vertical
detection + worst_segments floor fix in the shared server; the
photo-to-ifc-building skill with general-shape ifc_helpers (headless-tested,
house AND tower cases) and photostudio (scorer parity verified against run-6
renders); IFC delivery gate; 46-check suite. This repo is frozen as the
Three.js laboratory and field archive — README banner added.
