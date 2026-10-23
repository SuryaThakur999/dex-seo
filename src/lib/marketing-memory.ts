import { db } from '@/lib/db';

export type MarketingMemoryField =
  | 'businessDescription'
  | 'audience'
  | 'brandVoice'
  | 'markets'
  | 'languages'
  | 'approvedClaims'
  | 'restrictedWording';

export interface MarketingMemoryFact {
  field: MarketingMemoryField;
  value: string;
  source: 'client_profile' | 'activated_preference_match';
  evaluatorVersion: string | null;
  scope: 'client_profile';
  decidedAt: string | null;
}

export interface MarketingMemorySnapshot {
  clientProfileId: string;
  facts: MarketingMemoryFact[];
}

const SCALAR_FIELDS = ['businessDescription', 'audience', 'brandVoice'] as const;
const ARRAY_FIELDS = ['markets', 'languages', 'approvedClaims'] as const;

// Callers must establish profile ownership before using this reader.
// Evaluation matches describe stored records, not who entered a profile value.
export async function getMarketingMemory(clientProfileId: string): Promise<MarketingMemorySnapshot> {
  const profile = await db.clientProfile.findUniqueOrThrow({
    where: { id: clientProfileId },
    select: {
      businessDescription: true,
      audience: true,
      brandVoice: true,
      markets: true,
      languages: true,
      approvedClaims: true,
      restrictedWording: true,
    },
  });

  const activatedEvaluations = await db.preferenceEvaluation.findMany({
    where: { clientProfileId, targetField: 'restrictedWording', activatedAt: { not: null }, deactivatedAt: null },
    orderBy: [{ activatedAt: 'desc' }, { id: 'desc' }],
    select: { evaluatedPhrase: true, evaluatorVersion: true, activatedAt: true },
  });
  const activatedByPhrase = new Map<string, (typeof activatedEvaluations)[number]>();
  for (const evaluation of activatedEvaluations) {
    if (!activatedByPhrase.has(evaluation.evaluatedPhrase)) {
      activatedByPhrase.set(evaluation.evaluatedPhrase, evaluation);
    }
  }

  const facts: MarketingMemoryFact[] = [];
  for (const field of SCALAR_FIELDS) {
    const value = profile[field];
    if (value) facts.push({ field, value, source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null });
  }
  for (const field of ARRAY_FIELDS) {
    for (const value of profile[field]) {
      facts.push({ field, value, source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null });
    }
  }
  for (const phrase of profile.restrictedWording) {
    const activated = activatedByPhrase.get(phrase);
    facts.push({
      field: 'restrictedWording',
      value: phrase,
      source: activated ? 'activated_preference_match' : 'client_profile',
      evaluatorVersion: activated?.evaluatorVersion ?? null,
      scope: 'client_profile',
      decidedAt: activated?.activatedAt?.toISOString() ?? null,
    });
  }

  return { clientProfileId, facts };
}
