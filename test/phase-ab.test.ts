import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ControlClient } from '@cubibasehq/client';
import { createCubiBaseMcpServer, FEATURE_GROUPS } from '@cubibasehq/mcp';

/** Fetch stub that records calls and answers with canned JSON per path fragment. */
function stubFetch(routes: Array<{ match: string | RegExp; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    const route = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!route) return new Response(JSON.stringify({ error: { code: 'not_stubbed', message: url } }), { status: 599 });
    const status = route.status ?? 200;
    if (status === 204 || route.body === null) return new Response(null, { status });
    return new Response(JSON.stringify(route.body), { status });
  };
  return { calls, fetchImpl };
}

describe('ControlClient storage', () => {
  test('bucket CRUD hits the console storage routes', async () => {
    const { calls, fetchImpl } = stubFetch([
      { match: '/storage/buckets', body: { buckets: [] } },
    ]);
    const client = new ControlClient({ baseUrl: 'https://api.example.com', token: 't', fetchImpl });
    await client.listBuckets('p1');
    await client.createBucket('p1', { name: 'avatars', public: true });
    await client.updateBucket('p1', 'avatars', { public: false });
    await client.deleteBucket('p1', 'avatars');
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /v1/projects/p1/storage/buckets',
      'POST /v1/projects/p1/storage/buckets',
      'PATCH /v1/projects/p1/storage/buckets/avatars',
      'DELETE /v1/projects/p1/storage/buckets/avatars',
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ name: 'avatars', public: true });
  });

  test('uploadFile: reserve -> presigned POST (fields + Content-Type + file) -> complete', async () => {
    const { calls, fetchImpl } = stubFetch([
      { match: '/storage/uploads/u1/complete', body: { uploadId: 'u1', status: 'completed' } },
      { match: '/storage/uploads', body: {
        uploadId: 'u1', objectId: 'o1', bucket: 'docs', path: 'a.txt',
        upload: { url: 'https://s3.example.com/up', fields: { key: 'staging/x', policy: 'p' }, key: 'staging/x', method: 'POST' },
        expiresAt: '2026-01-01T00:00:00Z', completeUrl: '/storage/v1/uploads/u1/complete',
      } },
      { match: 's3.example.com/up', status: 204, body: null },
    ]);
    const client = new ControlClient({ baseUrl: 'https://api.example.com', token: 't', fetchImpl });
    const result = await client.uploadFile('p1', { bucket: 'docs', path: 'a.txt', content: 'hello', mimeType: 'text/plain' });
    expect(result).toMatchObject({ objectId: 'o1', bucket: 'docs', path: 'a.txt', sizeBytes: 5 });
    // 1: reserve with exact size
    const reserve = JSON.parse(calls[0]!.body!);
    expect(reserve).toMatchObject({ bucket: 'docs', path: 'a.txt', sizeBytes: 5, mimeType: 'text/plain' });
    // 2: S3 POST is multipart, not JSON
    expect(calls[1]!.url).toBe('https://s3.example.com/up');
    expect(calls[1]!.method).toBe('POST');
    expect(calls[1]!.body).toBeUndefined();
    // 3: complete
    expect(calls[2]!.url).toContain('/v1/projects/p1/storage/uploads/u1/complete');
  });

  test('signObjectUrl posts expiresIn and returns the link', async () => {
    const { calls, fetchImpl } = stubFetch([
      { match: '/sign', body: { public: false, url: 'https://x/content?token=t', expiresAt: '2026-01-01T00:05:00Z' } },
    ]);
    const client = new ControlClient({ token: 't', fetchImpl });
    const link = await client.signObjectUrl('p1', 'o1', 300);
    expect(link.public).toBe(false);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ expiresIn: 300 });
  });
});

describe('ControlClient functions', () => {
  test('create -> deploy -> secret -> trigger -> test flow', async () => {
    const { calls, fetchImpl } = stubFetch([{ match: '/functions', body: { id: 'f1' } }]);
    const client = new ControlClient({ baseUrl: 'https://api.example.com', token: 't', fetchImpl });
    await client.createFunction('p1', { name: 'hello', sourceCode: 'export default () => new Response("hi")' });
    await client.deployFunction('p1', 'hello');
    await client.setFunctionSecret('p1', 'hello', 'API_KEY', 's3cret');
    await client.createFunctionTrigger('p1', 'hello', { kind: 'schedule', config: { cron: '0 * * * *' } });
    await client.testFunction('p1', 'hello', { method: 'POST', body: '{}' });
    await client.functionExecutions('p1', { status: 'error', limit: 10 });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /v1/projects/p1/functions',
      'POST /v1/projects/p1/functions/hello/deployments',
      'POST /v1/projects/p1/functions/hello/secrets',
      'POST /v1/projects/p1/functions/hello/triggers',
      'POST /v1/projects/p1/functions/hello/test',
      'GET /v1/projects/p1/functions/executions',
    ]);
    expect(new URL(calls[5]!.url).searchParams.get('status')).toBe('error');
  });
});

