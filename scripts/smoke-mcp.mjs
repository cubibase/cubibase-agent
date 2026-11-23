import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCubiBaseMcpServer } from '@cubibasehq/mcp';

async function toolsOf(options) {
  const server = createCubiBaseMcpServer({ token: 'cb_pat_x', baseUrl: 'http://127.0.0.1:1', ...options });
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  return { client, server, tools };
}

const full = await toolsOf({});
console.log('FULL:', full.tools.length);
console.log(full.tools.join(' '));

const ro = await toolsOf({ readOnly: true });
console.log('\nREAD-ONLY:', ro.tools.length);
const writes = ro.tools.filter((n) => /create|update|delete|drop|insert|deploy|upload|set_|revoke|activate|test_function|refresh|complete/.test(n));
console.log('write-ish tools leaked into read-only:', writes);

const feat = await toolsOf({ features: ['storage', 'docs'] });
console.log('\nSTORAGE+DOCS:', feat.tools.length, feat.tools.join(' '));

const search = await full.client.callTool({ name: 'cubibase_search_docs', arguments: { query: 'signed url download', limit: 3 } });
console.log('\nSEARCH signed url download:');
console.log(search.content[0].text.slice(0, 1200));

for (const s of [full, ro, feat]) { await s.client.close(); await s.server.close(); }
