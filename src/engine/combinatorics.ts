export interface HypergeometricProbabilityParams {
  readonly drawSize: number;
  readonly fascistInDraw: number;
  readonly fascistInPile: number;
  readonly pileSize: number;
}

/**
 * The deck never exceeds 17 cards, so every intermediate value here stays far below
 * `Number.MAX_SAFE_INTEGER` and exact integer arithmetic is enough. No factorials are formed.
 */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }

  const smallerK = Math.min(k, n - k);
  let result = 1;

  for (let i = 0; i < smallerK; i++) {
    result = result * (n - i) / (i + 1);
  }

  return Math.round(result);
}

/**
 * Probability that drawing `drawSize` cards from a pile of `pileSize` holding `fascistInPile`
 * Fascist policies yields exactly `fascistInDraw` Fascist policies.
 */
export function hypergeometricProbability(params: HypergeometricProbabilityParams): number {
  const { drawSize, fascistInDraw, fascistInPile, pileSize } = params;
  const liberalInPile = pileSize - fascistInPile;
  const liberalInDraw = drawSize - fascistInDraw;

  if (fascistInDraw < 0 || liberalInDraw < 0 || fascistInDraw > fascistInPile || liberalInDraw > liberalInPile) {
    return 0;
  }

  const total = combinations(pileSize, drawSize);

  if (total === 0) {
    return 0;
  }

  return combinations(fascistInPile, fascistInDraw) * combinations(liberalInPile, liberalInDraw) / total;
}
