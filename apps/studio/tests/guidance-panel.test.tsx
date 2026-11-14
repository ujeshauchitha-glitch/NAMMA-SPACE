import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuidancePanel } from '../src/components/viewer/GuidancePanel';
import type { GuidanceUpdate } from '../src/engine/PlayCanvasViewer';

const base: GuidanceUpdate = { poiId: 'desk', label: 'Desk', status: 'guiding', remaining: 6.2, total: 10, instruction: 'Turn left in 3 m', walkTime: 'about 5 s', rerouted: false };
const render = (update: Partial<GuidanceUpdate>) => renderToStaticMarkup(
  <GuidancePanel guidance={{ ...base, ...update }} onFollow={() => {}} onStopFollowing={() => {}} onEnd={() => {}} />,
);

describe('guidance panel', () => {
  it('shows the next step, distance, walk time and progress', () => {
    const html = render({});
    expect(html).toContain('Turn left in 3 m');
    expect(html).toContain('6.2 m to Desk · about 5 s walk');
    expect(html).toContain('aria-valuenow="38"');
    expect(html).toContain('Follow route');
    expect(html).toContain('End route');
  });
  it('offers to stop while following, flags re-routes, and shows arrival', () => {
    expect(render({ status: 'following' })).toContain('Stop following');
    expect(render({ rerouted: true })).toContain('re-routed');
    const arrived = render({ status: 'arrived', remaining: 0 });
    expect(arrived).toContain('You have arrived at Desk');
    expect(arrived).toContain('Done');
    expect(arrived).not.toContain('Follow route');
  });
});
