// `npm version` hook: copies the new version into manifest.json and dates the changelog's Unreleased section.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = readFileSync('manifest.json', 'utf8');
writeFileSync('manifest.json', manifest.replace(/"version": "[^"]*"/, `"version": "${version}"`));

const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes('\n## Unreleased\n')) throw new Error('CHANGELOG.md has no "## Unreleased" section');
const date = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', changelog.replace('\n## Unreleased\n', `\n## ${version} (${date})\n`));
