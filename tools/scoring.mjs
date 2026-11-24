// Points, in one place. The constants live in site/config.json under "scoring"; this module turns the
// records on main into leaderboard rows. Only merged results count, so rejected or reverted work scores 0.
//
//   accepted split            (split_base + split_per_step * steps) * weight(parent)
//   proof of a step           step_proof * weight(step)
//   proof of an open problem  problem_proof   (summits and open problems)
//   refutation                the same as a proof of that statement
//   bonus                     split_bonus per step of your split that someone later proves
//   research note             note_points * weight(record); note_bonus once the record is later split (by anyone)
//   weight                    1 for open problems; a step has its parent's weight * step_weight_factor,
//                             never below min_weight

export const DEFAULT_SCORING = {
  split_base: 30,
  split_per_step: 10,
  step_proof: 20,
  problem_proof: 1000,
  split_bonus: 5,
  note_points: 10,
  note_bonus: 5,
  step_weight_factor: 0.6,
  min_weight: 0.1,
};

export function scoringConfig(cfg) {
  const S = { ...DEFAULT_SCORING };
  const given = cfg && typeof cfg.scoring === "object" && cfg.scoring ? cfg.scoring : {};
  for (const k of Object.keys(S)) if (Number.isFinite(given[k]) && given[k] >= 0) S[k] = given[k];
  return S;
}

export function weightOf(r, byId, S, depth = 0) {
  if (!r || r.kind !== "step" || depth > 50) return 1;
  return Math.max(S.min_weight, weightOf(byId.get(r.parent), byId, S, depth + 1) * S.step_weight_factor);
}

const round1 = (x) => Math.round(x * 10) / 10;

/** Every scoring event: {who, kind: "proof"|"refutation"|"split"|"bonus"|"note", points, date, id}. */
export function scoreEvents(records, S, notes = []) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out = [];
  for (const r of records) {
    if (r.status !== "verified" && r.status !== "refuted") continue;
    const pts = r.kind === "step" ? S.step_proof * weightOf(r, byId, S) : S.problem_proof;
    out.push({ who: r.proved_by, kind: r.status === "verified" ? "proof" : "refutation", points: round1(pts), date: r.verified_at, id: r.id });
    if (r.status === "verified" && r.kind === "step" && r.proposed_by)
      out.push({ who: r.proposed_by, kind: "bonus", points: S.split_bonus, date: r.verified_at, id: r.id });
  }
  const splits = new Map();
  for (const r of records) {
    if (r.kind !== "step" || !r.split || !r.proposed_by) continue;
    const g = splits.get(r.split) || { who: r.proposed_by, parent: r.parent, steps: 0, date: r.proposed_at };
    g.steps += 1;
    if (r.proposed_at && (!g.date || r.proposed_at < g.date)) g.date = r.proposed_at;
    splits.set(r.split, g);
  }
  for (const [name, g] of splits) {
    const pts = (S.split_base + S.split_per_step * g.steps) * weightOf(byId.get(g.parent), byId, S);
    out.push({ who: g.who, kind: "split", points: round1(pts), date: g.date, id: name });
  }
  for (const n of notes) {
    const r = byId.get(n.record);
    if (!r) continue;
    out.push({ who: n.who, kind: "note", points: round1(S.note_points * weightOf(r, byId, S)), date: n.date, id: n.record, path: n.path });
    const later = [...splits.values()].find((g) => g.parent === n.record && g.date && g.date >= n.date);
    if (later) out.push({ who: n.who, kind: "bonus", points: S.note_bonus, date: later.date, id: n.record, path: n.path });
  }
  return out;
}

/** Leaderboard rows from events, optionally only events dated on or after `since` (YYYY-MM-DD). */
export function leaderboardRows(events, since = "") {
  const rows = new Map();
  for (const e of events) {
    if (since && !(e.date >= since)) continue;
    const key = String(e.who).toLowerCase();
    const row = rows.get(key) || { who: e.who, proofs: 0, splits: 0, refutations: 0, notes: 0, points: 0 };
    if (e.kind === "proof") row.proofs += 1;
    if (e.kind === "split") row.splits += 1;
    if (e.kind === "refutation") row.refutations += 1;
    if (e.kind === "note") row.notes += 1;
    row.points = round1(row.points + e.points);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
}
