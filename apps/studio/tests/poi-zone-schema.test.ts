import { describe, expect, it } from 'vitest';
import { PoiSchema } from '../src/types/scene';

const base = {
  id: 'hall', label: 'Main hall', category: 'room', position: [0, 1.4, 0], approachPoint: [0, 1.45, 1],
  aliases: [], confidence: 1, source: 'operator',
};

describe('POI zone schema', () => {
  it('keeps POIs without a zone valid (backward compatible)', () => {
    expect(PoiSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a polygon of [x, z] floor points', () => {
    const parsed = PoiSchema.parse({ ...base, zone: [[0, 0], [4, 0], [4, 3], [0, 3]] });
    expect(parsed.zone).toHaveLength(4);
  });

  it('rejects zones with too few points, wrong shape or no area', () => {
    expect(PoiSchema.safeParse({ ...base, zone: [[0, 0], [1, 1]] }).success).toBe(false);
    expect(PoiSchema.safeParse({ ...base, zone: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }).success).toBe(false);
    expect(PoiSchema.safeParse({ ...base, zone: [[0, 0], [1, 1], [2, 2]] }).success).toBe(false);
  });
});
