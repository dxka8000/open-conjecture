// A deterministic stand-in for the scheduled AI review of research notes, used only by the simulation.
// The real review is a language model following open-problems-arena/review-task-prompt.md: for each Claim it finds
// the exact supporting sentence in the source, and otherwise answers CANNOT_VERIFY and rejects. This stub does the
// same against a tiny table of sources whose wording was checked by hand. It is NOT the real reviewer: passing the
// simulation shows that the gate lets these near misses through and that a review-rejected verdict keeps them out of
// main. Whether the real model catches them has to be tested by running the real review on these cases.
import { noteCitations } from "../checker/notes.mjs";

// Checked against the sources on 2026-11-24.
export const REVIEW_SOURCES = [
  {
    links: ["arxiv.org/abs/math/0205002", "doi.org/10.4064/aa109-3-4"],
    name: "Krasikov and Lagarias (2003)",
    // Abstract and section 2: the x^0.84 lower bound for the integers below x whose forward orbit contains 1
    // (more generally a fixed a not divisible by 3) holds "for all sufficiently large x"; proved in section 6.
    key: /0\.84/,
    needs_large_x: true,
    density: "zero", // x^0.84 integers up to x: density zero
  },
  {
    links: ["arxiv.org/abs/2507.06875"],
    name: "Shamazov and Talambutsa (2025)",
    // Abstract: in general the orbit set of a semigroup of integer affine maps has at least x / log^((n-1)/2) x elements
    // up to x; in the exact covering case this improves to a constant times x, "so the set has positive density".
    key: /positive density|\bc ?\* ?x\b|Ω\(x\)|Omega\(x\)/i,
    needs_large_x: false,
    density: "positive",
  },
];

const LARGE_X = /sufficiently large|large enough|for (all )?large x|x ?(≥|>=) ?x_?0|x → ∞|x -> ?inf/i;
const FULL = /\b(almost all|almost every|density (1|one)|full density|asymptotic density 1|natural density 1)\b/i;

/** {verdict: "review-ok" | "review-rejected", reasons: [...]} for the note text. */
export function stubReview(text) {
  const known = (/## Known results\n([\s\S]*?)\n## /.exec(text) || [, ""])[1];
  const reasons = [];
  for (const c of noteCitations(known)) {
    const src = REVIEW_SOURCES.find((s) => s.links.some((l) => c.line.includes(`https://${l}`)));
    for (const claim of c.claims) {
      if (!src) { reasons.push(`CANNOT_VERIFY: no supporting sentence found for "${claim.slice(0, 60)}"`); continue; }
      if (!src.key.test(claim)) reasons.push(`CANNOT_VERIFY: ${src.name} has no sentence supporting "${claim.slice(0, 60)}"`);
      if (src.needs_large_x && !LARGE_X.test(claim)) reasons.push(`${src.name}: the source proves this only for all sufficiently large x; the Claim drops that hypothesis`);
      if (src.density !== "full" && FULL.test(claim)) reasons.push(`${src.name}: the source proves ${src.density} density, not almost all / density 1`);
    }
  }
  return { verdict: reasons.length ? "review-rejected" : "review-ok", reasons };
}
