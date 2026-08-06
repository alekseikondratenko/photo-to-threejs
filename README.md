# photo → three.js

Rebuild a building from **one photograph** as a procedural, measured Three.js model — and
then prove how close it got, in numbers, against the photograph's own pixels.

| Photograph | Reconstruction |
|---|---|
| ![reference](docs/examples/empire-state/reference.jpg) | ![render](docs/examples/empire-state/render-ref.png) |

There is no photogrammetry here and no neural network. An agent reads the photograph,
measures it, writes TypeScript that builds the geometry, renders it, scores the render
against the photograph, and iterates. This repository is the method, the viewer, the seven
models it has produced, and the measurements.

---

## Two ways to use this

| You want | Do this | Needs |
|---|---|---|
| **The method** — apply it yourself, in any agent | Copy [`skill/SKILL.md`](skill/SKILL.md) into `~/.claude/skills/photo-to-threejs-building/`, or just paste it as a prompt | nothing |
| **The tools + the 3D panel** | Add the MCP server to your client (see [`mcp/`](mcp/)) | Node 18+ |

You do **not** need to clone this repository to use either. Cloning is for reading the
models and the viewer.

The two paths are not alternatives so much as nested: the MCP server ships `SKILL.md` as an
MCP prompt, so installing the server brings the method with it.

---

## Examples

Three subjects, chosen because each one broke an assumption the previous one had
established.

| Subject | Reference class | What it proved | Best metric |
|---|---|---|---|
| [**White House**](docs/examples/white-house/) | web photo, low + wide | classical detail must be *geometry*, not texture | **99–100 %** |
| [**Empire State**](docs/examples/empire-state/) | elevated photo | linear pixel→metre works again from elevation | 100 % on `litLuma` |
| [**Taipei 101**](docs/examples/taipei-101/) | ground-level photo | a single linear scale **breaks**; use local ratios | 87 % on `litLuma` |

The full set of seven — adding Residential Tower AM271, 20 Fenchurch St, a bolted hydraulic
cylinder, and a villa facade — is in the viewer.

### The differentiator: what did it make up?

Every single-photograph reconstruction invents the surfaces the camera never saw. Almost
nobody shows you which ones. Hit **Rear** in the viewer, or look at the
[White House rear elevation](docs/examples/white-house/#what-the-model-made-up): that
geometry is a mirror-and-plausibility construction, and saying so is the point.

---

## Run the viewer

```bash
cd viewer && npm install && npm run dev
```

Then open <http://localhost:5200>. Seven models, five camera views each, wireframe and
site-context toggles, and `window.__measure()` in the console to score the live canvas
against the stored targets.

> Port 5200, not 5173 — on at least one machine a Docker container binds 5173 on IPv6 and
> macOS resolves `localhost` there first, silently shadowing the dev server.

---

## How the scoring works

`window.__measure()` reads pixels back off the WebGL canvas (which is why the renderer sets
`preserveDrawingBuffer: true`) and computes the same statistics that were scanned from the
reference photograph: luminance of the lit and shadow bands, their ratio, the silhouette
width fraction, and per-subject geometry checks such as window-bay pitch in pixels.

Two things make the numbers trustworthy, and both are easy to get wrong:

- **Compare at the reference's own aspect ratio.** Resize the viewport to match the
  photograph's before scoring, or the framing — and therefore every band the harness
  scans — is different.
- **Report the metrics that are not degenerate.** `widthFrac` saturates at 0.700 for
  subjects wider than the harness's 0.20W–0.90W scan window, which produces a *false*
  100 % match. The White House page shows exactly this trap and what to quote instead.

The 19 failure modes that each cost a full review cycle are listed in
[`skill/SKILL.md`](skill/SKILL.md).

---

## Provenance

The first reconstruction (Residential Tower AM271) was run on the
[img2threejs](https://github.com/img2threejs/img2threejs) process harness, Apache-2.0. It
would be easy to overstate or understate what came from it, so precisely:

**Reused as code:** one function — `build_detail_inventory.load_image`, a standard-library
PNG decoder — used throughout.

**Used for AM271 only:** their spec/gating step and PBR extraction.

**Their most valuable contribution was not code.** It was an *honesty discipline*: state
plainly when output is approximate, and infer unseen faces by mirroring rather than faking
confidence. That is why every model file in this repository carries a header saying which
of its surfaces were observed and which were invented, and it is the direct ancestor of the
"what did it make up?" idea above.

**What is original here:** the viewer, the geometry library, the measurement harness, the
scoring loop, the MCP server, and all seven models. Their review loop was an agent
eyeballing a comparison sheet; this replaced it with deterministic numeric scoring, which
is what makes the tables above possible.

---

## Licence

**Apache-2.0** ([`LICENSE`](LICENSE)) for all code and all 3D models — use it freely,
commercially included; keep the notice and state your changes. Attribution to img2threejs
is in [`NOTICE`](NOTICE), as their licence requires.

**Reference photographs are licensed separately and are not covered by the above.** Two
are included (one CC BY 4.0, one CC BY-SA 3.0); five are deliberately excluded because
their redistribution terms could not be established. The models built from them are
unaffected — depicting a building is not the same as redistributing a photograph of it.

Full position, per image, with the reasoning: [`docs/LICENSING.md`](docs/LICENSING.md).
