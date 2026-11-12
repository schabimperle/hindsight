import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Wealthfolio provides the host dependencies (manifest.hostDependencies); they are not bundled.
const external = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@tanstack/react-query',
  '@wealthfolio/ui',
  '@wealthfolio/addon-sdk',
  'recharts',
  'date-fns',
  'lucide-react',
];

export default defineConfig({
  plugins: [react(), {
    name: 'compact-style-check',
    writeBundle(_options, bundle) {
      const hasCompactStyles = Object.values(bundle).some((file) => {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) return false;
        const css = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        return css.includes('.hindsight-compact-icon');
      });
      if (!hasCompactStyles) this.error('The build must include the compact control stylesheet.');
    },
  }, {
    name: 'addon-license-notices',
    generateBundle() {
      for (const [fileName, sourcePath] of [
        ['hindsight-LICENSE.txt', './LICENSE'],
        ['wealthfolio-LICENSE.txt', './LICENSES/AGPL-3.0-only.txt'],
        ['THIRD_PARTY_NOTICES.md', './THIRD_PARTY_NOTICES.md'],
      ]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(sourcePath, import.meta.url), 'utf8') });
      }
      const packages = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        if (!id.includes('/node_modules/')) continue;
        let dir = dirname(id.split('?')[0]);
        while (dir !== dirname(dir) && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
        if (packages.has(dir) || !existsSync(join(dir, 'package.json'))) continue;
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string };
        const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'].find((name) => existsSync(join(dir, name)));
        if (!license) this.error(`Missing bundled dependency license: ${pkg.name}`);
        packages.set(dir, `${pkg.name}@${pkg.version}\n${readFileSync(join(dir, license!), 'utf8')}`);
      }
      this.emitFile({
        type: 'asset', fileName: 'third-party-NOTICES.txt',
        source: [...packages.values()].sort().join('\n\n---\n\n'),
      });
    },
  }],
  build: {
    lib: { entry: 'src/index.tsx', fileName: () => 'addon.js', formats: ['es'] },
    outDir: 'dist',
    emptyOutDir: true,
    target: ['chrome107', 'firefox104', 'safari16'],
    sourcemap: false,
    minify: false,
    rollupOptions: { external },
  },
  test: { include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
});
