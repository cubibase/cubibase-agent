import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CubiBaseError, ControlClient, DataClient, toCubiBaseError } from '@cubibase/client';
import { createCubiBaseMcpServer } from '@cubibase/mcp';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('client errors', () => {
  test('parses the engine error envelope and Retry-After', () => {
    const headers = new Headers({ 'retry-after': '7' });
    const err = toCubiBaseError(429, { error: { code: 'rate_limited', message: 'Too many requests', requestId: 'r1' } }, headers);
    expect(err).toBeInstanceOf(CubiBaseError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(7);
    expect(err.retryable).toBe(true);
    expect(err.requestId).toBe('r1');
  });

  test('non-json bodies still produce a structured error', () => {
    const err = toCubiBaseError(502, null);
    expect(err.code).toBe('http_error');
    expect(err.status).toBe(502);
  });
});

describe('ControlClient', () => {
  test('sends bearer auth and parses envelopes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ projects: [{ id: 'p1', slug: 'demo' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new ControlClient({ baseUrl: 'https://api.example.com', token: 'cb_pat_test', fetchImpl });
    const result = await client.listProjects();
    expect(result.projects[0]!.id).toBe('p1');
    expect(calls[0]!.url).toBe('https://api.example.com/v1/projects');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer cb_pat_test');
  });

  test('error responses throw CubiBaseError with the engine code', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'invalid_token', message: 'expired' } }), { status: 401 });
    const client = new ControlClient({ token: 'cb_pat_x', fetchImpl });
    await expect(client.listProjects()).rejects.toMatchObject({ code: 'invalid_token', status: 401 });
  });
});

describe('DataClient', () => {
  test('unwraps the data envelope and sends apikey + filters', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ data: [{ id: 'r1' }] }), { status: 200 });
    };
    const data = new DataClient({
      baseUrl: 'https://demo.api.example.com',
      publishableKey: 'cb_pub_x',
      token: 'cb_sec_y',
      fetchImpl,
    });
    const rows = await data.list('notes', { limit: 5, filters: { status: 'eq.active' } });
    expect(rows).toEqual([{ id: 'r1' }]);
    expect(seenUrl).toContain('/rest/v1/notes?');
    expect(seenUrl).toContain('status=eq.active');
    expect(seenHeaders.apikey).toBe('cb_pub_x');
    expect(seenHeaders.authorization).toBe('Bearer cb_sec_y');
  });
});

describe('MCP server', () => {
  test('lists tools and returns structured errors over an in-memory transport', async () => {
    const server = createCubiBaseMcpServer({ token: 'cb_pat_invalid', baseUrl: 'http://127.0.0.1:1' });
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain('cubibase_list_projects');
    expect(names).toContain('cubibase_create_table');
    expect(names).toContain('cubibase_run_sql');
    expect(names).toContain('cubibase_data_openapi');
    // Unreachable engine -> structured error result, not a protocol crash.
    const result = await client.callTool({ name: 'cubibase_list_projects', arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
    await server.close();
  });

  test('stdio binary completes an MCP handshake and lists tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [new URL('../packages/mcp/dist/stdio.js', import.meta.url).pathname],
      env: { ...process.env, CUBIBASE_TOKEN: 'cb_pat_smoke' },
    });
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(15);
    await client.close();
  }, 20_000);
});
