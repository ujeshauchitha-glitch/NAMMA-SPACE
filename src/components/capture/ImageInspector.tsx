import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Layers } from '../icons/icons';
import { MetadataKV, type MetadataEntry } from '../ui/MetadataKV';
import type { ImageMeta } from '../../state/types';
import styles from './ImageInspector.module.css';

/**
 * Right inspector (§6.2): tabs `[Details | Group | Provenance]` over
 * MetadataKV blocks, with `PREPARE CAPTURE` (signal) + `Export bundle`
 * (secondary, enabled once ≥1 image is staged) pinned to the foot.
 * Every value shown is schema/data-derived — no invented provenance (§5.19).
 */
export const INSPECTOR_TABS = ['Details', 'Group', 'Provenance'] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export type InspectorImage = {
  seq: number;
  meta: ImageMeta;
  stagedAt: number;
  recordId: string;
  groupName: string | null;
};

export type InspectorGroupStat = { label: string; count: number };

export type ImageInspectorProps = {
  image: InspectorImage | null;
  groupStats: InspectorGroupStat[];
  exportEnabled: boolean;
  onPrepare: () => void;
  onExport: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function detailsEntries(image: InspectorImage): MetadataEntry[] {
  return [
    { key: 'Frame', value: `Staged image ${image.seq}` },
    { key: 'Dimensions', value: `${image.meta.width} × ${image.meta.height} px` },
    { key: 'Stored bytes', value: formatBytes(image.meta.bytes) },
    { key: 'Encoding', value: 'JPEG · q0.9 · long edge ≤ 2048 px' },
    { key: 'SHA-256', value: image.meta.sha256, mono: true, copy: true },
    { key: 'Staged at', value: new Date(image.stagedAt).toISOString() },
  ];
}

function provenanceEntries(image: InspectorImage): MetadataEntry[] {
  return [
    { key: 'Source', value: image.meta.source === 'phone' ? 'PHONE · MEASURED' : 'OPERATOR · MEASURED' },
    { key: 'Pipeline', value: 'browser ingest (sniff → decode → resize → sha256)' },
    { key: 'Record id', value: image.recordId, mono: true, copy: true },
    { key: 'SHA-256', value: image.meta.sha256, mono: true, copy: true },
  ];
}

export function ImageInspector({ image, groupStats, exportEnabled, onPrepare, onExport }: ImageInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('Details');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = INSPECTOR_TABS.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % INSPECTOR_TABS.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = INSPECTOR_TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(INSPECTOR_TABS[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <section className={styles.inspector} aria-label="Image inspector">
      <div className={styles.tabs} role="tablist" aria-label="Inspector sections">
        {INSPECTOR_TABS.map((name, index) => (
          <button
            key={name}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`inspector-tab-${name.toLowerCase()}`}
            aria-selected={tab === name}
            aria-controls="inspector-panel"
            tabIndex={tab === name ? 0 : -1}
            className={[styles.tab, tab === name ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(name)}
            onKeyDown={onTabKeyDown}
          >
            {name}
          </button>
        ))}
      </div>

      <div className={styles.panel} id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${tab.toLowerCase()}`}>
        {!image ? (
          <EmptyState
            icon={Layers}
            title="No image selected"
            body="Choose a thumbnail to inspect its dimensions, hash and provenance."
          />
        ) : tab === 'Details' ? (
          <MetadataKV entries={detailsEntries(image)} />
        ) : tab === 'Group' ? (
          <MetadataKV
            entries={[
              { key: 'Assigned group', value: image.groupName ?? 'Unassigned' },
              ...groupStats.map((stat) => ({ key: stat.label, value: `${stat.count} image${stat.count === 1 ? '' : 's'}` })),
            ]}
          />
        ) : (
          <MetadataKV entries={provenanceEntries(image)} />
        )}
      </div>

      <footer className={styles.foot}>
        <Button variant="signal" disabled={!exportEnabled} onClick={onPrepare}>
          PREPARE CAPTURE
        </Button>
        <Button variant="secondary" disabled={!exportEnabled} onClick={onExport}>
          Export bundle
        </Button>
      </footer>
    </section>
  );
}
