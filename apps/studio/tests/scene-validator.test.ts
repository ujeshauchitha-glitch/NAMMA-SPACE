/**
 * Workstream D3 · Python validator contract.
 *
 * scripts/validate_scene.py must enforce the same URI/integrity policy as the
 * browser loader (src/lib/sceneLoader.ts) and reject the same dead-field
 * promises the zod schema rejects (identity transform only, no collision
 * asset). Each scenario copies the shipped fixture, mutates one aspect and
 * asserts the validator's exit code and message; the shipped fixture itself
 * must keep passing.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts');
const VALIDATOR = join(SCRIPTS_DIR, 'validate_scene.py');
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scenes/fixture');
const GLB_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scenes/glb-fixture');

const tempDirs: string[] = [];

afterAll(() => {
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

type ValidatorRun = { status: number; output: string };

function runValidator(mutate: (sceneDir: string) => void, source: string = FIXTURE): ValidatorRun {
  const sceneDir = mkdtempSync(join(tmpdir(), 'scene-validator-'));
  tempDirs.push(sceneDir);
  cpSync(source, sceneDir, { recursive: true });
  mutate(sceneDir);
  try {
    const output = execFileSync('python3', [VALIDATOR, sceneDir], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function editManifest(sceneDir: string, mutate: (manifest: Record<string, unknown>) => void): void {
  const path = join(sceneDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
}

describe('validate_scene.py dead-field contract (D2)', () => {
  it('accepts the shipped fixture unchanged', () => {
    const run = runValidator(() => undefined);
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('PASS');
  });

  it('rejects a non-identity worldFromReconstruction', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.worldFromReconstruction = [[1, 0, 0, 2], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('worldFromReconstruction must be the identity matrix');
  });

  it('rejects a rotation inside worldFromReconstruction', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.worldFromReconstruction = [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('identity matrix');
  });

  it('rejects a missing worldFromReconstruction key', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      delete manifest.worldFromReconstruction;
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('worldFromReconstruction');
  });

  it('rejects a non-null collisionAsset the viewer would never load', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.collisionAsset = { kind: 'glb', uri: 'geometry/collision.glb' };
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('collisionAsset is not supported');
  });

  it('rejects a missing collisionAsset key', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      delete manifest.collisionAsset;
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('collisionAsset');
  });
});

describe('validate_scene.py URI policy (D3, mirrors sceneLoader.ts)', () => {
  it('rejects a cross-origin visual asset URI', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.visualAssets = [{ kind: 'glb', uri: 'https://cdn.example.com/scene.glb' }];
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('bundle-relative');
  });

  it('rejects an absolute semanticUri', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.semanticUri = '/etc/pois.json';
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('bundle-relative');
  });

  it('rejects a traversal qualityUri', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.qualityUri = '../shared/report.json';
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('bundle-relative');
  });

  it('rejects a traversal navigationUri', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.navigationUri = '../shared/nav.json';
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('bundle-relative');
  });

  it('rejects an unknown visual asset kind', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.visualAssets = [{ kind: 'ply', uri: 'visual/scene.ply' }];
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('unsupported visual asset kind');
  });

  it('requires procedural assets to declare a procedural:// URI', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      manifest.visualAssets = [{ kind: 'procedural', uri: 'visual/scene.glb' }];
    }));
    expect(run.status).toBe(1);
    expect(run.output).toContain('procedural://');
  });

  it('rejects an oversized scene document before parsing it', () => {
    const run = runValidator((dir) => {
      const qualityPath = join(dir, 'quality/report.json');
      const quality = JSON.parse(readFileSync(qualityPath, 'utf8')) as Record<string, unknown>;
      quality.padding = 'x'.repeat(33 * 1024 * 1024);
      writeFileSync(qualityPath, JSON.stringify(quality), 'utf8');
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain('MiB');
  });
});

describe('validate_scene.py integrity policy (D3, mirrors sceneLoader.ts)', () => {
  // The GLB fixture is the shipped bundle that actually declares a digest.
  it('rejects a malformed sha256 digest', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      const assets = manifest.visualAssets as Array<Record<string, unknown>>;
      assets[0].sha256 = 'NOT-A-DIGEST';
    }), GLB_FIXTURE);
    expect(run.status).toBe(1);
    expect(run.output).toContain('malformed sha256');
  });

  it('rejects a digest that does not match the shipped bytes', () => {
    const run = runValidator((dir) => editManifest(dir, (manifest) => {
      const assets = manifest.visualAssets as Array<Record<string, unknown>>;
      assets[0].sha256 = '0'.repeat(64);
    }), GLB_FIXTURE);
    expect(run.status).toBe(1);
    expect(run.output).toContain('hash mismatch');
  });

  it('still passes when declared digests match the shipped bytes', () => {
    const run = runValidator(() => undefined, GLB_FIXTURE);
    expect(run.status, run.output).toBe(0);
  });
});
