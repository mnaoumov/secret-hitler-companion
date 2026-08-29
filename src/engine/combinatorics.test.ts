import {
  describe,
  expect,
  it
} from 'vitest';

import {
  combinations,
  hypergeometricProbability
} from './combinatorics.ts';
import { DRAW_SIZE } from './policy.ts';
import { SPREADSHEET_ROWS } from './spreadsheet-fixture.ts';

describe('combinations', () => {
  it('matches known values', () => {
    expect(combinations(17, 3)).toBe(680);
    expect(combinations(11, 3)).toBe(165);
    expect(combinations(11, 2)).toBe(55);
    expect(combinations(6, 3)).toBe(20);
  });

  it('is zero outside the valid range', () => {
    expect(combinations(3, 4)).toBe(0);
    expect(combinations(3, -1)).toBe(0);
  });

  it('is symmetric', () => {
    for (let n = 0; n <= 17; n++) {
      for (let k = 0; k <= n; k++) {
        expect(combinations(n, k)).toBe(combinations(n, n - k));
      }
    }
  });
});

/**
 * Ground truth, owing nothing to any formula: label the cards, enumerate every three-card subset by
 * brute force, and count how many hold each number of Fascists.
 *
 * This exists because the spreadsheet is corroboration, not specification — its arithmetic was never
 * independently checked. Agreeing with it would only show that two implementations of the same idea
 * match; agreeing with an exhaustive count shows the idea itself is right.
 */
function countByEnumeration(fascistInPile: number, pileSize: number): number[] {
  const counts = new Array<number>(DRAW_SIZE + 1).fill(0);
  let total = 0;

  for (let first = 0; first < pileSize; first++) {
    for (let second = first + 1; second < pileSize; second++) {
      for (let third = second + 1; third < pileSize; third++) {
        // Cards 0..fascistInPile-1 are the Fascist ones.
        const fascists = [first, second, third].filter((card) => card < fascistInPile).length;
        counts[fascists] = (counts[fascists] ?? 0) + 1;
        total++;
      }
    }
  }

  return counts.map((count) => count / total);
}

describe('exhaustive enumeration', () => {
  it.each([
    [11, 17],
    [8, 14],
    [6, 12],
    [5, 9],
    [3, 6],
    [0, 5],
    [4, 4]
  ])('agrees with the hypergeometric for %i F in %i cards', (fascistInPile, pileSize) => {
    const enumerated = countByEnumeration(fascistInPile, pileSize);

    for (let fascistInDraw = 0; fascistInDraw <= DRAW_SIZE; fascistInDraw++) {
      expect(hypergeometricProbability({ drawSize: DRAW_SIZE, fascistInDraw, fascistInPile, pileSize }))
        .toBeCloseTo(enumerated[fascistInDraw] ?? 0, 12);
    }
  });

  it('confirms the opening deck by counting, not by formula', () => {
    const enumerated = countByEnumeration(11, 17);

    // 165, 330, 165 and 20 subsets out of 680.
    expect(enumerated[3]).toBeCloseTo(165 / 680, 12);
    expect(enumerated[2]).toBeCloseTo(330 / 680, 12);
    expect(enumerated[1]).toBeCloseTo(165 / 680, 12);
    expect(enumerated[0]).toBeCloseTo(20 / 680, 12);
  });
});

describe('hypergeometricProbability', () => {
  it('reproduces the fresh deck the owner worked by hand', () => {
    function draw(fascistInDraw: number): number {
      return hypergeometricProbability({ drawSize: DRAW_SIZE, fascistInDraw, fascistInPile: 11, pileSize: 17 });
    }

    expect(draw(3)).toBeCloseTo(165 / 680, 12);
    expect(draw(2)).toBeCloseTo(330 / 680, 12);
    expect(draw(1)).toBeCloseTo(165 / 680, 12);
    expect(draw(0)).toBeCloseTo(20 / 680, 12);
  });

  /*
   * The spreadsheet is corroboration, not specification — the owner never checked its arithmetic.
   * It earns its place because it was computed by a different method (sequential
   * draw-without-replacement rather than binomial coefficients), so agreement across all 78 rows is
   * evidence about both. The exhaustive enumeration above is what actually pins the model down.
   */
  it.each(SPREADSHEET_ROWS)(
    'matches the spreadsheet for $fascist F / $liberal L',
    (row) => {
      const pileSize = row.fascist + row.liberal;
      function draw(fascistInDraw: number): number {
        return hypergeometricProbability({ drawSize: DRAW_SIZE, fascistInDraw, fascistInPile: row.fascist, pileSize });
      }

      expect(draw(3)).toBeCloseTo(row.threeFascist, 12);
      expect(draw(2)).toBeCloseTo(row.twoFascistOneLiberal, 12);
      expect(draw(1)).toBeCloseTo(row.oneFascistTwoLiberal, 12);
      expect(draw(0)).toBeCloseTo(row.threeLiberal, 12);
      expect(1 - draw(3)).toBeCloseTo(row.atLeastOneLiberal, 12);
      expect(row.fascist / pileSize).toBeCloseTo(row.fascistOffTop, 12);
      expect(row.liberal / pileSize).toBeCloseTo(row.liberalOffTop, 12);
    }
  );

  it('sums to one over every possible draw', () => {
    for (const row of SPREADSHEET_ROWS) {
      const pileSize = row.fascist + row.liberal;
      let total = 0;

      for (let fascistInDraw = 0; fascistInDraw <= DRAW_SIZE; fascistInDraw++) {
        total += hypergeometricProbability({ drawSize: DRAW_SIZE, fascistInDraw, fascistInPile: row.fascist, pileSize });
      }

      expect(total).toBeCloseTo(1, 12);
    }
  });
});
