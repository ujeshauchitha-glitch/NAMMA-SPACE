import { useRef } from 'react';
import type { Poi } from '../../types/scene';
import { Button } from '../ui/Button';
import { parseAliases } from '../../lib/poiEditor';
import styles from './SpatialViewerWorkspace.module.css';

export type EditorTool = 'select' | 'place' | 'zone';

const CATEGORIES: Poi['category'][] = ['room', 'service', 'landmark', 'furniture', 'entrance', 'other'];

const TOOL_HINT: Record<EditorTool, string> = {
  select: 'Click a pin to edit it; drag a pin to move it. Right-drag looks around, W A S D walks.',
  place: 'Click the floor to place a new POI there.',
  zone: 'Click the floor to add zone corners, then Finish zone.',
};

export type PoiEditorPanelProps = {
  pois: Poi[];
  selectedId: string | null;
  tool: EditorTool;
  zonePointCount: number;
  /** Approach-point check for the selected POI. */
  approachWalkable: boolean;
  hasDraft: boolean;
  message: string | null;
  onTool: (tool: EditorTool) => void;
  onSelect: (poiId: string) => void;
  onChange: (poi: Poi) => void;
  onDelete: (poiId: string) => void;
  onFinishZone: () => void;
  onCancelZone: () => void;
  onRemoveZone: (poiId: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onDiscard: () => void;
};

/** Rail panel for the in-app POI editor ("Edit POIs" toggle or ?edit=1). */
export function PoiEditorPanel(props: PoiEditorPanelProps) {
  const { pois, selectedId, tool, zonePointCount, approachWalkable, hasDraft, message } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const poi = pois.find((candidate) => candidate.id === selectedId) ?? null;
  const update = (patch: Partial<Poi>) => poi && props.onChange({ ...poi, ...patch });

  return (
    <div className={styles.editor} data-testid="poi-editor">
      <div className={styles.editorTools} role="toolbar" aria-label="POI editor tools">
        {(['select', 'place', 'zone'] as const).map((value) => (
          <Button key={value} variant={tool === value ? 'primary' : 'secondary'} aria-pressed={tool === value} onClick={() => props.onTool(value)}>
            {value === 'select' ? 'Select / move' : value === 'place' ? 'Add POI' : 'Draw zone'}
          </Button>
        ))}
      </div>
      <p className={styles.editorHint}>{TOOL_HINT[tool]}</p>
      {tool === 'zone' && (
        <div className={styles.editorRow}>
          <span>{poi ? `Zone for ${poi.label}: ${zonePointCount} corner${zonePointCount === 1 ? '' : 's'}` : 'Select a POI first'}</span>
          <Button onClick={props.onFinishZone} disabled={!poi || zonePointCount < 3}>Finish zone</Button>
          <Button variant="quiet" onClick={props.onCancelZone} disabled={zonePointCount === 0}>Cancel</Button>
        </div>
      )}
      {message && <p className={styles.editorMessage} role="status">{message}</p>}

      <ul className={styles.editorList} aria-label="POIs in this scene">
        {pois.map((candidate) => (
          <li key={candidate.id}>
            <button type="button" aria-current={candidate.id === selectedId} onClick={() => props.onSelect(candidate.id)}>
              {candidate.label}
              <span>{candidate.category}{candidate.zone ? ' · zone' : ''}</span>
            </button>
          </li>
        ))}
        {pois.length === 0 && <li className={styles.editorHint}>No POIs yet. Use Add POI.</li>}
      </ul>

      {poi && (
        <form className={styles.editorForm} onSubmit={(event) => event.preventDefault()} aria-label={`Edit ${poi.label}`}>
          <label>Label<input value={poi.label} onChange={(event) => update({ label: event.target.value })} required /></label>
          <label>Category
            <select value={poi.category} onChange={(event) => update({ category: event.target.value as Poi['category'] })}>
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>Aliases (comma separated)
            <input
              defaultValue={poi.aliases.join(', ')}
              key={`${poi.id}-aliases`}
              onBlur={(event) => update({ aliases: parseAliases(event.target.value) })}
            />
          </label>
          <label>Description<textarea rows={2} value={poi.description ?? ''} onChange={(event) => update({ description: event.target.value || undefined })} /></label>
          <p className={approachWalkable ? styles.editorHint : styles.editorMessage}>
            {`Approach point ${poi.approachPoint[0].toFixed(2)}, ${poi.approachPoint[2].toFixed(2)}`}
            {approachWalkable ? ' · on walkable floor' : ' · not walkable: move the POI closer to open floor'}
          </p>
          <div className={styles.editorRow}>
            {poi.zone && <Button variant="quiet" onClick={() => props.onRemoveZone(poi.id)}>Remove zone</Button>}
            <Button variant="danger" onClick={() => props.onDelete(poi.id)}>Delete POI</Button>
          </div>
        </form>
      )}

      <div className={styles.editorRow}>
        <Button onClick={props.onExport} disabled={pois.length === 0}>Export pois.json</Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>Import</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onImport(file);
            event.target.value = '';
          }}
        />
        <Button variant="quiet" onClick={props.onDiscard} disabled={!hasDraft}>Discard draft</Button>
      </div>
      <p className={styles.editorHint}>{hasDraft ? 'Draft saved in this browser. Export to keep it.' : 'Showing the POIs shipped with the scene.'}</p>
    </div>
  );
}
