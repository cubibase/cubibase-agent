/**
 * Structured error for every non-2xx CubiBase response. Agents can branch on
 * `code` (stable machine identifier) and honor `retryAfterSeconds` on 429.
 */
export class CubiBaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'CubiBaseError';
  }

  /** True when retrying after a delay can succeed (429 / 503). */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503;
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      retryAfterSeconds: this.retryAfterSeconds,
      details: this.details,
    };
  }
}

export interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
}

export function toCubiBaseError(status: number, body: unknown, headers?: Headers): CubiBaseError {
  const envelope = (body ?? {}) as ErrorEnvelope;
  const retryHeader = headers?.get('retry-after');
  const retryAfterSeconds = retryHeader !== null && retryHeader !== undefined && /^\d+$/.test(retryHeader)
    ? Number(retryHeader)
    : undefined;
  return new CubiBaseError(
    status,
    envelope.error?.code ?? 'http_error',
    envelope.error?.message ?? `Request failed with status ${status}`,
    envelope.error?.requestId ?? headers?.get('x-request-id') ?? undefined,
    envelope.error?.details,
    retryAfterSeconds,
  );
}
