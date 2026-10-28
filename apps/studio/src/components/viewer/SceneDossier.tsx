import { MetadataKV, type MetadataEntry } from '../ui/MetadataKV';
import type { SceneBundle } from '../../types/scene';
import styles from './SpatialViewerWorkspace.module.css';

/**
 * Scene dossier (§5.15 / T16) — the provenance half of the right rail: a
 * MetadataKV block over the manifest's declared facts (pipeline, bounds,
 * navigation grid) plus presence-based readiness rows. Values are read from
 * the loaded bundle where the manifest carries them; COORDINATE FRAME is a
 * fixed literal for this renderer, and the readiness rows report what is
 * present (visual asset / navigation grid), not a runtime verification of
 * the layer itself. While the bundle is still loading nothing is invented
 * (`bundle === null` renders honest dashes).
 */
export type SceneDossierProps = {
  bundle: SceneBundle | null;
};

export function SceneDossier({ bundle }: SceneDossierProps) {
  const navigation = bundle?.navigation ?? null;
  const bounds = bundle?.manifest.bounds;

  const entries: MetadataEntry[] = [
    { key: 'PIPELINE', value: bundle?.manifest.provenance.pipeline ?? '—' },
    { key: 'COORDINATE FRAME', value: bundle ? 'Y-up · metre' : '—' },
    {
      key: 'BOUNDS',
      value: bounds
        ? `${(bounds.max[0] - bounds.min[0]).toFixed(1)}m × ${(bounds.max[2] - bounds.min[2]).toFixed(1)}m`
        : '—',
    },
    {
      key: 'NAVIGATION',
      value: navigation ? `${navigation.width} × ${navigation.height} grid` : 'Unavailable',
    },
  ];

  const visualLayer = bundle ? 'Ready' : 'Unavailable';
  const collisionLayer = navigation ? 'Ready' : 'Unavailable';
  const poiIndex = bundle ? 'Ready' : 'Unavailable';

  return (
    <>
      <MetadataKV entries={entries} />
      <div className={styles.readinessList}>
        <span>
          Visual layer <b>{visualLayer}</b>
        </span>
        <span>
          Collision layer <b>{collisionLayer}</b>
        </span>
        <span>
          POI index <b>{poiIndex}</b>
        </span>
      </div>
    </>
  );
}
