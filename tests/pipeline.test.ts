import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reconstruction preflight', () => {
  it('returns structured tool availability without requiring a GPU', () => {
    const output = execFileSync('python3', ['scripts/reconstruct_colmap.py', 'preflight', '--json'], { encoding: 'utf8' });
    const report = JSON.parse(output) as { tools: Record<string, { available: boolean; detail: string }> };
    expect(report.tools.colmap).toHaveProperty('available');
    expect(report.tools.ffmpeg).toHaveProperty('available');
    expect(report.tools['nvidia-smi']).toHaveProperty('available');
  });

  it('creates a provenance and quality report for image-folder ingest', () => {
    const root = mkdtempSync(join(tmpdir(), 'namma-capture-test-'));
    const input = join(root, 'input');
    const output = join(root, 'output');
    mkdirSync(input);
    writeFileSync(join(input, 'frame.jpg'), Buffer.from('synthetic-test-frame'));
    execFileSync('python3', ['scripts/prepare_capture.py', input, '--output', output], { encoding: 'utf8' });
    const manifest = JSON.parse(readFileSync(join(output, 'frame-manifest.json'), 'utf8')) as { frames: unknown[]; quality: { status: string; notMeasured: string[] } };
    expect(manifest.frames).toHaveLength(1);
    expect(manifest.quality.status).toBe('warning');
    expect(manifest.quality.notMeasured).toContain('blur');
  });

  it('blocks reconstruction without COLMAP while preserving a report', () => {
    const root = mkdtempSync(join(tmpdir(), 'namma-colmap-test-'));
    const frames = join(root, 'frames');
    const output = join(root, 'output');
    mkdirSync(frames);
    writeFileSync(join(frames, 'frame.jpg'), Buffer.from('synthetic-test-frame'));
    let exitCode = 0;
    try {
      execFileSync('python3', ['scripts/reconstruct_colmap.py', 'run', '--frames', frames, '--output', output], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      exitCode = (error as { status?: number }).status ?? 0;
    }
    expect(exitCode).toBe(3);
    const report = JSON.parse(readFileSync(join(output, 'reconstruction-report.json'), 'utf8')) as { status: string; blocker: string };
    expect(report.status).toBe('blocked');
    expect(report.blocker).toContain('COLMAP');
  });

  it('records dense and meshing stages when a compatible COLMAP executable is supplied', () => {
    const root = mkdtempSync(join(tmpdir(), 'namma-fake-colmap-'));
    const bin = join(root, 'bin');
    const frames = join(root, 'frames');
    const output = join(root, 'output');
    mkdirSync(bin);
    mkdirSync(frames);
    writeFileSync(join(frames, 'frame.jpg'), Buffer.from('synthetic-test-frame'));
    const fakeColmap = join(bin, 'colmap');
    writeFileSync(fakeColmap, `#!/usr/bin/env python3
import pathlib, sys
args = sys.argv[1:]
def value(flag):
    return pathlib.Path(args[args.index(flag) + 1])
stage = args[0]
if stage == 'mapper':
    out = value('--output_path') / '0'; out.mkdir(parents=True, exist_ok=True)
    for name in ('cameras.bin', 'images.bin', 'points3D.bin'): (out / name).write_bytes(b'fixture')
elif stage == 'image_undistorter':
    out = value('--output_path'); (out / 'images').mkdir(parents=True, exist_ok=True); (out / 'sparse').mkdir(parents=True, exist_ok=True)
elif stage == 'patch_match_stereo':
    (value('--workspace_path') / 'stereo').mkdir(parents=True, exist_ok=True)
elif stage == 'stereo_fusion':
    out = value('--output_path'); out.write_text('ply\\nformat ascii 1.0\\nelement vertex 1\\nproperty float x\\nproperty float y\\nproperty float z\\nelement face 0\\nproperty list uchar int vertex_indices\\nend_header\\n0 0 0\\n')
elif stage in ('poisson_mesher', 'delaunay_mesher'):
    out = value('--output_path'); out.write_text('ply\\nformat ascii 1.0\\nelement vertex 3\\nproperty float x\\nproperty float y\\nproperty float z\\nelement face 1\\nproperty list uchar int vertex_indices\\nend_header\\n0 0 0\\n1 0 0\\n0 1 0\\n3 0 1 2\\n')
sys.exit(0)
`, 'utf8');
    chmodSync(fakeColmap, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
    execFileSync('python3', ['scripts/reconstruct_colmap.py', 'run', '--frames', frames, '--output', output, '--mesh'], { encoding: 'utf8', env });
    const report = JSON.parse(readFileSync(join(output, 'reconstruction-report.json'), 'utf8')) as { status: string; stages: Array<{ stage: string; status: string }> };
    expect(report.status).toBe('mesh-ready');
    expect(report.stages.map((stage) => stage.stage)).toEqual(['feature_extraction', 'feature_matching', 'sparse_mapping', 'image_undistortion', 'patch_match_stereo', 'stereo_fusion', 'poisson_meshing']);
    expect(report.stages.every((stage) => stage.status === 'passed')).toBe(true);
  });

  it('generates a visual-only reconstructed bundle when navigation is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'namma-bundle-test-'));
    const output = join(root, 'scene');
    const visual = join(root, 'fixture.glb');
    const semantic = join(root, 'pois.json');
    const geometry = join(root, 'geometry.json');
    copyFileSync('public/scenes/glb-fixture/visual/architectural-fixture.glb', visual);
    copyFileSync('public/scenes/glb-fixture/semantic/pois.json', semantic);
    writeFileSync(geometry, JSON.stringify({ bounds: { min: [-1, 0, -1], max: [1, 2, 1] } }));
    execFileSync('python3', ['scripts/generate_scene_bundle.py', '--output', output, '--visual-asset', visual, '--geometry-report', geometry, '--semantic', semantic, '--scene-id', 'generated-test', '--display-name', 'Generated test', '--source', 'test capture'], { encoding: 'utf8' });
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as { navigationUri: string | null; sceneKind: string; scaleStatus: string };
    expect(manifest).toMatchObject({ navigationUri: null, sceneKind: 'reconstructed-capture', scaleStatus: 'unknown' });
    const validation = execFileSync('python3', ['scripts/validate_scene.py', output], { encoding: 'utf8' });
    expect(validation).toContain('needs-review');
  });
});
