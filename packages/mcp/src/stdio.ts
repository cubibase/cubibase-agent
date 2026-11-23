#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCubiBaseMcpServer } from './index.js';

/**
 * stdio entry point for MCP clients (Claude Desktop, Cursor, Codex, ...).
 *
 * Configuration via environment:
 *   CUBIBASE_TOKEN        required — personal access token (cb_pat_...)
 *   CUBIBASE_API_URL      optional — default https://api.cubibase.com
 *   CUBIBASE_SERVICE_KEY  optional — project secret key (cb_sec_...) for
 *                         Data API tools (service actor; RLS applies)
 */
const token = process.env.CUBIBASE_TOKEN;
if (!token) {
  console.error(
    'CUBIBASE_TOKEN is required. Create a personal access token in the CubiBase console (Account -> Access tokens) and set it in the MCP server env.',
  );
  process.exit(1);
}

const server = createCubiBaseMcpServer({
  token,
  baseUrl: process.env.CUBIBASE_API_URL,
  serviceKey: process.env.CUBIBASE_SERVICE_KEY,
});

await server.connect(new StdioServerTransport());
