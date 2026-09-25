// Summarises a `npm run analyze` build as Markdown: what a first visit
// downloads, the biggest lazy chunks, and which packages the entry chunk is
// made of. Reads the visualizer's raw data (bundle-stats/stats.json) and the
// built files themselves, and writes bundle-stats/summary.md.
//
// Chunk sizes are measured on the built files (gzip level 9, as a CDN would
// serve them). Package sizes are each module's rendered length, which the
// visualizer records before minification: good for shares, not for bytes on
// the wire (a per-module gzip figure would not add up to anything real either).

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const stats = JSON.parse(readFileSync(new URL('../bundle-stats/stats.json', import.meta.url)));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const fileSizes = (file) => {
  const bytes = readFileSync(new URL(file, dist));
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
};

// What the landing page loads before anything is lazy-loaded: the entry
// script, its preloaded imports and the stylesheet, as index.html names them.
const html = readFileSync(new URL('index.html', dist), 'utf8');
const firstLoad = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(
  (match) => match[1],
);
const entry = firstLoad.find((file) => /assets\/index-.+\.js$/.test(file));

function packageOf(id) {
  const path = id.replaceAll('\\', '/');
  const at = path.lastIndexOf('node_modules/');
  if (at !== -1) {
    const [scope, name] = path.slice(at + 'node_modules/'.length).split('/');
    return scope.startsWith('@') ? `${scope}/${name}` : scope;
  }
  if (path.includes('/shared/')) return '@intellmeet/shared (zod schemas)';
  if (path.includes('/client/src/')) return 'app code (client/src)';
  return 'bundler runtime';
}

// Minified bytes per chunk, per package.
const byChunk = new Map();
for (const meta of Object.values(stats.nodeMetas)) {
  for (const [chunk, partUid] of Object.entries(meta.moduleParts)) {
    const part = stats.nodeParts[partUid];
    const packages = byChunk.get(chunk) ?? new Map();
    const name = packageOf(meta.id);
    packages.set(name, (packages.get(name) ?? 0) + part.renderedLength);
    byChunk.set(chunk, packages);
  }
}

const lines = [
  '## First load (the landing page)',
  '',
  '| File | Minified | Gzip |',
  '| --- | ---: | ---: |',
];
let total = { raw: 0, gzip: 0 };
for (const file of firstLoad) {
  const size = fileSizes(file);
  total = { raw: total.raw + size.raw, gzip: total.gzip + size.gzip };
  lines.push(`| \`${file}\` | ${kb(size.raw)} | ${kb(size.gzip)} |`);
}
lines.push(`| **Total** | **${kb(total.raw)}** | **${kb(total.gzip)}** |`, '');

lines.push('## Largest lazy chunks', '', '| Chunk | Minified | Gzip |', '| --- | ---: | ---: |');
const lazy = [...byChunk.keys()]
  .filter((chunk) => chunk.endsWith('.js') && !firstLoad.includes(chunk))
  .map((chunk) => ({ chunk, ...fileSizes(chunk) }))
  .sort((a, b) => b.raw - a.raw)
  .slice(0, 8);
for (const { chunk, raw, gzip } of lazy) lines.push(`| \`${chunk}\` | ${kb(raw)} | ${kb(gzip)} |`);
lines.push('');

if (entry) {
  const packages = [...(byChunk.get(entry) ?? new Map())].sort((a, b) => b[1] - a[1]);
  const sum = packages.reduce((acc, [, bytes]) => acc + bytes, 0);
  lines.push(`## What the entry chunk is made of (\`${entry}\`)`, '');
  lines.push('| Package | Rendered, before minification | Share |', '| --- | ---: | ---: |');
  for (const [name, bytes] of packages.slice(0, 15)) {
    lines.push(`| ${name} | ${kb(bytes)} | ${((100 * bytes) / sum).toFixed(1)}% |`);
  }
  const rest = packages.slice(15).reduce((acc, [, bytes]) => acc + bytes, 0);
  if (rest > 0)
    lines.push(
      `| ${packages.length - 15} others | ${kb(rest)} | ${((100 * rest) / sum).toFixed(1)}% |`,
    );
  lines.push('');
}

const markdown = lines.join('\n');
writeFileSync(new URL('../bundle-stats/summary.md', import.meta.url), markdown);
console.log(markdown);
