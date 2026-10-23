export type VariantAngleIndex = 0 | 1 | 2;

export const VARIANT_ANGLE_INDICES = [0, 1, 2] as const;

const ANGLES = [
  {
    label: 'Practical walkthrough',
    instruction: 'Practical walkthrough: teach the reader how to take one useful step. Organize the argument around a concrete process, with an actionable hook and an objective-aligned CTA.',
  },
  {
    label: 'Decision guide',
    instruction: 'Decision guide: help the reader choose between approaches using grounded criteria and tradeoffs. Organize the argument around a decision, with a choice-focused hook and an objective-aligned CTA.',
  },
  {
    label: 'Misconception check',
    instruction: 'Misconception check: examine an assumption using only the supplied evidence. Do not invent a popular belief or claim. Organize the argument around what the evidence supports and its limits, with an objective-aligned CTA.',
  },
] as const;

export function getVariantAngle(index: VariantAngleIndex) {
  const angle = ANGLES[index];
  if (!angle) throw new Error('Invalid content variant angle');
  return angle;
}
