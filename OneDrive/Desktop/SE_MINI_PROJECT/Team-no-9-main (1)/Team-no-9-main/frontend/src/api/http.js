// Fetch wrapper for the REST API (SAD 4.3.1).
// Every request sends the auth cookie (credentials: 'include'). Error responses
// become an ApiError carrying the SAD error shape:
//   {"error": {"code": "VALIDATION_ERROR", "message": "...",
//              "fields": [{"field": "value", "message": "must be 0 or more"}]}}
// A 401 means the session is missing, expired or revoked; screens show
// "Please log in again" for it (see useApiResource and SessionExpired).

export class ApiError extends Error {
  constructor(status, { code, message, fields } = {}) {
    super(message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? null;
    this.fields = Array.isArray(fields) ? fields : [];
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'include', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'Could not reach the server.' });
  }

  // 202 and 204 replies have no body.
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? {});
  return data;
}

export function isUnauthorized(error) {
  return error?.status === 401;
}

/** Field-level messages from a VALIDATION_ERROR, keyed by field name. */
export function fieldErrors(error) {
  return Object.fromEntries((error?.fields ?? []).map((f) => [f.field, f.message]));
}
