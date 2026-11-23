import corpusJson from './docs-corpus.json' with { type: 'json' };

/**
 * Bundled documentation corpus for cubibase_search_docs. Generated from the
 * website's markdown mirrors (the same content modules the HTML renders),
 * so search results always match https://cubibase.com/{path}.md.
 * Regenerate with: node scripts/sync-docs.mjs (from the monorepo root).
 */
export interface DocPage {
  path: string;
  title: string;
  url: string;
  text: string;
}

const corpus = corpusJson as DocPage[];

export interface DocHit {
  path: string;
  title: string;
  url: string;
  score: number;
  snippets: string[];
}

/**
 * Offline ranked search: AND semantics over query terms, weighted by where
 * they match (title > path > body), with short excerpts around the hits.
 */
export function searchDocs(query: string, limit = 5): { query: string; total: number; results: DocHit[] } {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
  if (terms.length === 0) return { query, total: 0, results: [] };
  const hits: DocHit[] = [];
  for (const page of corpus) {
    const title = page.title.toLowerCase();
    const path = page.path.toLowerCase();
    const text = page.text.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inPath = path.includes(term);
      const bodyCount = countOccurrences(text, term);
      if (!inTitle && !inPath && bodyCount === 0) {
        matchedAll = false;
        break;
      }
      score += (inTitle ? 10 : 0) + (inPath ? 6 : 0) + Math.min(bodyCount, 10);
    }
    if (!matchedAll) continue;
    hits.push({
      path: page.path,
      title: page.title,
      url: page.url,
      score,
      snippets: terms.flatMap((term) => excerpts(page.text, term)).slice(0, 3),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { query, total: hits.length, results: hits.slice(0, Math.max(1, Math.min(limit, 10))) };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 50) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function excerpts(text: string, term: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  let index = lower.indexOf(term);
  while (index !== -1 && out.length < 2) {
    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + term.length + 180);
    out.push(`${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`);
    index = lower.indexOf(term, index + term.length + 200);
  }
  return out;
}
