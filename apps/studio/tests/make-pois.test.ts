/**
 * scripts/make_pois.py snaps approach points onto walkable floor using the scene's navigation grid
 * (inferred from <scene>/semantic/pois.json, or given with --grid), and its output passes
 * scripts/validate_scene.py, which rejects unwalkable approach points.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAKE_POIS = resolve(HERE, '../scripts/make_pois.py');
const VALIDATOR = resolve(HERE, '../scripts/validate_scene.py');
const FIXTURE = resolve(HERE, '../public/scenes/fixture');
const temp: string[] = [];
afterAll(() => temp.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

type Grid = { width: number; height: number; cellSize: number; origin: { x: number; z: number }; blocked: number[]; unknown: number[] };
const grid = JSON.parse(readFileSync(join(FIXTURE, 'navigation', 'nav-data.json'), 'utf8')) as Grid;
const walkable = ([x, , z]: number[]) => {
  const cx = Math.floor((x - grid.origin.x) / grid.cellSize);
  const cz = Math.floor((z - grid.origin.z) / grid.cellSize);
  return cx >= 0 && cx < grid.width && cz >= 0 && cz < grid.height && !new Set([...grid.blocked, ...grid.unknown]).has(cz * grid.width + cx);
};
// A blocked cell's centre, for an approach point that must be snapped.
const blockedCentre = (() => {
  const i = grid.blocked[Math.floor(grid.blocked.length / 2)];
  return [grid.origin.x + ((i % grid.width) + 0.5) * grid.cellSize, grid.origin.z + (Math.floor(i / grid.width) + 0.5) * grid.cellSize];
})();

function run(args: string[]): string {
  return execFileSync('python3', [MAKE_POIS, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

describe('make_pois.py approach snapping', () => {
  it('snaps missing and unwalkable approach points using the scene grid, and the result validates', () => {
    const scene = mkdtempSync(join(tmpdir(), 'make-pois-'));
    temp.push(scene);
    cpSync(FIXTURE, scene, { recursive: true });
    const csv = join(scene, 'seed.csv');
    writeFileSync(csv, [
      'label,category,px,py,pz,ax,az',
      `No approach,landmark,${blockedCentre[0]},1,${blockedCentre[1]},,`,
      `Bad approach,service,0,1,0,${blockedCentre[0]},${blockedCentre[1]}`,
    ].join('\n'));
    run(['--output', join(scene, 'semantic', 'pois.json'), '--batch', csv]);
    const pois = JSON.parse(readFileSync(join(scene, 'semantic', 'pois.json'), 'utf8')) as Array<{ approachPoint: number[] }>;
    expect(pois).toHaveLength(2);
    pois.forEach((poi) => expect(walkable(poi.approachPoint)).toBe(true));
    // approach height defaults to the scene's start (eye) height
    const manifest = JSON.parse(readFileSync(join(scene, 'manifest.json'), 'utf8')) as { startPosition: number[] };
    expect(pois[0].approachPoint[1]).toBe(manifest.startPosition[1]);
    const validated = execFileSync('python3', [VALIDATOR, scene], { encoding: 'utf8', stdio: 'pipe' });
    expect(validated).toContain('PASS  2 POIs');
  });

  it('uses --grid when the output is not inside a scene bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-pois-'));
    temp.push(dir);
    const csv = join(dir, 'seed.csv');
    writeFileSync(csv, `label,px,py,pz\nKiosk,${blockedCentre[0]},1,${blockedCentre[1]}\n`);
    run(['--output', join(dir, 'pois.json'), '--batch', csv, '--grid', join(FIXTURE, 'navigation', 'nav-data.json'), '--eye-height', '1.6']);
    const [poi] = JSON.parse(readFileSync(join(dir, 'pois.json'), 'utf8')) as Array<{ approachPoint: number[] }>;
    expect(walkable(poi.approachPoint)).toBe(true);
    expect(poi.approachPoint[1]).toBe(1.6);
  });
});
