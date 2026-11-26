import { HttpTransport, type RequestOptions } from './http.js';
import { CubiBaseError } from './errors.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  region: string;
  status: string;
  apiHostname: string;
  createdAt: string;
  role?: string;
}

export interface AccessToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: 'read' | 'write' | 'admin';
  projectId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Column {
  name: string;
  dataType: string;
  notNull: boolean;
  isPrimary: boolean;
  defaultExpr: string | null;
}

export interface Table {
  name: string;
  schema: string;
  columns: Column[];
  primaryKey: string[];
}

export interface ApiKey {
  id: string;
  kind: 'publishable' | 'secret';
  name: string;
  keyPrefix: string;
  publishableKey: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Bucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimitBytes: number | null;
  allowedMimeTypes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadSession {
  uploadId: string;
  objectId: string;
  bucket: string;
  path: string;
  /** Presigned S3 POST: send every field, then the file part named "file". */
  upload: { url: string; fields: Record<string, string>; key: string; method: 'POST' };
  expiresAt: string;
  completeUrl: string;
}

export interface ColumnInput {
  name: string;
  type: string;
  primaryKey?: boolean;
  nullable?: boolean;
  default?: string;
}

export interface CreateFunctionInput {
  name: string;
  description?: string;
  language?: 'typescript' | 'javascript';
  sourceCode?: string;
  templateId?: string;
  httpAuthMode?: 'public' | 'jwt' | 'api_key' | 'internal';
  signatureMode?: 'none' | 'hmac' | 'custom';
  timeoutSeconds?: number;
  memoryMb?: number;
  createHttpTrigger?: boolean;
}

export interface UpdateFunctionInput {
  description?: string;
  language?: 'typescript' | 'javascript';
  sourceCode?: string;
  enabled?: boolean;
  httpAuthMode?: 'public' | 'jwt' | 'api_key' | 'internal';
  signatureMode?: 'none' | 'hmac' | 'custom';
  timeoutSeconds?: number;
  memoryMb?: number;
}

export interface ControlClientOptions {
  /** Control plane base URL, e.g. https://api.cubibase.com */
  baseUrl?: string;
  /** Personal access token (cb_pat_...) or session JWT. */
  token?: string;
  fetchImpl?: typeof fetch;
}

/**
 * CubiBase Control API client. Authenticate with a personal access token
 * created in the console (Account → Access tokens) or via POST /v1/auth/tokens.
 */
export class ControlClient {
  readonly http: HttpTransport;

