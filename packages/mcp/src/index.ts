import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ControlClient, DataClient, CubiBaseError } from '@cubibasehq/client';

export interface CubiBaseMcpOptions {
  /** Personal access token (cb_pat_...). Required. */
  token: string;
  /** Control plane base URL. Default https://api.cubibase.com */
  baseUrl?: string;
  /**
   * Optional project secret key (cb_sec_...) for Data API tools. When set,
   * data tools act as the service actor (RLS applies with
   * cubibase.role='service'); without it, data tools are disabled.
   */
  serviceKey?: string;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  if (err instanceof CubiBaseError) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(err.toJSON(), null, 2) }],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code: 'client_error', message: err instanceof Error ? err.message : String(err) }) }],
  };
}

/**
 * Builds the CubiBase MCP server. Tools map 1:1 to Control API operations;
 * every error is returned as structured JSON with the engine's stable error
 * code so agents can recover (401 -> re-auth, 429 -> wait retryAfterSeconds).
 */
export function createCubiBaseMcpServer(options: CubiBaseMcpOptions): McpServer {
  const control = new ControlClient({ baseUrl: options.baseUrl, token: options.token });
  const server = new McpServer({ name: 'cubibase', version: '0.1.0' });

  const projectId = z.string().describe('Project UUID (from cubibase_list_projects)');
  const table = z.string().describe('Table name in the public schema');

  async function dataClientFor(id: string): Promise<DataClient> {
    if (!options.serviceKey) {
      throw new CubiBaseError(400, 'service_key_required', 'Data API tools need CUBIBASE_SERVICE_KEY (cb_sec_...) configured. Create one in the console under API keys, or use cubibase_list_rows / cubibase_run_sql for console-grade access.');
    }
    const project = await control.getProject(id);
    const scheme = (options.baseUrl ?? 'https://api.cubibase.com').startsWith('http://') ? 'http' : 'https';
    return new DataClient({
      baseUrl: `${scheme}://${project.apiHostname}`,
      token: options.serviceKey,
    });
  }

  // ---- Projects -----------------------------------------------------------

  server.registerTool('cubibase_list_projects', {
    description: 'List all CubiBase projects the token can access, with id, slug, status, and API hostname.',
    inputSchema: {},
  }, async () => {
    try { return ok(await control.listProjects()); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_get_project', {
    description: 'Get one project by id, including provisioning status.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => {
    try { return ok(await control.getProject(id)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_create_project', {
    description: 'Create a new project (provisions an isolated PostgreSQL database). Poll cubibase_get_project until status is active. Requires a verified account and write scope.',
    inputSchema: {
      name: z.string().describe('Display name'),
      slug: z.string().optional().describe('URL slug; derived from name when omitted'),
    },
  }, async (input) => {
    try { return ok(await control.createProject(input)); } catch (err) { return fail(err); }
  });

  // ---- Schema ---------------------------------------------------------------

  server.registerTool('cubibase_list_tables', {
    description: 'List tables and columns of a project schema (default public).',
    inputSchema: { projectId, schema: z.string().optional().describe('public (default), auth, vault, logs') },
  }, async ({ projectId: id, schema }) => {
    try { return ok(await control.listTables(id, schema ?? 'public')); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_create_table', {
    description: 'Create a table in the public schema. Not exposed to the Data API until cubibase_set_exposure grants operations. rlsUserColumn enables per-user row security.',
    inputSchema: {
      projectId,
      name: table,
      columns: z.array(z.object({
        name: z.string(),
        type: z.string().describe('PostgreSQL type, e.g. uuid, text, integer, timestamptz'),
        primaryKey: z.boolean().optional(),
        nullable: z.boolean().optional(),
        default: z.string().optional().describe('SQL default expression, e.g. gen_random_uuid()'),
      })),
      rlsUserColumn: z.string().optional().describe('Column holding the end-user id for RLS, e.g. user_id'),
    },
  }, async ({ projectId: id, ...input }) => {
    try { return ok(await control.createTable(id, input)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_set_exposure', {
    description: 'Grant or revoke Data API operations (select/insert/update/delete) on a table. RLS still applies to every request.',
    inputSchema: {
      projectId,
      table,
      select: z.boolean(),
      insert: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    },
  }, async ({ projectId: id, table: name, ...exposure }) => {
    try { return ok(await control.setExposure(id, name, exposure)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_create_policy', {
    description: "Create an RLS policy. Example user policy: using \"user_id = cubibase.current_user_id()\". Service-key access: using \"cubibase.current_role() = 'service'\".",
    inputSchema: {
      projectId,
      table,
      name: z.string().describe('Policy name (snake_case)'),
      command: z.enum(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']).optional(),
      using: z.string().optional().describe('USING expression'),
      withCheck: z.string().optional().describe('WITH CHECK expression'),
    },
  }, async ({ projectId: id, ...input }) => {
    try { return ok(await control.createPolicy(id, input)); } catch (err) { return fail(err); }
  });

  // ---- Rows & SQL (console-grade) ---------------------------------------------

  server.registerTool('cubibase_list_rows', {
    description: 'List rows as the project sql role (console-grade; bypasses Data API exposure but not platform-schema redaction). Filters: column=op.value (eq, neq, gt, gte, lt, lte, like, ilike, is).',
    inputSchema: {
      projectId,
      table,
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
      order: z.string().optional().describe('column.asc or column.desc'),
      filters: z.record(z.string()).optional().describe('e.g. { "status": "eq.active" }'),
    },
  }, async ({ projectId: id, table: name, limit, offset, order, filters }) => {
    try {
      return ok(await control.listRows(id, name, { limit, offset, order, ...filters }));
    } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_insert_row', {
    description: 'Insert a row into a public table as the sql role (console-grade).',
    inputSchema: { projectId, table, values: z.record(z.unknown()) },
  }, async ({ projectId: id, table: name, values }) => {
    try { return ok(await control.insertRow(id, name, values)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_run_sql', {
    description: 'Run ONE read-only SQL statement (SELECT/EXPLAIN/SHOW/WITH...SELECT) as the project sql role. Writes are rejected; use cubibase_insert_row or schema tools instead.',
    inputSchema: { projectId, sql: z.string() },
  }, async ({ projectId: id, sql }) => {
    try { return ok(await control.runSql(id, sql)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_create_sql_function', {
    description: 'Create or replace a SQL/plpgsql function. apiExecute=true makes it callable over the Data API at POST /rest/v1/rpc/{name}.',
    inputSchema: {
      projectId,
      name: z.string(),
      arguments: z.array(z.object({ name: z.string(), type: z.string(), default: z.string().optional() })).optional(),
      returnType: z.string(),
      returnsSetof: z.boolean().optional(),
      language: z.enum(['sql', 'plpgsql']).optional(),
      volatility: z.enum(['IMMUTABLE', 'STABLE', 'VOLATILE']).optional(),
      body: z.string(),
      apiExecute: z.boolean().optional(),
    },
  }, async ({ projectId: id, ...input }) => {
    try { return ok(await control.createSqlFunction(id, input)); } catch (err) { return fail(err); }
  });

  // ---- Data API (service actor) ------------------------------------------------

  server.registerTool('cubibase_data_list', {
    description: 'List rows over the project Data API as the service actor (requires CUBIBASE_SERVICE_KEY). RLS applies: only rows a service policy grants are visible.',
    inputSchema: {
      projectId,
      table,
      limit: z.number().int().min(1).max(1000).optional(),
      filters: z.record(z.string()).optional(),
    },
  }, async ({ projectId: id, table: name, limit, filters }) => {
    try {
      const data = await dataClientFor(id);
      return ok(await data.list(name, { limit, filters }));
    } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_data_rpc', {
    description: 'Call a public function over the Data API as the service actor (requires CUBIBASE_SERVICE_KEY).',
    inputSchema: { projectId, name: z.string(), args: z.record(z.unknown()).optional() },
  }, async ({ projectId: id, name, args }) => {
    try {
      const data = await dataClientFor(id);
      return ok(await data.rpc(name, args ?? {}));
    } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_data_openapi', {
    description: 'Fetch the project Data API OpenAPI 3.1 document generated from the live schema: exposed tables, columns, filters, and callable functions.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => {
    try {
      const project = await control.getProject(id);
      const scheme = (options.baseUrl ?? 'https://api.cubibase.com').startsWith('http://') ? 'http' : 'https';
      const key = options.serviceKey ?? (await control.listApiKeys(id)).keys.find((k) => k.kind === 'publishable' && !k.revokedAt)?.publishableKey;
      if (!key) throw new CubiBaseError(400, 'no_api_key', 'Project has no publishable key; create one in the console.');
      const data = new DataClient({ baseUrl: `${scheme}://${project.apiHostname}`, publishableKey: key });
      return ok(await data.openapi());
    } catch (err) { return fail(err); }
  });

  // ---- Keys, logs, usage ---------------------------------------------------------

  server.registerTool('cubibase_list_api_keys', {
    description: 'List project API keys (publishable values and secret prefixes; secret material is never returned).',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => {
    try { return ok(await control.listApiKeys(id)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_request_logs', {
    description: 'Search Data API request logs. Useful filters: status, errorCode, path, userId, minDurationMs, limit.',
    inputSchema: {
      projectId,
      status: z.number().int().optional(),
      errorCode: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ projectId: id, ...query }) => {
    try { return ok(await control.requestLogs(id, query)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_audit_logs', {
    description: 'Search console audit logs (who changed what). Filters: action, actor, limit.',
    inputSchema: {
      projectId,
      action: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ projectId: id, ...query }) => {
    try { return ok(await control.auditLogs(id, query)); } catch (err) { return fail(err); }
  });

  server.registerTool('cubibase_usage', {
    description: 'Account consumption vs plan quotas, per-project usage, and suspension state.',
    inputSchema: {},
  }, async () => {
    try { return ok(await control.usage()); } catch (err) { return fail(err); }
  });

  return server;
}
