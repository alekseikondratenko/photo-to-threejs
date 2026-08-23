/**
 * The gate's memory: what the previous passes scored, what moved since, and
 * whether the geometry has stopped moving at all.
 *
 * It lives in its own module (rather than inside vite.config) because two of
 * its rules were paid for in field time and now have regression tests:
 *
 *  1. DELTA KEYING. The first version keyed previous scores by a digit-stripped
 *     name ("p3-tune.png" -> "p#-tune.png"), so a legitimate re-save of the same
 *     render — manual POST plus the render trigger, which happens routinely —
 *     compared a pass against ITSELF and reported a delta of all zeros. Two
 *     field passes read "no movement" when the pass had in fact moved. Keying is
 *     now by exact filename, an identical re-save is named as such, and the
 *     delta always comes from the most recent DIFFERENT render.
 *
 *  2. CONVERGENCE. Run 5 spent its last four passes (~25 minutes) scoring
 *     108 -> 110 -> 110.4 -> 110.4 and stopped at exactly the soft budget of 12,
 *     which means the BUDGET stopped it, not the plateau rule — that rule lived
 *     in skill prose, and prose rules have decayed in every run measured so far.
 *     The gate already computes the deltas, so the gate now says the word: when
 *     no geometry metric has moved more than 0.5% of the image diagonal across
 *     the last two passes, the save response says the geometry is converged and
 *     what to do instead.
 */

/** The metrics a pass is judged on. Geometry first — those are the stop signal. */
const GEOMETRY = ['skyline_mean', 'row_edge_mean'];

function pick(o) {
  return {
    skyline_mean: o?.skyline?.mean_top_error_px,
    skyline_middle: o?.skyline?.top_error_by_band?.middle,
    row_edge_mean: o?.mean_edge_error_px,
    lit_shadow_ratio: o?.luma?.bands?.render?.lit_over_shadow_ratio,
  };
}

