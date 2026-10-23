import { unstable_cache } from 'next/cache';
import { AiInsightCard } from '@/components/dashboard/ai-insight-card';
import { generateDashboardInsight, type DashboardInsightInput } from '@/lib/dashboard-insight';

const getCachedInsight = unstable_cache(
  async (_customerId: string, input: DashboardInsightInput) => generateDashboardInsight(input),
  ['dashboard-insight'],
  { revalidate: 300 }
);

export async function AiInsightSection({
  customerId,
  input,
}: {
  customerId: string;
  input: DashboardInsightInput;
}) {
  const summary = await getCachedInsight(customerId, input);
  return <AiInsightCard summary={summary} />;
}
