# Viewer workspace template

The engine the skill builds against, as a self-contained scaffold: copy this
directory to a workspace, `npm install`, add a model, `npm run dev`.

```
index.html          HUD shell (model buttons, view buttons, reference panel)
src/main.ts         renderer + registry — add your subjects to MODELS
src/lib/geometry.ts path/sweep/loft/cap/merge helpers, bug notes at call sites
src/lib/measure.ts  window.__measure() scoring harness (needs preserveDrawingBuffer)
src/lib/types.ts    the BuildingModel contract a subject must satisfy
```

A subject is two files, per the contract in `lib/types.ts`:

- `src/models/<id>.ts` — the geometry factory (see SKILL.md Step 3)
- `src/scenes/<id>.ts` — camera views, light rig, measured targets (Step 2/4)

**Canonical source:** the `viewer/` directory of the
[photo-to-threejs](https://github.com/alekseikondratenko/photo-to-threejs) repo,
which also contains three worked example subjects to read. These lib files are
a copy for offline/skill-only installs — if you have the repo, prefer it, and
if you improve `lib/`, improve it there.
