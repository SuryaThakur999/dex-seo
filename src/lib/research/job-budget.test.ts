import { describe, expect, it } from 'vitest';
import { JobBudget, BudgetExceededError } from './job-budget';

describe('JobBudget', () => {
  it('spendTokens throws exactly at the cap, not one token later', () => {
    const budget = new JobBudget(100, 10);
    budget.spendTokens(60);
    budget.spendTokens(40); // exactly 100 -- allowed
    expect(() => budget.spendTokens(1)).toThrow(BudgetExceededError);
  });

  it('spendTokens allows spending up to but not past the cap in one call', () => {
    const budget = new JobBudget(100, 10);
    expect(() => budget.spendTokens(101)).toThrow(BudgetExceededError);
  });

  it('recordRequest throws on the N+1th request to the same domain while a different domain is unaffected', () => {
    const budget = new JobBudget(1000, 2);
    budget.recordRequest('a.test');
    budget.recordRequest('a.test');
    expect(() => budget.recordRequest('a.test')).toThrow(BudgetExceededError);
    expect(() => budget.recordRequest('b.test')).not.toThrow();
  });
});
