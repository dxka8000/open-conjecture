// Points, in one place. The constants live in site/config.json under "scoring"; this module turns the
// records on main into leaderboard rows. Only merged results count, so rejected or reverted work scores 0.
//
//   accepted split            (split_base + split_per_step * steps) * weight(parent)
//   proof of a step           step_proof * weight(step)
//   proof of an open problem  problem_proof   (summits and open problems)
//   refutation                the same as a proof of that statement
//   bonus                     split_bonus per step of your split that someone later proves
//   research note             note_points * weight(record)
//   citation bonus            note_bonus to a note's author each time a later accepted note or split by someone
//                             else cites it (links its permalink, .../notes/<record>/<file>.html, or the .md source)
//   library problems          a research note on one of the library's open problems scores as on an open problem
//   weight                    1 for open problems and library problems; a step has its parent's weight * step_weight_factor,
//                             never below min_weight
//
// Every event carries the rule that produced it (rule_en, rule_zh) and the record it is about (record), so
// every point on the site can be traced back to one award.

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
/** A weight as people read it: 1.0, 0.6, 0.36. */
export const fmtWeight = (w) => (Number.isInteger(w) ? w.toFixed(1) : String(Math.round(w * 100) / 100));

/** Note keys ("<record>/<file stem>") cited in a text: any https link ending in notes/<record>/<stem>.html or .md. */
export function citedNotes(text) {
  const out = new Set();
  const re = /https:\/\/[^\s)\]>"']*?\/notes\/([a-z0-9-]{1,60})\/([A-Za-z0-9-]{1,39}-[a-z0-9-]{1,60})\.(?:html|md)\b/g;
  for (const m of String(text || "").matchAll(re)) out.add(`${m[1]}/${m[2]}`);
  return out;
}
export const noteKey = (n) => `${n.record}/${String(n.file || String(n.path || "").split("/").pop() || "").replace(/\.md$/, "")}`;

/** Every scoring event: {who, kind: "proof"|"refutation"|"split"|"bonus"|"note", points, date, id, record, rule_en, rule_zh}. */
export function scoreEvents(records, S, notes = [], library = new Map()) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out = [];
  for (const r of records) {
    if (r.status !== "verified" && r.status !== "refuted") continue;
    const step = r.kind === "step", w = step ? weightOf(r, byId, S) : 1;
    const pts = step ? S.step_proof * w : S.problem_proof;
    const ref = r.status === "refuted";
    const base_en = step ? `step proof: ${S.step_proof} × weight ${fmtWeight(w)}` : `open-problem proof: ${S.problem_proof}`;
    const base_zh = step ? `证明步骤：${S.step_proof} × 权重 ${fmtWeight(w)}` : `证明未解决问题：${S.problem_proof}`;
    out.push({ who: r.proved_by, kind: ref ? "refutation" : "proof", points: round1(pts), date: r.verified_at, id: r.id, record: r.id, model: r.model || "", tool: r.tool || "",
      rule_en: ref ? `refutation, scored as a ${base_en}` : base_en, rule_zh: ref ? `推翻，按${base_zh}计` : base_zh });
    if (r.status === "verified" && step && r.proposed_by)
      out.push({ who: r.proposed_by, kind: "bonus", sub: "split-step", points: S.split_bonus, date: r.verified_at, id: r.id, record: r.id, by: r.proved_by,
        rule_en: `split bonus: a step of your split was proven by @${r.proved_by}, +${S.split_bonus}`,
        rule_zh: `拆分奖励：你拆出的步骤被 @${r.proved_by} 证明，+${S.split_bonus}` });
  }
  const splits = new Map();
  for (const r of records) {
    if (r.kind !== "step" || !r.split || !r.proposed_by) continue;
    const g = splits.get(r.split) || { name: r.split, who: r.proposed_by, parent: r.parent, steps: 0, date: r.proposed_at, model: r.proposed_model || "", tool: r.proposed_tool || "", sketch: "" };
    g.steps += 1;
    g.sketch += `\n${r.sketch || ""}`;
    if (r.proposed_at && (!g.date || r.proposed_at < g.date)) g.date = r.proposed_at;
    splits.set(r.split, g);
  }
  for (const g of splits.values()) {
    const w = weightOf(byId.get(g.parent), byId, S);
    const pts = (S.split_base + S.split_per_step * g.steps) * w;
    out.push({ who: g.who, kind: "split", points: round1(pts), date: g.date, id: g.name, record: g.parent, model: g.model, tool: g.tool,
      rule_en: `split: (${S.split_base} + ${S.split_per_step} × ${g.steps} ${g.steps === 1 ? "step" : "steps"}) × weight ${fmtWeight(w)}`,
      rule_zh: `拆分：(${S.split_base} + ${S.split_per_step} × ${g.steps} 个步骤) × 权重 ${fmtWeight(w)}` });
  }
  const known = new Map();
  // A note on a library problem (library: Map of notes folder -> entry) scores like one on an open problem: weight 1.
  const target = (id) => byId.has(id) || library.has(id);
  for (const n of notes) {
    const r = byId.get(n.record);
    if (!r && !library.has(n.record)) continue;
    known.set(noteKey(n), n);
    const w = r ? weightOf(r, byId, S) : 1;
    out.push({ who: n.who, kind: "note", points: round1(S.note_points * w), date: n.date, id: n.record, record: n.record, path: n.path, model: n.model || "", tool: n.tool || "",
      rule_en: `research note: ${S.note_points} × weight ${fmtWeight(w)}`, rule_zh: `研究笔记：${S.note_points} × 权重 ${fmtWeight(w)}` });
  }
  // Citation bonus: a later accepted note or split by someone else that links a note's permalink.
  const citers = [
    ...notes.filter((n) => target(n.record)).map((n) => ({ who: n.who, date: n.date, kind: "note", self: noteKey(n), ref: n.path, text: n.text || "" })),
    ...[...splits.values()].map((g) => ({ who: g.who, date: g.date, kind: "split", self: "", ref: g.name, text: g.sketch })),
  ];
  for (const c of citers) {
    for (const key of citedNotes(c.text)) {
      const n = known.get(key);
      if (!n || key === c.self || String(n.who).toLowerCase() === String(c.who).toLowerCase() || !c.date || c.date < n.date) continue;
      out.push({ who: n.who, kind: "bonus", sub: "cited", points: S.note_bonus, date: c.date, id: n.record, record: n.record, path: n.path, by: c.who, by_kind: c.kind, by_ref: c.ref,
        rule_en: `citation bonus: your note was cited by @${c.who}'s ${c.kind === "note" ? "research note" : "split"}, +${S.note_bonus}`,
        rule_zh: `引用奖励：你的笔记被 @${c.who} 的${c.kind === "note" ? "研究笔记" : "拆分"}引用，+${S.note_bonus}` });
    }
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
