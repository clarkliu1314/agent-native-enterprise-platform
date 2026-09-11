import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  name?: string;
  private?: boolean;
  type?: string;
  main?: string;
  types?: string;
  exports?: Record<string, unknown> | string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function packageManifestPaths(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'package.json'))
    .filter(existsSync);
}

function workspacePackagePaths(): string[] {
  return [
    ...packageManifestPaths('packages'),
    ...packageManifestPaths('apps'),
    ...packageManifestPaths('packages/adapters'),
  ];
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

describe('workspace packaging contract', () => {
  it('gives every workspace package a stable root entrypoint', () => {
    for (const path of workspacePackagePaths()) {
      const manifest = readManifest(path);
      expect(manifest.name, path).toBeTruthy();
      expect(manifest.type, path).toBe('module');
      expect(manifest.main, path).toBeTruthy();
      expect(manifest.types, path).toBeTruthy();
      expect(manifest.exports, path).toMatchObject({ '.': manifest.main });
    }
  });

  it('ensures every workspace dependency resolves through an exported package root', () => {
    const manifests = new Map(
      workspacePackagePaths().map((path) => [readManifest(path).name, readManifest(path)]),
    );

    for (const [path, manifest] of workspacePackagePaths().map((path) => [path, readManifest(path)] as const)) {
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
      };

      for (const [dependency, version] of Object.entries(dependencies)) {
        if (version !== 'workspace:*') continue;
        const target = manifests.get(dependency);
        expect(target, `${path} -> ${dependency}`).toBeTruthy();
        expect(target?.exports, `${path} -> ${dependency}`).toMatchObject({ '.': target?.main });
      }
    }
  });
});
