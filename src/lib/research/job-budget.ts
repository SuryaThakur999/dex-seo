export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

// Wraps a single ResearchJob's spend -- the processing loop (Task 17) wraps every connector
// call and every model call through this, same "tokenCost running total" discipline already
// used elsewhere in this codebase (ScanJob, ContentVariant), extended to a hard stop.
export class JobBudget {
  private tokensSpent = 0;
  private requestsByDomain = new Map<string, number>();

  constructor(
    private readonly maxTokens: number,
    private readonly maxRequestsPerDomain: number,
  ) {}

  spendTokens(n: number): void {
    if (this.tokensSpent + n > this.maxTokens) {
      throw new BudgetExceededError(`Token budget exceeded: ${this.tokensSpent + n} > ${this.maxTokens}`);
    }
    this.tokensSpent += n;
  }

  recordRequest(domain: string): void {
    const count = this.requestsByDomain.get(domain) ?? 0;
    if (count + 1 > this.maxRequestsPerDomain) {
      throw new BudgetExceededError(`Per-domain request cap exceeded for ${domain}: ${count + 1} > ${this.maxRequestsPerDomain}`);
    }
    this.requestsByDomain.set(domain, count + 1);
  }
}
