// Packs manifest.json and the complete licensed payload into build/<id>.zip.
// Deterministic: fixed timestamps, sorted entries, nothing random.
// Node builtins plus `ignore` (the .gitignore matcher eslint and prettier use).
// Usage: node scripts/package.mjs [project directory]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import ignore from 'ignore';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

/** entries: [{ name, data: Buffer }] -> ZIP bytes (deflate, entries in list order). */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 file names
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // external attrs: regular file 0644
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else if (!name.endsWith('.map')) out.push(rel);
  }
  return out;
}

export function packageAddon(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  // Include only project sources, never ignored workspace data or credentials.
  const sourcePaths = [
    'src', 'scripts', 'reference', 'test', 'docs', 'LICENSES', '.github',
    'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md',
    'CHANGELOG.md', 'package.json', 'package-lock.json', 'manifest.json',
    'vite.config.ts', 'tsconfig.json', '.gitignore', '.node-version',
  ];
  if (existsSync(join(root, 'src'))) {
    // Inside the listed directories the .gitignore decides, so a local credential, log or cache that git would not
    // take (e.g. src/.env.local, reference/__pycache__/) never reaches the ZIP. Not `git ls-files`: the Docker build
    // has no .git.
    const gitignore = join(root, '.gitignore');
    const ignored = ignore().add(existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '');
    const sources = sourcePaths.flatMap((rel) => {
      const full = join(root, rel);
      if (!existsSync(full)) return [];
      const names = statSync(full).isDirectory() ? listFiles(full).map((name) => `${rel}/${name}`) : [rel];
      // README images are not source; they would only bloat every install.
      return names.filter((name) => !ignored.ignores(name) && !name.endsWith('.png')).map((name) => ({ name, data: readFileSync(join(root, name)) }));
    });
    sources.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    writeFileSync(join(root, 'dist/hindsight-source.zip'), zip(sources));
  }
  const payload = listFiles(join(root, 'dist')).sort().map((rel) => ({
    name: `dist/${rel}`, data: readFileSync(join(root, 'dist', rel)),
  }));
  // Length-delimited paths and bytes cover every installed asset, including licenses and sources.
  const digest = createHash('sha256').update(JSON.stringify({ ...manifest, version: undefined }));
  for (const { name, data } of payload) {
    digest.update(JSON.stringify([name, data.length])).update(data);
  }
  const hash = digest.digest('hex').slice(0, 12);
  const baseVersion = String(manifest.version).split('+')[0];
  manifest.version = `${baseVersion}+${hash}`;
  const entries = [
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...payload,
  ];
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const outFile = join(root, 'build', `${manifest.id}.zip`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip(entries));
  return { outFile, version: manifest.version, entries: entries.map((e) => e.name) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const r = packageAddon(root);
  console.log(`${r.outFile}\n  version ${r.version}\n  ${r.entries.join('\n  ')}`);
}
