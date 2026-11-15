import { describe, expect, it } from 'vitest';
import { isAuthoringView } from '../src/lib/authoring';

describe('isAuthoringView', () => {
  it('is on only for ?edit=1 or ?debug=1', () => {
    expect(isAuthoringView('')).toBe(false);
    expect(isAuthoringView('?scene=/scenes/classroom/manifest.json')).toBe(false);
    expect(isAuthoringView('?edit=1')).toBe(true);
    expect(isAuthoringView('?scene=x&debug=1')).toBe(true);
    expect(isAuthoringView('?edit=0')).toBe(false);
  });
});
