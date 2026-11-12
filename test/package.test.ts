import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

const script = new URL('../scripts/package.mjs', import.meta.url).pathname;

function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const start = off + 30 + lnlen + lxlen;
    out.set(name, inflateRawSync(buf.subarray(start, start + csize)));
    p += 46 + nlen;
  }
  return out;
}

describe('scripts/package.mjs', () => {
  const root = mkdtempSync(join(tmpdir(), 'hindsight-package-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  const js = 'export default function enable() {}\n';
  writeFileSync(join(root, 'dist', 'addon.js'), js);
  writeFileSync(join(root, 'dist', 'compact.css'), '.synthetic-button { width: 16px; }');
  writeFileSync(join(root, 'dist', 'addon.js.map'), '{}');
  writeFileSync(join(root, 'dist', 'assets', 'logo.txt'), '\u00e4\u00f6\u00fc');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ id: 'x-addon', name: 'X', version: '1.2.3', main: 'dist/addon.js' }));
  const zipPath = join(root, 'build', 'x-addon.zip');

  it('contains exactly manifest.json (with hash version) and dist/** and is reproducible', () => {
    execFileSync('node', [script, root]);
    const first = readFileSync(zipPath);
    execFileSync('node', [script, root]);
    const second = readFileSync(zipPath);
    expect(second.equals(first)).toBe(true);

    const files = readZip(first);
    expect([...files.keys()]).toEqual(['dist/addon.js', 'dist/assets/logo.txt', 'dist/compact.css', 'manifest.json']);
    expect(files.get('dist/addon.js')?.toString()).toBe(js);
    expect(files.get('dist/assets/logo.txt')?.toString()).toBe('\u00e4\u00f6\u00fc');
    expect(files.get('dist/compact.css')?.toString()).toBe('.synthetic-button { width: 16px; }');
    const manifest = JSON.parse(files.get('manifest.json')?.toString() ?? '{}') as { version: string };
    expect(manifest.version).toMatch(/^1\.2\.3\+[0-9a-f]{12}$/);
  });

  it('changes the version when code or manifest change', () => {
    const versionOf = () => {
      execFileSync('node', [script, root]);
      const m = JSON.parse(readZip(readFileSync(zipPath)).get('manifest.json')?.toString() ?? '{}') as { version: string };
      return m.version;
    };
    const manifestPath = join(root, 'manifest.json');
    const original = readFileSync(manifestPath, 'utf8');
    const v1 = versionOf();
    const changed = { ...(JSON.parse(original) as Record<string, unknown>), network: { allowedHosts: ['sdmx.oecd.org'] } };
    writeFileSync(manifestPath, JSON.stringify(changed));
    const v2 = versionOf();
    writeFileSync(join(root, 'dist', 'addon.js'), js + '\n// changed');
    const v3 = versionOf();
    writeFileSync(manifestPath, original);
    writeFileSync(join(root, 'dist', 'addon.js'), js);
    expect(new Set([v1, v2, v3]).size).toBe(3);
    expect(versionOf()).toBe(v1);
  });

  it('changes the version for changes in any installed payload asset', () => {
    const versionOf = () => {
      execFileSync('node', [script, root]);
      return JSON.parse(readZip(readFileSync(zipPath)).get('manifest.json')!.toString()).version as string;
    };
    const before = versionOf();
    writeFileSync(join(root, 'dist', 'assets', 'logo.txt'), 'updated license or asset');
    expect(versionOf()).not.toBe(before);
    writeFileSync(join(root, 'dist', 'assets', 'logo.txt'), '\u00e4\u00f6\u00fc');
    expect(versionOf()).toBe(before);
  });

  it('ships matching build sources and licenses, excluding credentials and dependencies', () => {
    const project = mkdtempSync(join(tmpdir(), 'hindsight-source-'));
    try {
      mkdirSync(join(project, 'src'));
      mkdirSync(join(project, 'dist'));
      mkdirSync(join(project, 'node_modules'));
      writeFileSync(join(project, 'src', 'index.ts'), 'export const example = 1;');
      writeFileSync(join(project, 'dist', 'addon.js'), js);
      writeFileSync(join(project, 'LICENSE'), 'synthetic license');
      writeFileSync(join(project, 'package-lock.json'), '{}');
      writeFileSync(join(project, '.env'), 'SYNTHETIC_SECRET=do-not-package');
      writeFileSync(join(project, 'node_modules', 'ignored.txt'), 'dependency install');
      // Ignored files inside the shipped directories stay out as well.
      writeFileSync(join(project, '.gitignore'), '__pycache__/\n.env.*\n*.key\n');
      writeFileSync(join(project, 'src', '.env.local'), 'SYNTHETIC_SECRET=do-not-package');
      writeFileSync(join(project, 'src', 'synthetic.key'), 'do-not-package');
      mkdirSync(join(project, 'reference', '__pycache__'), { recursive: true });
      writeFileSync(join(project, 'reference', 'oracle.py'), 'pass');
      writeFileSync(join(project, 'reference', '__pycache__', 'oracle.cpython-313.pyc'), 'cache');
      writeFileSync(join(project, 'manifest.json'), JSON.stringify({ id: 'source-test', version: '1.0.0' }));
      execFileSync('node', [script, project]);
      const files = readZip(readFileSync(join(project, 'build', 'source-test.zip')));
      const sources = readZip(files.get('dist/hindsight-source.zip')!);
      expect([...sources.keys()].sort()).toEqual(['.gitignore', 'LICENSE', 'manifest.json', 'package-lock.json', 'reference/oracle.py', 'src/index.ts']);
      expect(sources.get('src/index.ts')?.toString()).toBe('export const example = 1;');
      expect(sources.get('LICENSE')?.toString()).toBe('synthetic license');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('stays at the base version when run again on the same manifest', () => {
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ id: 'x-addon', name: 'X', version: '1.2.3+abc', main: 'dist/addon.js' }));
    execFileSync('node', [script, root]);
    const files = readZip(readFileSync(zipPath));
    const manifest = JSON.parse(files.get('manifest.json')?.toString() ?? '{}') as { version: string };
    expect(manifest.version.startsWith('1.2.3+')).toBe(true);
    expect(manifest.version).not.toContain('abc');
  });
});
