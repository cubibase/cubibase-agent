#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCubiBaseMcpServer, FEATURE_GROUPS, type FeatureGroup } from './index.js';

/**
 * stdio entry point for MCP clients (Claude Desktop, Cursor, Codex, ...).
 *
 * Configuration via environment:
 *   CUBIBASE_TOKEN        required — personal access token (cb_pat_...)
 *   CUBIBASE_API_URL      optional — default https://api.cubibase.com
 *   CUBIBASE_SERVICE_KEY  optional — project secret key (cb_sec_...) for
 *                         Data API tools (service actor; RLS applies)
 *   CUBIBASE_READ_ONLY    optional — "1"/"true" hides every mutating tool
 *   CUBIBASE_FEATURES     optional — comma-separated tool groups to expose:
 *                         projects,database,storage,functions,data,observability,docs
 */
const token = process.env.CUBIBASE_TOKEN;
if (!token) {
  console.error(
    'CUBIBASE_TOKEN is required. Create a personal access token in the CubiBase console (Account -> Access tokens) and set it in the MCP server env.',
  );
  process.exit(1);
}

const readOnlyRaw = (process.env.CUBIBASE_READ_ONLY ?? '').toLowerCase();
const readOnly = readOnlyRaw === '1' || readOnlyRaw === 'true' || readOnlyRaw === 'yes';

let features: FeatureGroup[] | undefined;
if (process.env.CUBIBASE_FEATURES) {
  const requested = process.env.CUBIBASE_FEATURES.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  const invalid = requested.filter((part) => !FEATURE_GROUPS.includes(part as FeatureGroup));
  if (invalid.length > 0) {
    console.error(`CUBIBASE_FEATURES contains unknown groups: ${invalid.join(', ')}. Valid: ${FEATURE_GROUPS.join(', ')}`);
    process.exit(1);
  }
  features = requested as FeatureGroup[];
}

const server = createCubiBaseMcpServer({
  token,
  baseUrl: process.env.CUBIBASE_API_URL,
  serviceKey: process.env.CUBIBASE_SERVICE_KEY,
  readOnly,
  ...(features ? { features } : {}),
});

await server.connect(new StdioServerTransport());
