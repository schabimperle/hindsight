import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CHANGELOG.md', () => {
  it('keeps every entry on one line', () => {
    // The release workflow copies a section verbatim, and GitHub shows every newline in release notes as a break.
    // An indented line that is not a nested list item continues the line above.
    const wrapped = readFileSync('CHANGELOG.md', 'utf8')
      .split('\n')
      .filter((line) => /^\s+\S/.test(line) && !/^\s+([-*+]|\d+[.)])\s/.test(line));
    expect(wrapped).toEqual([]);
  });
});
