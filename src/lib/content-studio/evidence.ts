import type { Prisma } from '@prisma/client';

export interface FindingEvidence {
  kind: 'finding';
  findingId: string;
  ruleId: string;
  pageUrl: string;
  retrievedAt: string;
  evidence: Prisma.JsonValue;
  limitations: string | null;
}

export function readFindingEvidence(value: unknown): FindingEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'finding' || !['findingId', 'ruleId', 'pageUrl', 'retrievedAt'].every(
    (key) => typeof record[key] === 'string' && record[key] !== ''
  ) || !('evidence' in record) || !(record.limitations === null || typeof record.limitations === 'string')) return null;
  return value as FindingEvidence;
}
