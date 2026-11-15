/**
 * The scene switcher's list. Visitors see the real captures, with the classroom first (the default)
 * and the apartment labelled as the external benchmark dataset it is. Synthetic fixtures are test
 * and authoring material: they are listed only in the authoring view (?edit=1 / ?debug=1), or when
 * the scene currently open is itself a fixture (a deep link, or the e2e environment that pins one),
 * so the switcher can always show what is loaded.
 */
export type SceneOption = { name: string; label: string; fixture: boolean };

export const SCENES: readonly SceneOption[] = [
  // Gaussian splats trained by pipeline/ (COLMAP + Brush): our classroom filmed on a phone, and Meta's Eyeful
  // Tower 'apartment', an external benchmark dataset (MIT licence, credited in its manifest).
  { name: 'classroom', label: 'Classroom: our phone capture (Gaussian splat)', fixture: false },
  { name: 'real-room', label: 'Workshop room: our 70-photo capture (sparse model)', fixture: false },
  { name: 'apartment', label: 'Apartment: external benchmark dataset (Meta Eyeful Tower, MIT)', fixture: false },
  { name: 'splat-fixture', label: 'Synthetic Splat fixture (SOG)', fixture: true },
  { name: 'fixture', label: 'Procedural fixture', fixture: true },
  { name: 'glb-fixture', label: 'Generated GLB fixture', fixture: true },
];

export const DEFAULT_SCENE_NAME = 'classroom';

/** Scene name from a manifest URL ('/base/scenes/<name>/manifest.json'), or null for other URLs. */
export function sceneNameOf(url: string): string | null {
  return /\/scenes\/([^/]+)\/manifest\.json$/.exec(url)?.[1] ?? null;
}

export function visibleScenes(options: { authoring: boolean; currentUrl: string }): SceneOption[] {
  const current = sceneNameOf(options.currentUrl);
  const currentIsFixture = SCENES.some((s) => s.fixture && s.name === current);
  return SCENES.filter((s) => !s.fixture || options.authoring || currentIsFixture);
}
