// In-house splits. Each step is strictly easier than its parent, still unsolved, and a real ingredient of
// it (not a case split by residue or range, which only restates the parent). The steps of a split
// together imply the parent: that implication is proved in Lean in Splits/Split_<Parent>.lean.
// We never prove the steps themselves. A problem with no honest split stays unsplit.
//
// The first board (2026-11-24) had five residue and range case splits. They were removed the same day:
// each half was essentially the whole problem (for example, a multiple of 3 reaches a non-multiple of 3
// within a few steps), so they were padding, not decomposition.
// Entry fields: id, parent, split ("Split_<ParentStatement>"), statement ("Step_<Name>"), lean, title_en, title_zh, sketch.
const steps = [];
export default steps;
