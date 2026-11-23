import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ControlClient, DataClient, CubiBaseError } from '@cubibasehq/client';
import { searchDocs } from './docs-search.js';

export type FeatureGroup = 'projects' | 'database' | 'storage' | 'functions' | 'data' | 'observability' | 'docs';
export const FEATURE_GROUPS: FeatureGroup[] = ['projects', 'database', 'storage', 'functions', 'data', 'observability', 'docs'];

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
  /**
   * Read-only mode: mutating tools are not registered at all. Prefer this
   * for untrusted or exploratory agent sessions (env CUBIBASE_READ_ONLY=1).
   */
  readOnly?: boolean;
  /**
   * Restrict registered tools to these feature groups (env
   * CUBIBASE_FEATURES=database,storage). Default: all groups.
   */
  features?: FeatureGroup[];
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
 *
 * Safety knobs: readOnly removes every mutating tool from the tool list;
 * features limits the surface to selected groups (projects, database,
 * storage, functions, data, observability, docs).
 */
export function createCubiBaseMcpServer(options: CubiBaseMcpOptions): McpServer {
  const control = new ControlClient({ baseUrl: options.baseUrl, token: options.token });
  const server = new McpServer({ name: 'cubibase', version: '0.2.0' });
  const enabled = new Set<FeatureGroup>(options.features?.length ? options.features : FEATURE_GROUPS);
  const readOnly = options.readOnly === true;

  const projectId = z.string().describe('Project UUID (from cubibase_list_projects)');
  const table = z.string().describe('Table name in the public schema');

  /** Register a tool only when its feature group is enabled (and, for writes, readOnly is off). */
  function tool(
    name: string,
    group: FeatureGroup,
    kind: 'read' | 'write',
    config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): void {
    if (!enabled.has(group)) return;
    if (kind === 'write' && readOnly) return;
    server.registerTool(name, config as never, (async (args: Record<string, unknown>) => {
      try { return await handler(args); } catch (err) { return fail(err); }
    }) as never);
  }

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

  tool('cubibase_list_projects', 'projects', 'read', {
    description: 'List all CubiBase projects the token can access, with id, slug, status, and API hostname.',
    inputSchema: {},
  }, async () => ok(await control.listProjects()));

  tool('cubibase_get_project', 'projects', 'read', {
    description: 'Get one project by id, including provisioning status.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.getProject(id as string)));

  tool('cubibase_create_project', 'projects', 'write', {
    description: 'Create a new project (provisions an isolated PostgreSQL database). Poll cubibase_get_project until status is active. Requires a verified account and write scope.',
    inputSchema: {
      name: z.string().describe('Display name'),
      slug: z.string().optional().describe('URL slug; derived from name when omitted'),
    },
  }, async (input) => ok(await control.createProject(input as { name: string; slug?: string })));

  tool('cubibase_update_project', 'projects', 'write', {
    description: 'Rename a project (name) or change its display region label.',
    inputSchema: {
      projectId,
      name: z.string().optional().describe('New display name'),
      region: z.string().optional().describe('Region label'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.updateProject(id as string, input)));

  tool('cubibase_delete_project', 'projects', 'write', {
    description: 'PERMANENTLY delete a project and its database. Requires typing the slug in confirmSlug as an explicit safeguard. Irreversible.',
    inputSchema: {
      projectId,
      confirmSlug: z.string().describe('Must equal the project slug; the engine requires "delete {slug}"'),
    },
  }, async ({ projectId: id, confirmSlug }) => {
    await control.deleteProject(id as string, confirmSlug as string);
    return ok({ deleted: true, projectId: id });
  });

  // ---- Schema: tables & columns ---------------------------------------------

  tool('cubibase_list_tables', 'database', 'read', {
    description: 'List tables and columns of a project schema (default public).',
    inputSchema: { projectId, schema: z.string().optional().describe('public (default), auth, vault, logs') },
  }, async ({ projectId: id, schema }) => ok(await control.listTables(id as string, (schema as string) ?? 'public')));

  const columnInput = z.object({
    name: z.string(),
    type: z.string().describe('PostgreSQL type: uuid, text, integer, bigint, boolean, timestamptz, jsonb, numeric, double'),
    primaryKey: z.boolean().optional(),
    nullable: z.boolean().optional(),
    default: z.string().optional().describe('One of gen_random_uuid(), now(), true, false'),
  });

  tool('cubibase_create_table', 'database', 'write', {
    description: 'Create a table in the public schema. Not exposed to the Data API until cubibase_set_exposure grants operations. rlsUserColumn enables per-user row security.',
    inputSchema: {
      projectId,
      name: table,
      columns: z.array(columnInput),
      rlsUserColumn: z.string().optional().describe('Column holding the end-user id for RLS, e.g. user_id'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createTable(id as string, input as never)));

  tool('cubibase_add_column', 'database', 'write', {
    description: 'Add a column to an existing public table.',
    inputSchema: { projectId, table, column: columnInput },
  }, async ({ projectId: id, table: name, column }) => ok(await control.addColumn(id as string, name as string, column as never)));

  tool('cubibase_drop_column', 'database', 'write', {
    description: 'Drop a column from a public table. Data in the column is lost.',
    inputSchema: { projectId, table, column: z.string() },
  }, async ({ projectId: id, table: name, column }) => {
    await control.dropColumn(id as string, name as string, column as string);
    return ok({ dropped: true, table: name, column });
  });

  tool('cubibase_set_exposure', 'database', 'write', {
    description: 'Grant or revoke Data API operations (select/insert/update/delete) on a table. RLS still applies to every request.',
    inputSchema: {
      projectId,
      table,
      select: z.boolean(),
      insert: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    },
  }, async ({ projectId: id, table: name, ...exposure }) => ok(await control.setExposure(id as string, name as string, exposure as never)));

  // ---- Schema: policies -------------------------------------------------------

  tool('cubibase_list_policies', 'database', 'read', {
    description: 'List RLS policies on public tables.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listPolicies(id as string)));

  tool('cubibase_create_policy', 'database', 'write', {
    description: "Create an RLS policy. Example user policy: using \"user_id = cubibase.current_user_id()\". Service-key access: using \"cubibase.current_role() = 'service'\".",
    inputSchema: {
      projectId,
      table,
      name: z.string().describe('Policy name (snake_case)'),
      command: z.enum(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']).optional(),
      using: z.string().optional().describe('USING expression'),
      withCheck: z.string().optional().describe('WITH CHECK expression'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createPolicy(id as string, input as never)));

  tool('cubibase_drop_policy', 'database', 'write', {
    description: 'Drop an RLS policy from a table.',
    inputSchema: { projectId, table, name: z.string() },
  }, async ({ projectId: id, table: name, name: policy }) => {
    await control.dropPolicy(id as string, name as string, policy as string);
    return ok({ dropped: true, table: name, policy });
  });

  // ---- Schema: database triggers ----------------------------------------------

  tool('cubibase_list_db_triggers', 'database', 'read', {
    description: 'List PostgreSQL triggers on public tables (not serverless Function triggers).',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listDbTriggers(id as string)));

  tool('cubibase_create_db_trigger', 'database', 'write', {
    description: 'Create a PostgreSQL trigger calling an existing SQL/plpgsql function. TRUNCATE requires level STATEMENT; constraint triggers must be AFTER ROW.',
    inputSchema: {
      projectId,
      table,
      name: z.string(),
      events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])).min(1),
      function: z.string().describe('Existing trigger function name (returns trigger)'),
      timing: z.enum(['BEFORE', 'AFTER', 'INSTEAD OF']).optional(),
      level: z.enum(['ROW', 'STATEMENT']).optional(),
      updateColumns: z.array(z.string()).optional().describe('UPDATE OF columns; requires UPDATE event'),
      when: z.string().optional().describe('WHEN condition'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createDbTrigger(id as string, input as never)));

  tool('cubibase_set_db_trigger_enabled', 'database', 'write', {
    description: 'Enable or disable a PostgreSQL trigger without dropping it.',
    inputSchema: { projectId, table, name: z.string(), enabled: z.boolean() },
  }, async ({ projectId: id, table: name, name: trigger, enabled }) =>
    ok(await control.setDbTriggerEnabled(id as string, name as string, trigger as string, enabled as boolean)));

  tool('cubibase_drop_db_trigger', 'database', 'write', {
    description: 'Drop a PostgreSQL trigger.',
    inputSchema: { projectId, table, name: z.string() },
  }, async ({ projectId: id, table: name, name: trigger }) => {
    await control.dropDbTrigger(id as string, name as string, trigger as string);
    return ok({ dropped: true, table: name, trigger });
  });

  // ---- Schema: indexes -----------------------------------------------------------

  tool('cubibase_list_indexes', 'database', 'read', {
    description: 'List indexes on public tables.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listIndexes(id as string)));

  tool('cubibase_create_index', 'database', 'write', {
    description: 'Create an index. Provide columns OR an expression (not both). Only btree indexes can be unique.',
    inputSchema: {
      projectId,
      table,
      name: z.string(),
      columns: z.array(z.object({
        column: z.string(),
        order: z.enum(['ASC', 'DESC']).optional(),
        nulls: z.enum(['FIRST', 'LAST']).optional(),
      })).optional(),
      method: z.string().optional().describe('btree (default), gin, gist, hash, ...'),
      unique: z.boolean().optional(),
      expression: z.string().optional().describe('Expression index, e.g. lower(email)'),
      where: z.string().optional().describe('Partial index predicate'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createIndex(id as string, input as never)));

  tool('cubibase_drop_index', 'database', 'write', {
    description: 'Drop an index by name.',
    inputSchema: { projectId, name: z.string() },
  }, async ({ projectId: id, name }) => {
    await control.dropIndex(id as string, name as string);
    return ok({ dropped: true, index: name });
  });

  // ---- Schema: types ---------------------------------------------------------------

  tool('cubibase_list_types', 'database', 'read', {
    description: 'List custom types (enums and composites) in the public schema.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listTypes(id as string)));

  tool('cubibase_create_enum_type', 'database', 'write', {
    description: 'Create an enum type, e.g. order_status with labels pending, paid, shipped.',
    inputSchema: { projectId, name: z.string(), labels: z.array(z.string()).min(1) },
  }, async ({ projectId: id, name, labels }) => ok(await control.createEnumType(id as string, { name: name as string, labels: labels as string[] })));

  tool('cubibase_create_composite_type', 'database', 'write', {
    description: 'Create a composite type with named attributes.',
    inputSchema: {
      projectId,
      name: z.string(),
      attributes: z.array(z.object({ name: z.string(), type: z.string() })).min(1),
    },
  }, async ({ projectId: id, name, attributes }) => ok(await control.createCompositeType(id as string, { name: name as string, attributes: attributes as never })));

  tool('cubibase_add_enum_label', 'database', 'write', {
    description: 'Add a label to an enum type, optionally positioned before/after an existing label.',
    inputSchema: {
      projectId,
      name: z.string().describe('Enum type name'),
      label: z.string(),
      before: z.string().optional(),
      after: z.string().optional(),
    },
  }, async ({ projectId: id, name, ...input }) => ok(await control.addTypeLabel(id as string, name as string, input as never)));

  tool('cubibase_drop_type', 'database', 'write', {
    description: 'Drop a custom type. Fails if columns still use it.',
    inputSchema: { projectId, name: z.string() },
  }, async ({ projectId: id, name }) => {
    await control.dropType(id as string, name as string);
    return ok({ dropped: true, type: name });
  });

  // ---- Schema: views ---------------------------------------------------------------

  tool('cubibase_list_views', 'database', 'read', {
    description: 'List views and materialized views in the public schema.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listViews(id as string)));

  tool('cubibase_create_view', 'database', 'write', {
    description: 'Create a view (or materialized view) from a SELECT query. apiSelect=true exposes it to Data API reads; RLS of underlying tables still applies.',
    inputSchema: {
      projectId,
      name: z.string(),
      query: z.string().describe('SELECT statement defining the view'),
      materialized: z.boolean().optional(),
      replace: z.boolean().optional().describe('CREATE OR REPLACE'),
      apiSelect: z.boolean().optional(),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createView(id as string, input as never)));

  tool('cubibase_refresh_view', 'database', 'write', {
    description: 'Refresh a materialized view.',
    inputSchema: { projectId, name: z.string() },
  }, async ({ projectId: id, name }) => ok(await control.refreshView(id as string, name as string)));

  tool('cubibase_drop_view', 'database', 'write', {
    description: 'Drop a view or materialized view.',
    inputSchema: { projectId, name: z.string() },
  }, async ({ projectId: id, name }) => {
    await control.dropView(id as string, name as string);
    return ok({ dropped: true, view: name });
  });

  // ---- Rows & SQL (console-grade) ---------------------------------------------

  tool('cubibase_list_rows', 'database', 'read', {
    description: 'List rows as the project sql role (console-grade; bypasses Data API exposure but not platform-schema redaction). Filters: column=op.value (eq, neq, gt, gte, lt, lte, like, ilike, is).',
    inputSchema: {
      projectId,
      table,
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
      order: z.string().optional().describe('column.asc or column.desc'),
      filters: z.record(z.string()).optional().describe('e.g. { "status": "eq.active" }'),
    },
  }, async ({ projectId: id, table: name, limit, offset, order, filters }) =>
    ok(await control.listRows(id as string, name as string, {
      limit: limit as number | undefined,
      offset: offset as number | undefined,
      order: order as string | undefined,
      ...(filters as Record<string, string> | undefined),
    })));

  tool('cubibase_insert_row', 'database', 'write', {
    description: 'Insert a row into a public table as the sql role (console-grade).',
    inputSchema: { projectId, table, values: z.record(z.unknown()) },
  }, async ({ projectId: id, table: name, values }) => ok(await control.insertRow(id as string, name as string, values as Record<string, unknown>)));

  tool('cubibase_update_row', 'database', 'write', {
    description: 'Update one row by primary key as the sql role (console-grade).',
    inputSchema: { projectId, table, id: z.string().describe('Primary key value'), values: z.record(z.unknown()) },
  }, async ({ projectId: id, table: name, id: rowId, values }) =>
    ok(await control.updateRow(id as string, name as string, rowId as string, values as Record<string, unknown>)));

  tool('cubibase_delete_row', 'database', 'write', {
    description: 'Delete one row by primary key as the sql role (console-grade).',
    inputSchema: { projectId, table, id: z.string().describe('Primary key value') },
  }, async ({ projectId: id, table: name, id: rowId }) => ok(await control.deleteRow(id as string, name as string, rowId as string)));

  tool('cubibase_run_sql', 'database', 'read', {
    description: 'Run ONE read-only SQL statement (SELECT/EXPLAIN/SHOW/WITH...SELECT) as the project sql role. Writes are rejected by the engine; use row and schema tools instead.',
    inputSchema: { projectId, sql: z.string() },
  }, async ({ projectId: id, sql }) => ok(await control.runSql(id as string, sql as string)));

  tool('cubibase_create_sql_function', 'database', 'write', {
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
  }, async ({ projectId: id, ...input }) => ok(await control.createSqlFunction(id as string, input as never)));

  tool('cubibase_drop_sql_function', 'database', 'write', {
    description: 'Drop a SQL function. For overloaded functions pass args as a comma-separated type list, e.g. "integer, text".',
    inputSchema: { projectId, name: z.string(), args: z.string().optional() },
  }, async ({ projectId: id, name, args }) => {
    await control.dropSqlFunction(id as string, name as string, args as string | undefined);
    return ok({ dropped: true, function: name });
  });

  // ---- Storage ---------------------------------------------------------------

  tool('cubibase_storage_usage', 'storage', 'read', {
    description: 'Project storage consumption vs plan quota (bytes stored, object count).',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.storageUsage(id as string)));

  tool('cubibase_list_buckets', 'storage', 'read', {
    description: 'List storage buckets with visibility, size limits, and allowed MIME types.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listBuckets(id as string)));

  tool('cubibase_create_bucket', 'storage', 'write', {
    description: 'Create a storage bucket. public=true serves objects at /storage/v1/public/{bucket}/{path} without auth.',
    inputSchema: {
      projectId,
      name: z.string().describe('Bucket name (lowercase, dashes)'),
      public: z.boolean().optional().describe('Default false (private; signed URLs only)'),
      fileSizeLimitBytes: z.number().int().positive().nullable().optional(),
      allowedMimeTypes: z.array(z.string()).nullable().optional().describe('null = any type'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createBucket(id as string, input as never)));

  tool('cubibase_update_bucket', 'storage', 'write', {
    description: 'Change bucket visibility, per-file size limit, or allowed MIME types.',
    inputSchema: {
      projectId,
      bucket: z.string(),
      public: z.boolean().optional(),
      fileSizeLimitBytes: z.number().int().positive().nullable().optional(),
      allowedMimeTypes: z.array(z.string()).nullable().optional(),
    },
  }, async ({ projectId: id, bucket, ...input }) => ok(await control.updateBucket(id as string, bucket as string, input as never)));

  tool('cubibase_delete_bucket', 'storage', 'write', {
    description: 'Delete a bucket. The engine refuses unless it is empty (or confirms cascade per its rules).',
    inputSchema: { projectId, bucket: z.string() },
  }, async ({ projectId: id, bucket }) => ok(await control.deleteBucket(id as string, bucket as string)));

  tool('cubibase_list_objects', 'storage', 'read', {
    description: 'List objects in a bucket. Use prefix for folders and search for substring matching.',
    inputSchema: {
      projectId,
      bucket: z.string(),
      prefix: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
      search: z.string().optional(),
    },
  }, async ({ projectId: id, ...query }) => ok(await control.listObjects(id as string, query as never)));

  tool('cubibase_upload_file', 'storage', 'write', {
    description: 'Upload a file end-to-end (reserve → presigned S3 POST → complete). Content is text (utf8) or base64. Best for small files (configs, JSON, images up to a few MB); larger files should use cubibase_create_upload_url and upload out-of-band.',
    inputSchema: {
      projectId,
      bucket: z.string(),
      path: z.string().describe('Logical object path, e.g. avatars/user-1.png'),
      content: z.string().describe('File content: plain text, or base64 when contentEncoding=base64'),
      contentEncoding: z.enum(['utf8', 'base64']).optional().describe('Default utf8'),
      mimeType: z.string().optional().describe('Default application/octet-stream'),
      fileName: z.string().optional(),
      overwrite: z.boolean().optional().describe('Required to replace an existing object'),
    },
  }, async ({ projectId: id, bucket, path, content, contentEncoding, mimeType, fileName, overwrite }) => {
    const bytes = contentEncoding === 'base64'
      ? new Uint8Array(Buffer.from(content as string, 'base64'))
      : (content as string);
    return ok(await control.uploadFile(id as string, {
      bucket: bucket as string,
      path: path as string,
      content: bytes,
      mimeType: mimeType as string | undefined,
      fileName: fileName as string | undefined,
      overwrite: overwrite as boolean | undefined,
    }));
  });

  tool('cubibase_create_upload_url', 'storage', 'write', {
    description: 'Reserve an upload and return a presigned S3 POST (url + fields) for out-of-band upload of large files. After the POST succeeds, call cubibase_complete_upload with the uploadId.',
    inputSchema: {
      projectId,
      bucket: z.string(),
      path: z.string(),
      sizeBytes: z.number().int().positive().describe('Exact byte length; S3 rejects any other size'),
      mimeType: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createUpload(id as string, input as never)));

  tool('cubibase_complete_upload', 'storage', 'write', {
    description: 'Finalize a reserved upload after the presigned POST succeeded. Verifies size/type against S3 and makes the object ready.',
    inputSchema: { projectId, uploadId: z.string() },
  }, async ({ projectId: id, uploadId }) => ok(await control.completeUpload(id as string, uploadId as string)));

  tool('cubibase_delete_object', 'storage', 'write', {
    description: 'Delete a stored object by id (from cubibase_list_objects).',
    inputSchema: { projectId, objectId: z.string() },
  }, async ({ projectId: id, objectId }) => ok(await control.deleteObject(id as string, objectId as string)));

  tool('cubibase_sign_object_url', 'storage', 'read', {
    description: 'Get a shareable download URL: public URL for public buckets, expiring signed URL (30–3600 s) for private ones.',
    inputSchema: {
      projectId,
      objectId: z.string(),
      expiresIn: z.number().int().min(30).max(3600).optional(),
    },
  }, async ({ projectId: id, objectId, expiresIn }) =>
    ok(await control.signObjectUrl(id as string, objectId as string, expiresIn as number | undefined)));

  // ---- Functions (serverless) --------------------------------------------------

  tool('cubibase_function_templates', 'functions', 'read', {
    description: 'List starter templates for new functions (id, name, description, source).',
    inputSchema: {},
  }, async () => ok(await control.functionTemplates()));

  tool('cubibase_functions_usage', 'functions', 'read', {
    description: 'Function invocations and compute consumption vs plan quotas.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.functionsUsage(id as string)));

  tool('cubibase_list_functions', 'functions', 'read', {
    description: 'List serverless functions with status, triggers, and active deployment.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listFunctions(id as string)));

  tool('cubibase_get_function', 'functions', 'read', {
    description: 'Get one function by id or name, including source code, triggers, and secrets (names only).',
    inputSchema: { projectId, function: z.string().describe('Function id or name') },
  }, async ({ projectId: id, function: fn }) => ok(await control.getFunction(id as string, fn as string)));

  tool('cubibase_create_function', 'functions', 'write', {
    description: 'Create a TypeScript/JavaScript function. Provide sourceCode or templateId. After creation call cubibase_deploy_function to build and activate it. httpAuthMode: public, jwt (default), api_key, internal.',
    inputSchema: {
      projectId,
      name: z.string().describe('lowercase letters, digits, dashes (2-40 chars)'),
      description: z.string().optional(),
      language: z.enum(['typescript', 'javascript']).optional(),
      sourceCode: z.string().optional().describe('Function source; export default async (req, ctx) => Response'),
      templateId: z.string().optional().describe('From cubibase_function_templates'),
      httpAuthMode: z.enum(['public', 'jwt', 'api_key', 'internal']).optional(),
      timeoutSeconds: z.number().int().min(1).max(60).optional(),
      memoryMb: z.number().int().min(128).max(3008).optional(),
      createHttpTrigger: z.boolean().optional().describe('Default true'),
    },
  }, async ({ projectId: id, ...input }) => ok(await control.createFunction(id as string, input as never)));

  tool('cubibase_update_function', 'functions', 'write', {
    description: 'Update function source/config. Source changes need cubibase_deploy_function to take effect. enabled=false pauses all triggers.',
    inputSchema: {
      projectId,
      function: z.string(),
      description: z.string().optional(),
      language: z.enum(['typescript', 'javascript']).optional(),
      sourceCode: z.string().optional(),
      enabled: z.boolean().optional(),
      httpAuthMode: z.enum(['public', 'jwt', 'api_key', 'internal']).optional(),
      timeoutSeconds: z.number().int().min(1).max(60).optional(),
      memoryMb: z.number().int().min(128).max(3008).optional(),
    },
  }, async ({ projectId: id, function: fn, ...input }) => ok(await control.updateFunction(id as string, fn as string, input as never)));

  tool('cubibase_delete_function', 'functions', 'write', {
    description: 'Delete a function with its deployments, triggers, and secrets.',
    inputSchema: { projectId, function: z.string() },
  }, async ({ projectId: id, function: fn }) => ok(await control.deleteFunction(id as string, fn as string)));

  tool('cubibase_deploy_function', 'functions', 'write', {
    description: 'Build the current source into a new deployment and activate it. Poll cubibase_list_deployments until status is ready/active.',
    inputSchema: { projectId, function: z.string() },
  }, async ({ projectId: id, function: fn }) => ok(await control.deployFunction(id as string, fn as string)));

  tool('cubibase_list_deployments', 'functions', 'read', {
    description: 'List a function\'s versioned deployments with build status.',
    inputSchema: { projectId, function: z.string() },
  }, async ({ projectId: id, function: fn }) => ok(await control.listDeployments(id as string, fn as string)));

  tool('cubibase_activate_deployment', 'functions', 'write', {
    description: 'Roll back or forward by activating a specific ready deployment.',
    inputSchema: { projectId, function: z.string(), deploymentId: z.string() },
  }, async ({ projectId: id, function: fn, deploymentId }) =>
    ok(await control.activateDeployment(id as string, fn as string, deploymentId as string)));

  tool('cubibase_set_function_secret', 'functions', 'write', {
    description: 'Set an encrypted secret available to the function as ctx.env.NAME. Redeploy for running versions to pick it up.',
    inputSchema: { projectId, function: z.string(), name: z.string(), value: z.string() },
  }, async ({ projectId: id, function: fn, name, value }) =>
    ok(await control.setFunctionSecret(id as string, fn as string, name as string, value as string)));

  tool('cubibase_delete_function_secret', 'functions', 'write', {
    description: 'Delete a function secret by name.',
    inputSchema: { projectId, function: z.string(), name: z.string() },
  }, async ({ projectId: id, function: fn, name }) => ok(await control.deleteFunctionSecret(id as string, fn as string, name as string)));

  tool('cubibase_create_function_trigger', 'functions', 'write', {
    description: 'Attach a trigger. kind=http: config {}. kind=database: {table, events:[INSERT|UPDATE|DELETE], schema?, includeOldRecord?}. kind=storage: {bucket, events:[...], prefix?}. kind=schedule: {cron, timezone?}.',
    inputSchema: {
      projectId,
      function: z.string(),
      kind: z.enum(['http', 'database', 'storage', 'schedule']),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
    },
  }, async ({ projectId: id, function: fn, ...input }) => ok(await control.createFunctionTrigger(id as string, fn as string, input as never)));

  tool('cubibase_update_function_trigger', 'functions', 'write', {
    description: 'Enable/disable a function trigger or change its config.',
    inputSchema: {
      projectId,
      function: z.string(),
      triggerId: z.string(),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
    },
  }, async ({ projectId: id, function: fn, triggerId, ...input }) =>
    ok(await control.updateFunctionTrigger(id as string, fn as string, triggerId as string, input)));

  tool('cubibase_delete_function_trigger', 'functions', 'write', {
    description: 'Remove a function trigger.',
    inputSchema: { projectId, function: z.string(), triggerId: z.string() },
  }, async ({ projectId: id, function: fn, triggerId }) => ok(await control.deleteFunctionTrigger(id as string, fn as string, triggerId as string)));

  tool('cubibase_test_function', 'functions', 'write', {
    description: 'Invoke a function in test mode (counts against quotas). Send an HTTP-style request or a trigger event payload.',
    inputSchema: {
      projectId,
      function: z.string(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      path: z.string().optional(),
      headers: z.record(z.string()).optional(),
      body: z.string().nullable().optional(),
      event: z.record(z.unknown()).nullable().optional().describe('Simulated database/storage/schedule event'),
    },
  }, async ({ projectId: id, function: fn, ...input }) => ok(await control.testFunction(id as string, fn as string, input as never)));

  tool('cubibase_function_executions', 'functions', 'read', {
    description: 'Search function execution logs: filter by functionId, trigger kind, status (success/error/timeout).',
    inputSchema: {
      projectId,
      functionId: z.string().optional(),
      trigger: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
  }, async ({ projectId: id, ...query }) => ok(await control.functionExecutions(id as string, query as never)));

  tool('cubibase_function_execution', 'functions', 'read', {
    description: 'Get one execution with logs, duration, and error detail.',
    inputSchema: { projectId, executionId: z.string() },
  }, async ({ projectId: id, executionId }) => ok(await control.functionExecution(id as string, executionId as string)));

  // ---- Data API (service actor) ------------------------------------------------

  tool('cubibase_data_list', 'data', 'read', {
    description: 'List rows over the project Data API as the service actor (requires CUBIBASE_SERVICE_KEY). RLS applies: only rows a service policy grants are visible.',
    inputSchema: {
      projectId,
      table,
      limit: z.number().int().min(1).max(1000).optional(),
      filters: z.record(z.string()).optional(),
    },
  }, async ({ projectId: id, table: name, limit, filters }) => {
    const data = await dataClientFor(id as string);
    return ok(await data.list(name as string, { limit: limit as number | undefined, filters: filters as Record<string, string> | undefined }));
  });

  tool('cubibase_data_rpc', 'data', 'write', {
    description: 'Call a public function over the Data API as the service actor (requires CUBIBASE_SERVICE_KEY).',
    inputSchema: { projectId, name: z.string(), args: z.record(z.unknown()).optional() },
  }, async ({ projectId: id, name, args }) => {
    const data = await dataClientFor(id as string);
    return ok(await data.rpc(name as string, (args as Record<string, unknown>) ?? {}));
  });

  tool('cubibase_data_openapi', 'data', 'read', {
    description: 'Fetch the project Data API OpenAPI 3.1 document generated from the live schema: exposed tables, columns, filters, and callable functions.',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => {
    const project = await control.getProject(id as string);
    const scheme = (options.baseUrl ?? 'https://api.cubibase.com').startsWith('http://') ? 'http' : 'https';
    const key = options.serviceKey ?? (await control.listApiKeys(id as string)).keys.find((k) => k.kind === 'publishable' && !k.revokedAt)?.publishableKey;
    if (!key) throw new CubiBaseError(400, 'no_api_key', 'Project has no publishable key; create one in the console.');
    const data = new DataClient({ baseUrl: `${scheme}://${project.apiHostname}`, publishableKey: key });
    return ok(await data.openapi());
  });

  // ---- Keys, logs, usage ---------------------------------------------------------

  tool('cubibase_list_api_keys', 'observability', 'read', {
    description: 'List project API keys (publishable values and secret prefixes; secret material is never returned).',
    inputSchema: { projectId },
  }, async ({ projectId: id }) => ok(await control.listApiKeys(id as string)));

  tool('cubibase_create_api_key', 'observability', 'write', {
    description: 'Create a project API key. kind=secret returns the cb_sec_ value ONCE (service actor for server-side Data API calls); publishable keys identify the project in clients.',
    inputSchema: {
      projectId,
      kind: z.enum(['publishable', 'secret']),
      name: z.string().optional(),
    },
  }, async ({ projectId: id, kind, name }) =>
    ok(await control.createApiKey(id as string, kind as 'publishable' | 'secret', (name as string) ?? 'secret')));

  tool('cubibase_revoke_api_key', 'observability', 'write', {
    description: 'Revoke an API key by id. Requests using it fail immediately.',
    inputSchema: { projectId, keyId: z.string() },
  }, async ({ projectId: id, keyId }) => {
    await control.revokeApiKey(id as string, keyId as string);
    return ok({ revoked: true, keyId });
  });

  tool('cubibase_request_logs', 'observability', 'read', {
    description: 'Search Data API request logs. Useful filters: status, errorCode, path, userId, minDurationMs, limit.',
    inputSchema: {
      projectId,
      status: z.number().int().optional(),
      errorCode: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ projectId: id, ...query }) => ok(await control.requestLogs(id as string, query as never)));

  tool('cubibase_audit_logs', 'observability', 'read', {
    description: 'Search console audit logs (who changed what). Filters: action, actor, limit.',
    inputSchema: {
      projectId,
      action: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ projectId: id, ...query }) => ok(await control.auditLogs(id as string, query as never)));

  tool('cubibase_usage', 'observability', 'read', {
    description: 'Account consumption vs plan quotas, per-project usage, and suspension state.',
    inputSchema: {},
  }, async () => ok(await control.usage()));

  // ---- Docs search (offline) ------------------------------------------------------

  tool('cubibase_search_docs', 'docs', 'read', {
    description: 'Search the bundled CubiBase documentation (same content as cubibase.com/docs). Returns ranked pages with excerpts and URLs; fetch {url}.md for full markdown. Works offline, no token scopes needed.',
    inputSchema: {
      query: z.string().describe('Search terms, e.g. "signed url", "rls policy", "cron trigger"'),
      limit: z.number().int().min(1).max(10).optional(),
    },
  }, async ({ query, limit }) => ok(searchDocs(query as string, (limit as number) ?? 5)));

  return server;
}
