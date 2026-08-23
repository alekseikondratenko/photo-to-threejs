/**
 * The workspace gate's memory: delta keying and the stop verdict.
 *
 * These are the two rules run 5 paid for in wall-clock — a self-comparing delta
 * that reported zero movement, and a refinement tail that spent ~25 minutes
 * scoring 108 -> 110 -> 110.4 -> 110.4 and stopped only because it hit the pass
 * budget. Both now live in scripts/gate-state.mjs, which is why they are
 * testable at all.
 */
import { GateState } from '../../../skills/photo-to-threejs-building/assets/viewer-template/scripts/gate-state.mjs';

const say = (n, cond, d = '') => console.log(`${n} | ${cond ? 'PASS' : 'FAIL'} | ${d}`);

/** A score object shaped like the real scorer's, with the numbers that matter. */
const mk = (sky, rowEdge, rowsUnreliable = false) => ({
  image_size: [1920, 1080], // diagonal 2203 px -> delivery floor 22.0 px
  mean_edge_error_px: rowEdge,
  skyline: { mean_top_error_px: sky, top_error_by_band: { middle: sky } },
  luma: { bands: { render: { lit_over_shadow_ratio: 1.2 } } },
  unreliable_row_scan: rowsUnreliable || null,
});

// 1. Delta keying: save A, save A again, save B.
{
  const g = new GateState();
  const a1 = g.record('p1.png', mk(200, 200));
  const a2 = g.record('p1.png', mk(200, 200));
  const b = g.record('p2.png', mk(150, 160));
  say('first save has no delta', !a1.delta_vs_previous && !a1.note, JSON.stringify(a1));
  say("identical re-save is named 're-save, unchanged'", /re-save, unchanged/.test(a2.note ?? ''), a2.note ?? 'no note');
  say('re-save does NOT invent a zero delta against itself',
      !a2.delta_vs_previous, JSON.stringify(a2.delta_vs_previous ?? null));
  say('next different render gets the real delta',
      b.delta_vs_previous?.skyline_mean === -50 && b.delta_since === 'p1.png',
      JSON.stringify(b.delta_vs_previous));
}

// 2. A pass that moved is never called stuck.
{
  const g = new GateState();
  g.record('p1.png', mk(200, 200));
  g.record('p2.png', mk(150, 160));
  const third = g.record('p3.png', mk(120, 130));
  say('real progress is not flagged as converged', !third.converged, JSON.stringify(third.converged ?? null));
}

// 3. Stuck AND still bad -> stalled (run 5's actual ending), not converged.
{
  const g = new GateState();
  g.record('p1.png', mk(300, 300));
  g.record('p2.png', mk(299, 299));
  const third = g.record('p3.png', mk(298.5, 298.6));
  say('stuck at a large error -> verdict "stalled"', third.converged?.verdict === 'stalled', third.converged?.verdict ?? 'none');
  say('stalled note sends the agent to worst_segments, not to another tuning pass',
      /worst_segments/.test(third.converged?.note ?? ''), (third.converged?.note ?? '').slice(0, 40));
}

// 4. Stuck AND inside the delivery floor -> converged, go and deliver.
{
  const g = new GateState();
  g.record('p1.png', mk(20, 19));
  g.record('p2.png', mk(19.8, 18.9));
  const third = g.record('p3.png', mk(19.7, 18.85));
  say('stuck at a small error -> verdict "converged"', third.converged?.verdict === 'converged', third.converged?.verdict ?? 'none');
  say('converged note routes to the finish checks',
      /__clearance/.test(third.converged?.note ?? ''), (third.converged?.note ?? '').slice(0, 40));
}

// 5. An unreliable row scan is noise and must not drive the verdict.
{
  const g = new GateState();
  g.record('p1.png', mk(300, 440, true));
  g.record('p2.png', mk(299, 120, true));
  const third = g.record('p3.png', mk(298.5, 441, true));
  say('a wild but unreliable row scan does not block the stop verdict',
      third.converged?.verdict === 'stalled', third.converged?.verdict ?? 'none');
  say('the unreliable row metric is excluded from the verdict',
      third.converged?.row_edge === undefined, JSON.stringify(third.converged ?? {}).slice(0, 60));
}

// 6. A re-save is not a pass: it must not satisfy the two-pass stop test.
{
  const g = new GateState();
  g.record('p1.png', mk(300, 300));
  g.record('p2.png', mk(299, 299));
  const resave = g.record('p2.png', mk(299, 299));
  say('an identical re-save never triggers a stop verdict', !resave.converged,
      JSON.stringify(resave.converged ?? null));
  const real = g.record('p3.png', mk(298.5, 298.6));
  say('the next REAL pass still gets the verdict', real.converged?.verdict === 'stalled',
      real.converged?.verdict ?? 'none');
}
