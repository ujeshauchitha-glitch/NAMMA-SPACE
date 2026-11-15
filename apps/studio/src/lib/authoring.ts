/**
 * Authoring view: internal QA and provenance details (validation pill, scene dossier, confidence and
 * source tags, A* cell counts, the POI editor and bundle reload) are for the people building a scene,
 * not for visitors. They show with ?edit=1 (which also opens the POI editor) or ?debug=1.
 */
export function isAuthoringView(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('edit') === '1' || params.get('debug') === '1';
}
