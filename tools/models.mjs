// "Which AI is best at open math?": groups accepted results by the self-reported model and tool.
// Model names are kept exactly as reported and also mapped to a family for the summary.

const FAMILIES = [
  [/claude|opus|sonnet|haiku|fable|anthropic/i, "Anthropic"],
  [/gemini|gemma|google|bard/i, "Google"],
  [/\bgpt|\bo[1-9]\b|codex|openai|chatgpt/i, "OpenAI"],
  [/deepseek/i, "DeepSeek"],
  [/qwen|alibaba/i, "Alibaba (Qwen)"],
  [/llama|meta/i, "Meta"],
  [/mistral|codestral|magistral/i, "Mistral"],
  [/grok|xai/i, "xAI"],
  [/kimi|moonshot/i, "Moonshot (Kimi)"],
  [/glm|zhipu|chatglm/i, "Zhipu (GLM)"],
  [/minimax/i, "MiniMax"],
];
export function modelFamily(model) {
  if (!model || !String(model).trim()) return "Not reported";
  for (const [re, fam] of FAMILIES) if (re.test(model)) return fam;
  return "Other";
}
const TOOLS = [
  [/claude[\s_-]*code/i, "Claude Code"], [/codex/i, "Codex CLI"], [/antigravity/i, "Antigravity"], [/cursor/i, "Cursor"],
  [/gemini[\s_-]*cli/i, "Gemini CLI"], [/^\s*pi\s*$/i, "pi"], [/aider/i, "Aider"], [/cline/i, "Cline"], [/copilot/i, "GitHub Copilot"],
];
export function toolName(tool) {
  if (!tool || !String(tool).trim()) return "Not reported";
  for (const [re, name] of TOOLS) if (re.test(tool)) return name;
  return String(tool).trim();
}

/** Rows per (exact model, tool) from score events (bonuses excluded), sorted by points. */
export function modelRows(events) {
  const rows = new Map();
  for (const e of events) {
    if (!["proof", "refutation", "split", "note"].includes(e.kind)) continue;
    const model = String(e.model || "").trim() || "Not reported", tool = toolName(e.tool);
    const key = `${model.toLowerCase()}|${tool.toLowerCase()}`;
    const r = rows.get(key) || { model, tool, family: modelFamily(e.model), points: 0, notes: 0, splits: 0, proofs: 0, refutations: 0, who: new Set(), first: e.date };
    r.points = Math.round((r.points + e.points) * 10) / 10;
    r[{ note: "notes", split: "splits", proof: "proofs", refutation: "refutations" }[e.kind]] += 1;
    r.who.add(String(e.who).toLowerCase());
    if (e.date && e.date < r.first) r.first = e.date;
    rows.set(key, r);
  }
  return [...rows.values()].map((r) => ({ ...r, contributors: r.who.size, results: r.notes + r.splits + r.proofs + r.refutations, who: undefined }))
    .sort((a, b) => b.points - a.points || b.results - a.results || (a.model < b.model ? -1 : 1));
}
/** Points per family, for the summary bar. */
export function familyTotals(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.family, Math.round(((m.get(r.family) || 0) + r.points) * 10) / 10);
  return [...m].map(([family, points]) => ({ family, points })).sort((a, b) => b.points - a.points);
}
