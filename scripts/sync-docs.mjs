#!/usr/bin/env node
/**
 * Regenerate packages/mcp/src/docs-corpus.json — the offline corpus behind
 * cubibase_search_docs. Source of truth: the website's markdown mirrors
 * (generated from the same content modules the HTML renders).
 *
 * Usage:
 *   node scripts/sync-docs.mjs                 # fetch live https://cubibase.com
 *   node scripts/sync-docs.mjs --local ../cubibase-website/dist   # from a local build
 *
 * Run after website content changes, then rebuild + republish @cubibasehq/mcp.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'packages/mcp/src/docs-corpus.json');

// Discover doc paths from the website's page catalog (source of truth;
// llms.txt is generated from the same modules but a CDN may block scripts).
const localIndex = process.argv.indexOf('--local');
const localDist = localIndex !== -1 ? process.argv[localIndex + 1] : null;
const origin = 'https://cubibase.com';
const websiteRoot = process.env.CUBIBASE_WEBSITE_DIR ?? join(root, '../cubibase-website');

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/markdown, text/plain, */*',
      'user-agent': 'cubibase-agent-sync/0.2 (+https://github.com/cubibase/cubibase-agent)',
    },
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

function readLocal(path) {
  const file = join(localDist, path === '/' ? 'index.md' : `${path.slice(1)}.md`);
  if (!existsSync(file)) throw new Error(`missing local mirror: ${file}`);
  return readFileSync(file, 'utf8');
}

// Preferred: read paths + markdown straight from the sibling website repo's
// content modules via tsx (zero network, zero drift). Fallback: live fetch.
const paths = new Set();
let useWebsiteSource = false;
if (existsSync(join(websiteRoot, 'src/lib/markdown.ts'))) {
  useWebsiteSource = true;
} else {
  const llms = localDist ? readFileSync(join(localDist, 'llms.txt'), 'utf8') : await fetchText(`${origin}/llms.txt`);
  for (const match of llms.matchAll(/https:\/\/cubibase\.com(\/[^\s)\]]*)/g)) {
    const path = match[1].replace(/\.md$/, '');
    if (path === '/llms.txt' || path === '/llms-full.txt' || path.startsWith('/.well-known') || path === '/SKILL.md') continue;
    if (path.startsWith('/docs') || path.startsWith('/features/') || path === '/pricing' || path === '/product') paths.add(path);
  }
}

const pages = [];
if (useWebsiteSource) {
  const { execFileSync } = await import('node:child_process');
  const dumpScript = `
    import { allMarkdownPages } from ${JSON.stringify(join(websiteRoot, 'src/lib/markdown.ts'))};
    const pages = allMarkdownPages()
      .filter((p) => p.path.startsWith('/docs') || p.path.startsWith('/features/') || p.path === '/pricing' || p.path === '/product')
      .map((p) => ({ path: p.path, title: p.markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? p.path, url: 'https://cubibase.com' + p.path, text: p.markdown }));
    process.stdout.write(JSON.stringify(pages));
  `;
  const json = execFileSync('npx', ['tsx', '-e', dumpScript], { cwd: websiteRoot, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  pages.push(...JSON.parse(json));
  for (const page of pages) process.stdout.write(`corpus ${page.path}\n`);
} else {
  if (paths.size < 10) throw new Error(`only ${paths.size} doc paths discovered; llms.txt format changed?`);
  for (const path of [...paths].sort()) {
    const markdown = localDist ? readLocal(path) : await fetchText(`${origin}${path}.md`);
    const title = markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? path;
    pages.push({ path, title, url: `${origin}${path}`, text: markdown });
    process.stdout.write(`corpus ${path}\n`);
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(pages, null, 0)}\n`);
process.stdout.write(`wrote ${pages.length} pages -> ${outFile}\n`);
