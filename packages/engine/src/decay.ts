/**
 * Exponential importance decay.
 *
 * importance 10 (witnessed murder): plateau ~2.0 after 90 days
 * importance  5 (trade deal):       ~0 after 30 days
 * importance  2 (conversation):     ~0 after 5 days
 */
export function decayedImportance(importance: number, daysPassed: number): number {
  if (daysPassed <= 0) return importance;
  return importance * Math.exp(-daysPassed / (importance * 5));
}

/**
 * Freshness score: recent events rank higher.
 */
export function freshness(daysPassed: number): number {
  return 1 / (daysPassed + 1);
}

/**
 * Composite memory retrieval score.
 *
 * relevance  — cosine similarity from vector search (0-1)
 * importance — decayed importance normalized to 0-1
 * freshness  — recency factor (0-1)
 */
export function compositeScore(
  relevance: number,
  decayedImp: number,
  fresh: number,
): number {
  return relevance * 0.4 + (decayedImp / 10) * 0.4 + fresh * 0.2;
}
