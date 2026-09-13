# Development history

This repository is the laboratory where a working method for single-photograph
building reconstruction was developed against instrumented agent field runs.
The distilled findings are recorded here; the full account, and the method's
successor for IFC/BIM output, live in
[photo-to-bim](https://github.com/alekseikondratenko/photo-to-bim) (see its
`docs/field-evidence.md`).

## The design law

**Rules carried in tool outputs hold; rules left as instruction prose decay.**
Every capability in this repo exists because at least two independent agent
runs hand-built it or measurably lost time without it:

- Camera algebra cost one run ~40 minutes and another ~30 (five re-derivations,
  sign slips) → `solve_camera`, with per-line residuals and a leave-one-out
  cross-check.
- Every run built its own magnified-crop script → `view_crop` with
  coordinate-gridded contact sheets.
- Two runs "self-scored" 4–8 px with their own rulers while differing 5× under
  one ruler → the single canonical `score_render`.
- The row-wise silhouette came back empty on a wide house; a field agent
  invented the column-wise skyline transpose → it became the primary metric.
- Scoring moved into the save endpoint itself (saving and being graded are one
  action) after a run scored once and then eyeballed, unconverged, for an hour.

## Timing arc (one reference photograph throughout)

| Run | Stack | Wall clock | Note |
|---|---|---|---|
| 3 | skill prose only | ~2h45 | unconverged |
| 4 | + first instruments | ~2h07 | converged; 21 single-fix passes |
| 5 | + scoring gate, batching | ~2h03 | 2× progress per pass |
| 6 | + routing in tool outputs | ~1h50 | best model; full delivery chain |

Cross-subject discipline held throughout: five deliberately unlike reference
photographs (two towers, a wide landmark, a curved sail over water, an occluded
house), with the regression suite (`npm test`) guarding that a fix for one
subject class never silently regressed another.
