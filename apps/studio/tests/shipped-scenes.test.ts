// Every bundle under public/scenes must pass the same schemas the viewer applies at load time
// (validate_scene.py checks the shape, not the enums, so a bad POI category only showed up in the browser).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavigationSchema, PoiSchema, QualityReportSchema, SceneManifestSchema } from '../src/types/scene';

const root = join(__dirname, '..', 'public', 'scenes');
const read = (dir: string, uri: string): unknown => JSON.parse(readFileSync(join(root, dir, uri), 'utf8'));
const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('shipped scene bundles', () => {
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    it(`${dir} passes the viewer's schemas`, () => {
      const manifest = SceneManifestSchema.safeParse(read(dir, 'manifest.json'));
      expect(issues(manifest)).toEqual([]);
      if (!manifest.success) return;
      const { navigationUri, semanticUri, qualityUri } = manifest.data;
      if (navigationUri) expect(issues(NavigationSchema.safeParse(read(dir, navigationUri)))).toEqual([]);
      if (semanticUri) expect(issues(PoiSchema.array().safeParse(read(dir, semanticUri)))).toEqual([]);
      if (qualityUri) expect(issues(QualityReportSchema.safeParse(read(dir, qualityUri)))).toEqual([]);
    });
  }
});