  constructor(options: ControlClientOptions = {}) {
    this.http = new HttpTransport({
      baseUrl: options.baseUrl ?? 'https://api.cubibase.com',
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
  }

  private req<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.http.request<T>(path, options);
  }

  // ---- Projects ----------------------------------------------------------

  listProjects(): Promise<{ projects: Project[] }> {
    return this.req('/v1/projects');
  }

  getProject(projectId: string): Promise<Project> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}`);
  }

  createProject(input: { name: string; slug?: string; region?: string }): Promise<Project> {
    return this.req('/v1/projects', { method: 'POST', body: input });
  }

  updateProject(projectId: string, input: { name?: string; region?: string }): Promise<Project> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: input });
  }

  deleteProject(projectId: string, slug: string): Promise<void> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      body: { confirm: `delete ${slug}` },
    });
  }

  provisioning(projectId: string): Promise<{ status: string; failureReason: string | null }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/provisioning`);
  }

  // ---- Schema ------------------------------------------------------------

  listTables(projectId: string, schema = 'public'): Promise<{ tables: Table[] }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/tables`, { query: { schema } });
  }

  createTable(
    projectId: string,
    input: {
      name: string;
      columns: ColumnInput[];
      rlsUserColumn?: string;
    },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/tables`, { method: 'POST', body: input });
  }

  addColumn(projectId: string, table: string, column: ColumnInput): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/columns`,
      { method: 'POST', body: column },
    );
  }

  dropColumn(projectId: string, table: string, column: string): Promise<void> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/columns/${encodeURIComponent(column)}`,
      { method: 'DELETE' },
    );
  }

  setExposure(
    projectId: string,
    table: string,
    exposure: { select: boolean; insert: boolean; update: boolean; delete: boolean },
  ): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/exposure`,
      { method: 'POST', body: exposure },
    );
  }

  listPolicies(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/policies`);
  }

  createPolicy(
    projectId: string,
    input: { table: string; name: string; command?: string; roles?: string[]; using?: string; withCheck?: string },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/policies`, { method: 'POST', body: input });
  }

  dropPolicy(projectId: string, table: string, policy: string): Promise<void> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/policies/${encodeURIComponent(policy)}`,
      { method: 'DELETE' },
    );
  }

  // ---- Database triggers ---------------------------------------------------

  listDbTriggers(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/db-triggers`);
  }

  createDbTrigger(
    projectId: string,
    input: {
      table: string;
      name: string;
      events: Array<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>;
      function: string;
      timing?: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
      level?: 'ROW' | 'STATEMENT';
      updateColumns?: string[];
      when?: string;
      constraint?: boolean;
      deferrable?: boolean;
      initiallyDeferred?: boolean;
    },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/db-triggers`, { method: 'POST', body: input });
  }

  setDbTriggerEnabled(projectId: string, table: string, trigger: string, enabled: boolean): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/triggers/${encodeURIComponent(trigger)}/enabled`,
      { method: 'POST', body: { enabled } },
    );
  }

  dropDbTrigger(projectId: string, table: string, trigger: string): Promise<void> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/triggers/${encodeURIComponent(trigger)}`,
      { method: 'DELETE' },
    );
  }

  // ---- Indexes ---------------------------------------------------------------

  listIndexes(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/indexes`);
  }

  createIndex(
    projectId: string,
    input: {
      table: string;
      name: string;
      columns?: Array<{ column: string; order?: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST' }>;
      method?: string;
      unique?: boolean;
      expression?: string;
      where?: string;
    },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/indexes`, { method: 'POST', body: input });
  }

  dropIndex(projectId: string, name: string): Promise<void> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/indexes/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- Types -----------------------------------------------------------------

  listTypes(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types`);
  }

  createEnumType(projectId: string, input: { name: string; labels: string[] }): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types/enum`, { method: 'POST', body: input });
  }

  createCompositeType(projectId: string, input: { name: string; attributes: Array<{ name: string; type: string }> }): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types/composite`, { method: 'POST', body: input });
  }

  addTypeLabel(projectId: string, name: string, input: { label: string; before?: string; after?: string }): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types/${encodeURIComponent(name)}/labels`, { method: 'POST', body: input });
  }

  renameTypeLabel(projectId: string, name: string, input: { from: string; to: string }): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types/${encodeURIComponent(name)}/labels/rename`, { method: 'POST', body: input });
  }

  dropType(projectId: string, name: string): Promise<void> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/types/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- Views -----------------------------------------------------------------

  listViews(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/views`);
  }

  createView(
    projectId: string,
    input: { name: string; query: string; materialized?: boolean; replace?: boolean; apiSelect?: boolean },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/views`, { method: 'POST', body: input });
  }

  setViewApiAccess(projectId: string, name: string, enabled: boolean): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/views/${encodeURIComponent(name)}/api-access`, { method: 'POST', body: { enabled } });
  }

  refreshView(projectId: string, name: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/views/${encodeURIComponent(name)}/refresh`, { method: 'POST' });
  }

  dropView(projectId: string, name: string): Promise<void> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/views/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- Rows & SQL (console-grade, sql role) -------------------------------

  listRows(
    projectId: string,
    table: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<{ rows: Array<Record<string, unknown>> }> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/rows`,
      { query },
    );
  }

  insertRow(projectId: string, table: string, values: Record<string, unknown>): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/rows`,
      { method: 'POST', body: { values } },
    );
  }

  updateRow(projectId: string, table: string, id: string, values: Record<string, unknown>): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { values } },
    );
  }

  deleteRow(projectId: string, table: string, id: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  runSql(projectId: string, sql: string): Promise<{ rows: Array<Record<string, unknown>>; durationMs: number }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/sql`, { method: 'POST', body: { sql } });
  }

  // ---- SQL functions (RPC) -------------------------------------------------

  createSqlFunction(
    projectId: string,
    input: {
      name: string;
      arguments?: Array<{ name: string; type: string; default?: string }>;
      returnType: string;
      returnsSetof?: boolean;
      language?: 'sql' | 'plpgsql';
      volatility?: 'IMMUTABLE' | 'STABLE' | 'VOLATILE';
      body: string;
      apiExecute?: boolean;
    },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/sql-functions`, { method: 'POST', body: input });
  }

  dropSqlFunction(projectId: string, name: string, args?: string): Promise<void> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/sql-functions/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      query: { args },
    });
  }

  // ---- Storage ---------------------------------------------------------------

  storageUsage(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/storage/usage`);
  }

  listBuckets(projectId: string): Promise<{ buckets: Bucket[] }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/storage/buckets`);
  }

  createBucket(
    projectId: string,
    input: { name: string; public?: boolean; fileSizeLimitBytes?: number | null; allowedMimeTypes?: string[] | null },
  ): Promise<Bucket> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/storage/buckets`, { method: 'POST', body: input });
  }

  updateBucket(
    projectId: string,
    bucket: string,
    input: { public?: boolean; fileSizeLimitBytes?: number | null; allowedMimeTypes?: string[] | null },
  ): Promise<Bucket> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/storage/buckets/${encodeURIComponent(bucket)}`,
      { method: 'PATCH', body: input },
    );
  }

  deleteBucket(projectId: string, bucket: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/storage/buckets/${encodeURIComponent(bucket)}`,
      { method: 'DELETE' },
    );
  }

  listObjects(
    projectId: string,
    query: { bucket: string; prefix?: string; delimiter?: boolean; limit?: number; offset?: number; search?: string },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/storage/objects`, { query });
  }

  deleteObject(projectId: string, objectId: string): Promise<{ deleted: boolean; id: string }> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/storage/objects/${encodeURIComponent(objectId)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Reserve an upload: returns a presigned S3 POST. Bytes go straight to S3
   * (never through the engine); afterwards call completeUpload.
   */
  createUpload(
    projectId: string,
    input: { bucket: string; path: string; sizeBytes: number; mimeType?: string; fileName?: string; overwrite?: boolean },
  ): Promise<UploadSession> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/storage/uploads`, { method: 'POST', body: input });
  }

  completeUpload(projectId: string, uploadId: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/storage/uploads/${encodeURIComponent(uploadId)}/complete`,
      { method: 'POST' },
    );
  }

  /** Public URL for public buckets, signed (expiring) URL for private ones. */
  signObjectUrl(projectId: string, objectId: string, expiresIn?: number): Promise<{ public: boolean; url: string; expiresAt: string | null }> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/storage/objects/${encodeURIComponent(objectId)}/sign`,
      { method: 'POST', body: { ...(expiresIn !== undefined ? { expiresIn } : {}) } },
    );
  }

  /**
   * End-to-end file upload for agents and scripts: reserve → presigned S3
   * POST → complete. The multipart POST must carry every presigned field,
   * a Content-Type field matching the declaration, and the bytes as "file".
   */
  async uploadFile(
    projectId: string,
    input: { bucket: string; path: string; content: Uint8Array | string; mimeType?: string; fileName?: string; overwrite?: boolean },
  ): Promise<{ objectId: string; bucket: string; path: string; sizeBytes: number }> {
    const bytes = typeof input.content === 'string' ? new TextEncoder().encode(input.content) : input.content;
    const mimeType = input.mimeType ?? 'application/octet-stream';
    const session = await this.createUpload(projectId, {
      bucket: input.bucket,
      path: input.path,
      sizeBytes: bytes.byteLength,
      mimeType,
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
      overwrite: input.overwrite ?? false,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(session.upload.fields)) form.append(key, value);
    form.append('Content-Type', mimeType);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.append('file', new Blob([body], { type: mimeType }), input.fileName ?? input.path.split('/').pop() ?? 'file');
    const fetchImpl = this.http.fetchImpl;
    const response = await fetchImpl(session.upload.url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new CubiBaseError(response.status, 'storage_upload_failed', `S3 rejected the upload (${response.status})`, undefined, { detail: text.slice(0, 500) });
    }
    await this.completeUpload(projectId, session.uploadId);
    return { objectId: session.objectId, bucket: session.bucket, path: session.path, sizeBytes: bytes.byteLength };
  }

  // ---- Functions (serverless) --------------------------------------------------

  functionTemplates(): Promise<unknown> {
    return this.req('/v1/function-templates');
  }

  functionsUsage(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/usage`);
  }

  listFunctions(projectId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions`);
  }

  getFunction(projectId: string, idOrName: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}`);
  }

  createFunction(projectId: string, input: CreateFunctionInput): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions`, { method: 'POST', body: input });
  }

  updateFunction(projectId: string, idOrName: string, input: UpdateFunctionInput): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}`, { method: 'PATCH', body: input });
  }

  deleteFunction(projectId: string, idOrName: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}`, { method: 'DELETE' });
  }

  deployFunction(projectId: string, idOrName: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/deployments`, { method: 'POST' });
  }

  listDeployments(projectId: string, idOrName: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/deployments`);
  }

  activateDeployment(projectId: string, idOrName: string, deploymentId: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/deployments/${encodeURIComponent(deploymentId)}/activate`,
      { method: 'POST' },
    );
  }

  setFunctionSecret(projectId: string, idOrName: string, name: string, value: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/secrets`, {
      method: 'POST',
      body: { name, value },
    });
  }

  deleteFunctionSecret(projectId: string, idOrName: string, name: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/secrets/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  createFunctionTrigger(
    projectId: string,
    idOrName: string,
    input: { kind: 'http' | 'database' | 'storage' | 'schedule'; enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/triggers`, { method: 'POST', body: input });
  }

  updateFunctionTrigger(
    projectId: string,
    idOrName: string,
    triggerId: string,
    input: { enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/triggers/${encodeURIComponent(triggerId)}`,
      { method: 'PATCH', body: input },
    );
  }

  deleteFunctionTrigger(projectId: string, idOrName: string, triggerId: string): Promise<unknown> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/triggers/${encodeURIComponent(triggerId)}`,
      { method: 'DELETE' },
    );
  }

  testFunction(
    projectId: string,
    idOrName: string,
    input: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path?: string; headers?: Record<string, string>; body?: string | null; event?: Record<string, unknown> | null } = {},
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/${encodeURIComponent(idOrName)}/test`, { method: 'POST', body: input });
  }

  functionExecutions(
    projectId: string,
    query: { functionId?: string; trigger?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/executions`, { query });
  }

  functionExecution(projectId: string, executionId: string): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/functions/executions/${encodeURIComponent(executionId)}`);
  }

  // ---- API keys ------------------------------------------------------------

  listApiKeys(projectId: string): Promise<{ keys: ApiKey[] }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/api-keys`);
  }

  createApiKey(projectId: string, kind: 'publishable' | 'secret', name: string): Promise<ApiKey & { secret?: string }> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/api-keys`, {
      method: 'POST',
      body: { kind, name },
    });
  }

  revokeApiKey(projectId: string, keyId: string): Promise<void> {
    return this.req(
      `/v1/projects/${encodeURIComponent(projectId)}/api-keys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE' },
    );
  }

  // ---- Logs ----------------------------------------------------------------

  requestLogs(projectId: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/logs/requests`, { query });
  }

  auditLogs(projectId: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/logs/audit`, { query });
  }

  // ---- Usage ---------------------------------------------------------------

  usage(): Promise<unknown> {
    return this.req('/v1/usage');
  }

  // ---- Billing: additional usage (V4.5, read-only) --------------------------
  // Activation, deactivation and spending-limit changes are deliberately NOT
  // exposed here: they are financial consent operations that belong to an
  // organization owner/billing admin in the Console.

  /** Public pricing catalog, including the additionalUsage overage rates. */
  billingCatalog(): Promise<unknown> {
    return this.req('/v1/billing/catalog');
  }

  /** Organization overage settings: enabled, spending limit, acceptance history. */
  overageSettings(): Promise<unknown> {
    return this.req('/v1/billing/overage/settings');
  }

  /** Per-resource usage, excess and estimated overage cost for the period. */
  overageUsage(): Promise<unknown> {
    return this.req('/v1/billing/overage/usage');
  }

  /** Estimated next invoice: fixed recurring charges vs variable usage estimates. */
  overageInvoicePreview(): Promise<unknown> {
    return this.req('/v1/billing/overage/invoice-preview');
  }

  // ---- Access tokens (interactive session only) -----------------------------

  listAccessTokens(): Promise<{ tokens: AccessToken[] }> {
    return this.req('/v1/auth/tokens');
  }

  createAccessToken(input: {
    name: string;
    scope?: 'read' | 'write' | 'admin';
    projectId?: string;
    expiresInDays?: number;
  }): Promise<{ token: AccessToken; accessToken: string }> {
    return this.req('/v1/auth/tokens', { method: 'POST', body: input });
  }

  revokeAccessToken(tokenId: string): Promise<void> {
    return this.req(`/v1/auth/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
  }

  me(): Promise<{ developer: { id: string; email: string; emailVerified: boolean } }> {
    return this.req('/v1/auth/me');
  }
}
