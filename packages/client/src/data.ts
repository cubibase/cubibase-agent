import { HttpTransport } from './http.js';

export interface DataClientOptions {
  /** Project API origin, e.g. https://my-app.api.cubibase.com */
  baseUrl: string;
  /** Publishable key (cb_pub_...) — identifies the project. */
  publishableKey?: string;
  /** End-user JWT, or secret key (cb_sec_...) for trusted server-side access. */
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ListOptions {
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  /** Column filters: { status: 'eq.active', age: 'gte.18' } */
  filters?: Record<string, string>;
}

/**
 * CubiBase Data API client for one project. Rows are returned unwrapped
 * from the { data } envelope. RLS always applies: user tokens see their own
 * rows; a secret key acts as the service actor (cubibase.role = 'service').
 */
export class DataClient {
  readonly http: HttpTransport;

  constructor(options: DataClientOptions) {
    const headers: Record<string, string> = {};
    if (options.publishableKey) headers.apikey = options.publishableKey;
    this.http = new HttpTransport({
      baseUrl: options.baseUrl,
      token: options.token,
      fetchImpl: options.fetchImpl,
      defaultHeaders: headers,
    });
  }

  /** Set the end-user JWT (sign-in) or secret key (service actor). */
  setToken(token: string | undefined): void {
    this.http.setToken(token);
  }

  async list<T = Record<string, unknown>>(table: string, options: ListOptions = {}): Promise<T[]> {
    const body = await this.http.request<{ data: T[] }>(`/rest/v1/${encodeURIComponent(table)}`, {
      query: {
        select: options.select,
        order: options.order,
        limit: options.limit,
        offset: options.offset,
        ...options.filters,
      },
    });
    return body.data;
  }

  async get<T = Record<string, unknown>>(table: string, id: string): Promise<T | null> {
    const body = await this.http.request<{ data: T | null }>(
      `/rest/v1/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
    );
    return body.data;
  }

  async insert<T = Record<string, unknown>>(table: string, values: Record<string, unknown>): Promise<T> {
    const body = await this.http.request<{ data: T }>(`/rest/v1/${encodeURIComponent(table)}`, {
      method: 'POST',
      body: values,
    });
    return body.data;
  }

  async update<T = Record<string, unknown>>(
    table: string,
    id: string,
    values: Record<string, unknown>,
  ): Promise<T> {
    const body = await this.http.request<{ data: T }>(
      `/rest/v1/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: values },
    );
    return body.data;
  }

  async remove<T = Record<string, unknown>>(table: string, id: string): Promise<T> {
    const body = await this.http.request<{ data: T }>(
      `/rest/v1/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return body.data;
  }

  /** Call a public function granted EXECUTE to the api role. */
  async rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const body = await this.http.request<{ data: T }>(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: args,
    });
    return body.data;
  }

  /** The project's generated OpenAPI 3.1 document (live schema). */
  openapi(): Promise<Record<string, unknown>> {
    return this.http.request('/rest/v1/openapi.json');
  }

  // ---- End-user auth -------------------------------------------------------

  async signUp(input: { email: string; password: string; data?: Record<string, unknown> }): Promise<unknown> {
    return this.http.request('/auth/v1/signup', { method: 'POST', body: input });
  }

  async signIn(input: { email: string; password: string; totpCode?: string }): Promise<{
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    mfaRequired?: boolean;
    challengeToken?: string;
  }> {
    return this.http.request('/auth/v1/token', {
      method: 'POST',
      query: { grant_type: 'password' },
      body: input,
    });
  }

  async refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return this.http.request('/auth/v1/token', {
      method: 'POST',
      query: { grant_type: 'refresh_token' },
      body: { refreshToken },
    });
  }
}