/** What moved since the previous pass — so nobody re-opens old score files. */
export function deltaOf(prev, now) {
  const a = pick(prev), b = pick(now);
  const out = {};
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'number' && typeof b[k] === 'number') {
      out[k] = Math.round((b[k] - a[k]) * 100) / 100;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Numerically identical on every tracked metric — i.e. the same render again. */
export function identicalScores(prev, now) {
  const a = pick(prev), b = pick(now);
  const keys = Object.keys(a).filter((k) => typeof a[k] === 'number' || typeof b[k] === 'number');
  return keys.length > 0 && keys.every((k) => a[k] === b[k]);
}

function diagonalOf(score) {
  const s = score?.image_size;
  return Array.isArray(s) && s.length === 2 ? Math.hypot(s[0], s[1]) : null;
}

export class GateState {
  constructor() {
    /** @type {{name: string, score: any, delta: any, since: string|null}[]} */
    this.history = [];
  }

  /**
   * Record a scored save. Returns the extra blocks the save response carries:
   * the delta (against the most recent DIFFERENT render), a note when this was
   * an unchanged re-save, and the converged verdict when the geometry has
   * stopped moving.
   */
  record(name, score) {
    const back = [...this.history].reverse();
    const prevSame = back.find((e) => e.name === name);
    const prevDiff = back.find((e) => e.name !== name);

    const unchanged = prevSame ? identicalScores(prevSame.score, score) : false;
    const delta = prevDiff ? deltaOf(prevDiff.score, score) : null;
    // A re-save is not a pass. It must never count toward the two-pass
    // convergence test, or one real pass gets counted twice and the gate calls
    // a stop that nothing earned.
    const entry = { name, score, delta, since: prevDiff ? prevDiff.name : null, resave: unchanged };

    const converged = this.#convergence(entry);
    this.history.push(entry);

    return {
      ...(delta ? { delta_vs_previous: delta, delta_since: entry.since } : {}),
      ...(unchanged
        ? { note: `re-save, unchanged — identical numbers to the previous save of '${name}'. This is not a pass; nothing moved because nothing was re-rendered.` }
        : {}),
      ...(converged ? { converged } : {}),
    };
  }

  /**
   * Has the geometry stopped moving?
   *
   * A pure "delta < 0.5% of the diagonal" test — the skill's written rule — is
   * wrong as a stop signal: on a 2200 px diagonal that is an 11 px threshold, so
   * two honest 8 px improvements against a 150 px error would be declared
   * converged while the render was still visibly wrong. What actually matters is
   * whether a pass BUYS anything, which is relative: a metric that moves less
   * than 3% of its own value, twice running, is not being improved by the kind
   * of pass being taken.
   *
   * The distinction the verdict then draws is the one that matters to the run:
   *   - small error + not moving  -> CONVERGED, go to delivery;
   *   - large error + not moving  -> STALLED, and repeating the pass will not
   *     fix it. Run 5's last four passes were the second case and were treated
   *     as the first, which is exactly how ~25 minutes were spent scoring
   *     108 -> 110 -> 110.4 -> 110.4.
   */
  #convergence(entry) {
    if (entry.resave) return null;
    const prev = [...this.history].reverse().find((e) => e.delta && !e.resave);
    if (!entry.delta || !prev || !prev.delta) return null;
    const diag = diagonalOf(entry.score);
    if (!diag) return null;

    const now = pick(entry.score), before = pick(prev.score);
    // A row scan that compared too few rows is noise, not a metric — never let
    // it decide a stop, in either direction.
    const rowsUnreliable = Boolean(entry.score?.unreliable_row_scan);
    const evaluable = GEOMETRY.filter(
      (k) =>
        typeof entry.delta[k] === 'number' &&
        typeof prev.delta[k] === 'number' &&
        typeof now[k] === 'number' &&
        !(rowsUnreliable && k === 'row_edge_mean'),
    );
    if (!evaluable.length) return null;

    const rel = (d, v) => Math.abs(d) / Math.max(1, Math.abs(v));
    const stuck = evaluable.filter(
      (k) => rel(entry.delta[k], now[k]) < 0.03 && rel(prev.delta[k], before[k]) < 0.03,
    );
    if (stuck.length !== evaluable.length) return null;

    // "Good enough to deliver" is an absolute question: 1% of the image
    // diagonal of top-edge error is a render that reads as the same building.
    const goodFloor = Math.round(diag * 0.01 * 10) / 10;
    const worst = Math.max(...evaluable.map((k) => Math.abs(now[k])));
    const detail = evaluable
      .map((k) => `${k} ${Math.round(now[k] * 10) / 10} px (moved ${Math.abs(prev.delta[k])} then ${Math.abs(entry.delta[k])})`)
      .join('; ');

    const out = {};
    for (const k of evaluable) out[k === 'skyline_mean' ? 'skyline' : 'row_edge'] = true;
    out.moved_last_two_passes = false;
    if (worst <= goodFloor) {
      out.verdict = 'converged';
      out.note =
        `CONVERGED: ${detail}. Two passes running, nothing moved by even 3% — and the error ` +
        `is inside the ${goodFloor} px delivery floor (1% of the image diagonal). Further ` +
        'geometry passes are waste. Move to the finish checks (__clearance(), the extra ' +
        'views, identity features by eye) and to delivery.';
    } else {
      out.verdict = 'stalled';
      out.note =
        `STALLED: ${detail}. Two passes running, nothing moved by even 3%, and the error is ` +
        `still above the ${goodFloor} px delivery floor. Repeating this KIND of pass will not ` +
        'close it — a residual that survives two tuning passes is structural, not a ' +
        'parameter. Read skyline.worst_segments: an element is missing, misplaced or the ' +
        'wrong shape in those columns. Re-measure that element (unproject, view_crop) ' +
        'instead of re-tuning numbers, or accept the number and go to delivery. Do NOT ' +
        'take another pass of the same kind without writing in RECON.md what you expect ' +
        'to move and by how much.';
    }
    return out;
  }
}
