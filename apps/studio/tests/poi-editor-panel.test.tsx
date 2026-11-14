import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoiEditorPanel, type PoiEditorPanelProps } from '../src/components/viewer/PoiEditorPanel';
import type { Poi } from '../src/types/scene';

const poi: Poi = {
  id: 'desk', label: 'Desk', category: 'furniture', position: [1, 1, 1], approachPoint: [1.25, 1.45, 2.05],
  aliases: ['table'], description: 'By the window', confidence: 1, source: 'operator',
};
const noop = () => {};
const render = (overrides: Partial<PoiEditorPanelProps> = {}) => renderToStaticMarkup(
  <PoiEditorPanel
    pois={[poi]} selectedId={null} tool="select" zonePointCount={0} approachWalkable hasDraft={false} message={null}
    onTool={noop} onSelect={noop} onChange={noop} onDelete={noop} onFinishZone={noop} onCancelZone={noop}
    onRemoveZone={noop} onExport={noop} onImport={noop} onDiscard={noop}
    {...overrides}
  />,
);

describe('POI editor panel', () => {
  it('lists POIs and the three tools, with export/import', () => {
    const html = render();
    expect(html).toContain('Select / move');
    expect(html).toContain('Add POI');
    expect(html).toContain('Draw zone');
    expect(html).toContain('Desk');
    expect(html).toContain('Export pois.json');
    expect(html).toContain('Import');
    expect(html).toContain('Showing the POIs shipped with the scene.');
  });

  it('shows the form for the selected POI with its approach point', () => {
    const html = render({ selectedId: 'desk' });
    expect(html).toContain('value="Desk"');
    expect(html).toContain('value="table"');
    expect(html).toContain('By the window');
    expect(html).toContain('Approach point 1.25, 2.05 · on walkable floor');
    expect(html).toContain('Delete POI');
  });

  it('warns when the approach point is not walkable and guides zone drawing', () => {
    expect(render({ selectedId: 'desk', approachWalkable: false })).toContain('not walkable');
    const zone = render({ selectedId: 'desk', tool: 'zone', zonePointCount: 2 });
    expect(zone).toContain('Zone for Desk: 2 corners');
    const finishButton = zone.split('<button').find((chunk) => chunk.includes('>Finish zone<'));
    expect(finishButton).toContain('disabled=""');
    expect(render({ tool: 'zone' })).toContain('Select a POI first');
  });
});
