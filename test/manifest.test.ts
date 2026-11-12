import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_DEPENDENCIES, PERMISSION_CATEGORIES, validateManifest, type AddonManifest } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as AddonManifest;
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe('manifest.json', () => {
  it('passes the SDK validation', () => {
    const r = validateManifest(manifest);
    expect(r.errors).toEqual([]);
  });
  it('hostDependencies match the SDK requirements and are external in Vite', () => {
    expect(manifest.hostDependencies).toEqual(HOST_DEPENDENCIES);
    for (const dep of [...Object.keys(HOST_DEPENDENCIES), 'react/jsx-runtime', 'react-dom/client']) {
      expect(viteConfig).toContain(`'${dep}'`);
    }
  });
  it('allows only Yahoo and the OECD on the network', () => {
    expect(manifest.network?.allowedHosts).toEqual(['query1.finance.yahoo.com', 'sdmx.oecd.org']);
  });
  it('uses only permission categories and functions of the SDK (ctx.api.market -> market-data)', () => {
    for (const p of manifest.permissions ?? []) {
      const cat = PERMISSION_CATEGORIES.find((c) => c.id === p.category);
      expect(cat, p.category).toBeDefined();
      for (const f of p.functions) expect(cat?.functions, `${p.category}.${f.name}`).toContain(f.name);
    }
  });
  it('declares exactly the host API functions in use', () => {
    const declared = new Set(manifest.permissions?.flatMap((p) => p.functions.map((f) => `${p.category}.${f.name}`)));
    const src = files(new URL('../src/', import.meta.url).pathname)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const category = (apiName: string): string => (apiName === 'market' ? 'market-data' : apiName);
    const used = new Set(
      [...src.matchAll(/\bapi\s*\.\s*(accounts|portfolio|activities|quotes|settings|assets|market)\s*\.\s*(\w+)\(/g)].map(
        (m) => `${category(m[1])}.${m[2]}`,
      ),
    );
    // network.request goes through deps.net (ctx.api.network)
    used.add('network.request');
    // Portfolio event methods go through the listener helper's `events` argument.
    for (const m of src.matchAll(/\bevents\s*\.\s*(?:portfolio\s*\.\s*)?(on[A-Z]\w*)\(/g)) used.add(`events.${m[1]}`);
    expect([...declared].sort()).toEqual([...used].sort());
  });
});