describe('ControlClient schema extras', () => {
  test('rows update/delete, columns, triggers, indexes, types, views, project update', async () => {
    const { calls, fetchImpl } = stubFetch([{ match: '/v1/', body: { ok: true } }]);
    const client = new ControlClient({ baseUrl: 'https://api.example.com', token: 't', fetchImpl });
    await client.updateRow('p1', 'notes', 'r1', { title: 'x' });
    await client.deleteRow('p1', 'notes', 'r1');
    await client.addColumn('p1', 'notes', { name: 'tag', type: 'text', nullable: true });
    await client.dropColumn('p1', 'notes', 'tag');
    await client.createDbTrigger('p1', { table: 'notes', name: 'audit', events: ['INSERT'], function: 'audit_fn' });
    await client.createIndex('p1', { table: 'notes', name: 'notes_title_idx', columns: [{ column: 'title' }] });
    await client.createEnumType('p1', { name: 'mood', labels: ['happy', 'sad'] });
    await client.createView('p1', { name: 'recent', query: 'SELECT * FROM notes', apiSelect: true });
    await client.updateProject('p1', { name: 'Renamed' });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'PATCH /v1/projects/p1/tables/notes/rows/r1',
      'DELETE /v1/projects/p1/tables/notes/rows/r1',
      'POST /v1/projects/p1/tables/notes/columns',
      'DELETE /v1/projects/p1/tables/notes/columns/tag',
      'POST /v1/projects/p1/db-triggers',
      'POST /v1/projects/p1/indexes',
      'POST /v1/projects/p1/types/enum',
      'POST /v1/projects/p1/views',
      'PATCH /v1/projects/p1',
    ]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ values: { title: 'x' } });
  });
});

async function connect(options: Parameters<typeof createCubiBaseMcpServer>[0]) {
  const server = createCubiBaseMcpServer(options);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

describe('MCP feature groups and read-only mode', () => {
  test('full surface includes storage, functions, schema extras, and docs search', async () => {
    const { client, server } = await connect({ token: 't', baseUrl: 'http://127.0.0.1:1' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const expected of [
      'cubibase_upload_file', 'cubibase_create_bucket', 'cubibase_sign_object_url',
      'cubibase_create_function', 'cubibase_deploy_function', 'cubibase_set_function_secret',
      'cubibase_create_db_trigger', 'cubibase_create_index', 'cubibase_create_enum_type', 'cubibase_create_view',
      'cubibase_update_row', 'cubibase_delete_row', 'cubibase_add_column', 'cubibase_update_project',
      'cubibase_search_docs',
    ]) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBeGreaterThanOrEqual(70);
    await client.close(); await server.close();
  });

  test('read-only mode registers no mutating tools', async () => {
    const { client, server } = await connect({ token: 't', baseUrl: 'http://127.0.0.1:1', readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const banned of [
      'cubibase_create_project', 'cubibase_delete_project', 'cubibase_create_table', 'cubibase_insert_row',
      'cubibase_update_row', 'cubibase_delete_row', 'cubibase_upload_file', 'cubibase_create_bucket',
      'cubibase_create_function', 'cubibase_deploy_function', 'cubibase_set_function_secret',
      'cubibase_create_api_key', 'cubibase_data_rpc', 'cubibase_test_function',
    ]) {
      expect(names).not.toContain(banned);
    }
    // Reads survive.
    for (const kept of ['cubibase_list_projects', 'cubibase_list_rows', 'cubibase_run_sql', 'cubibase_list_buckets', 'cubibase_search_docs']) {
      expect(names).toContain(kept);
    }
    await client.close(); await server.close();
  });

  test('feature groups restrict the tool list', async () => {
    const { client, server } = await connect({ token: 't', baseUrl: 'http://127.0.0.1:1', features: ['storage', 'docs'] });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.every((n) => n.startsWith('cubibase_'))).toBe(true);
    expect(names).toContain('cubibase_list_buckets');
    expect(names).toContain('cubibase_search_docs');
    expect(names).not.toContain('cubibase_list_projects');
    expect(names).not.toContain('cubibase_create_function');
    expect(names.length).toBe(12);
    await client.close(); await server.close();
  });

  test('FEATURE_GROUPS export covers every group used', () => {
    expect(FEATURE_GROUPS).toEqual(['projects', 'database', 'storage', 'functions', 'data', 'observability', 'docs']);
  });
});

describe('cubibase_search_docs', () => {
  test('ranks relevant pages and returns excerpts + URLs', async () => {
    const { client, server } = await connect({ token: 't', baseUrl: 'http://127.0.0.1:1' });
    const result = await client.callTool({ name: 'cubibase_search_docs', arguments: { query: 'signed url', limit: 3 } });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.total).toBeGreaterThan(0);
    expect(payload.results.length).toBeLessThanOrEqual(3);
    expect(payload.results[0].url).toMatch(/^https:\/\/cubibase\.com\//);
    expect(payload.results[0].snippets.length).toBeGreaterThan(0);
    await client.close(); await server.close();
  });

  test('nonsense query returns zero results, not an error', async () => {
    const { client, server } = await connect({ token: 't', baseUrl: 'http://127.0.0.1:1' });
    const result = await client.callTool({ name: 'cubibase_search_docs', arguments: { query: 'zzzqqqxxxwww' } });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.total).toBe(0);
    await client.close(); await server.close();
  });
});
