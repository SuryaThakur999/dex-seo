import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Fingerprint, Scales, Prohibit, Ruler, Copy } from '@phosphor-icons/react/dist/ssr';

export const OUTCOME_LABEL: Record<string, string> = { pass: 'Pass', flag: 'Needs review', block: 'Blocked' };
export const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  pass: 'default',
  flag: 'secondary',
  block: 'destructive',
};

export const RISK_TIER_LABEL: Record<string, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
export const RISK_TIER_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  low: 'default',
  medium: 'secondary',
  high: 'destructive',
};

export const CHECK_ICON: Record<string, PhosphorIcon> = {
  'ai-content-disclosure': Fingerprint,
  'no-unverifiable-claims': Scales,
  'no-contradiction': Prohibit,
  'length-format': Ruler,
  'duplicate-risk': Copy,
};

export const CHECK_LABEL: Record<string, string> = {
  'ai-content-disclosure': 'AI disclosure',
  'no-unverifiable-claims': 'Verifiable claims',
  'no-contradiction': 'No contradiction',
  'length-format': 'Length',
  'duplicate-risk': 'Not a duplicate',
};
