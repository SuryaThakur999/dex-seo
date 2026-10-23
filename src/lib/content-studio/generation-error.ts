export class ContentGenerationError extends Error {
  constructor(message: string, readonly tokenCost: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'ContentGenerationError';
  }
}

export function getGenerationTokenCost(error: unknown): number {
  return error instanceof ContentGenerationError ? error.tokenCost : 0;
}
