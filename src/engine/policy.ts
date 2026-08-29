/**
 * A single policy card.
 *
 * A string enum rather than a union of `'F' | 'L'`: the values still serialise and render as the
 * single letters the game uses, but nothing has to be written `'F' as const` to stop it widening
 * back to `string` inside an array or object literal.
 */
export enum Policy {
  Fascist = 'F',
  Liberal = 'L'
}

export const DRAW_SIZE = 3;
export const FASCIST_POLICY_COUNT = 11;
export const LIBERAL_POLICY_COUNT = 6;
export const PASS_SIZE = 2;
export const TOTAL_POLICY_COUNT = FASCIST_POLICY_COUNT + LIBERAL_POLICY_COUNT;

/**
 * A hand is an unordered multiset, so it is fully described by how many of its cards are Fascist.
 * Rendering Fascist cards first keeps claims comparable by string.
 */
export function formatHand(fascistCount: number, size: number): string {
  if (fascistCount < 0 || fascistCount > size) {
    throw new RangeError(`Fascist count ${String(fascistCount)} is out of range for a hand of ${String(size)}.`);
  }

  return Policy.Fascist.repeat(fascistCount) + Policy.Liberal.repeat(size - fascistCount);
}

const POLICY_BY_LETTER = new Map<string, Policy>([
  [Policy.Fascist, Policy.Fascist],
  [Policy.Liberal, Policy.Liberal]
]);

export function parseHand(hand: string): number {
  let fascistCount = 0;

  for (const character of hand) {
    const policy = POLICY_BY_LETTER.get(character);

    if (policy === undefined) {
      throw new SyntaxError(`Hand ${hand} contains ${character}, which is not a policy card.`);
    }

    if (policy === Policy.Fascist) {
      fascistCount++;
    }
  }

  return fascistCount;
}
