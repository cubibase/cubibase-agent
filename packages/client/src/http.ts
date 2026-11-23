import { CubiBaseError, toCubiBaseError } from './errors.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Abort after this many milliseconds (default 30_000). */
  timeoutMs?: number;
}

export interface HttpTransportOptions {
  baseUrl: string;
  /** Bearer credential: session JWT or personal access token (cb_pat_). */
  token?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

/**
 * Minimal JSON transport. Every non-2xx response becomes a CubiBaseError
 * carrying the engine's stable error code, requestId, and Retry-After.
 */
export class HttpTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload: string | undefined;
    if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    const response = await this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      throw toCubiBaseError(response.status, body, response.headers);
    }
    return body as T;
  }
}

export { CubiBaseError };
