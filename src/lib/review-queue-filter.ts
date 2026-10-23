import { actionTypeLabel } from '@/components/review/action-detail';

export interface TypeFilterOption {
  actionType: string;
  label: string;
  count: number;
}

// Options come only from types actually present in the pending set, so a chip can never
// lead to an empty queue.
export function buildTypeFilterOptions(actions: { actionType: string }[]): TypeFilterOption[] {
  const counts = new Map<string, number>();
  for (const { actionType } of actions) counts.set(actionType, (counts.get(actionType) ?? 0) + 1);
  return Array.from(counts, ([actionType, count]) => ({
    actionType,
    label: actionTypeLabel(actionType),
    count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// A stale `?type=` (its last pending item was just decided) or a hand-edited one resolves to
// null, i.e. "All", instead of rendering an empty queue.
export function resolveTypeFilter(
  param: string | string[] | undefined,
  options: TypeFilterOption[]
): string | null {
  const requested = Array.isArray(param) ? param[0] : param;
  return options.find((o) => o.actionType === requested)?.actionType ?? null;
}
