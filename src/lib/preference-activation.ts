// Activation state is never stored -- it's always this membership check against the live
// ClientProfile.restrictedWording array. See docs/superpowers/specs/2026-09-20-phase8d-
// versioned-activation-design.md's "Key decision: activation state is derived, not stored".
export function isPreferenceActive(restrictedWording: string[], phrase: string): boolean {
  return restrictedWording.includes(phrase);
}

// Strips every exact match, not just the first -- duplicates carry no separate meaning
// once membership is the only signal that decides "active."
export function withoutPreference(restrictedWording: string[], phrase: string): string[] {
  return restrictedWording.filter((w) => w !== phrase);
}
