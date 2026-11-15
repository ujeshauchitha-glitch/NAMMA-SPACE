import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE_NAME, SCENES, sceneNameOf, visibleScenes } from '../src/components/viewer/sceneOptions';

const url = (name: string) => `/scenes/${name}/manifest.json`;

describe('scene switcher options', () => {
  it('defaults to the classroom, listed first', () => {
    expect(DEFAULT_SCENE_NAME).toBe('classroom');
    expect(SCENES[0].name).toBe('classroom');
  });

  it('labels the apartment as the external benchmark dataset', () => {
    expect(SCENES.find((s) => s.name === 'apartment')?.label).toMatch(/external benchmark dataset/);
  });

  it('hides fixtures from visitors', () => {
    const names = visibleScenes({ authoring: false, currentUrl: url('classroom') }).map((s) => s.name);
    expect(names).toEqual(['classroom', 'real-room', 'apartment']);
  });

  it('lists fixtures in the authoring view, or when a fixture is what is open', () => {
    expect(visibleScenes({ authoring: true, currentUrl: url('classroom') })).toHaveLength(SCENES.length);
    expect(visibleScenes({ authoring: false, currentUrl: url('fixture') }).map((s) => s.name)).toContain('glb-fixture');
  });

  it('reads the scene name from manifest URLs under any base path', () => {
    expect(sceneNameOf('/NAMMA-SPACE/scenes/apartment/manifest.json')).toBe('apartment');
    expect(sceneNameOf('https://example.com/other.json')).toBeNull();
  });
});
