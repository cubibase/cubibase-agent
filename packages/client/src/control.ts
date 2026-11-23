import { HttpTransport, type RequestOptions } from './http.js';

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
      columns: Array<{ name: string; type: string; primaryKey?: boolean; nullable?: boolean; default?: string }>;
      rlsUserColumn?: string;
    },
  ): Promise<unknown> {
    return this.req(`/v1/projects/${encodeURIComponent(projectId)}/tables`, { method: 'POST', body: input });
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
