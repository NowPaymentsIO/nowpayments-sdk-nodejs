import { APIError, NetworkError } from './errors.js';
import { assertConfiguredApiKey, compactObject } from './validators.js';

function safeHeader(response, name) {
  try {
    return response.headers?.get?.(name) ?? undefined;
  } catch {
    return undefined;
  }
}

function sanitizeApiErrorBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const details = {};
  for (const key of ['code', 'message', 'error', 'statusCode']) {
    if (body[key] !== undefined && typeof body[key] !== 'object') {
      details[key] = body[key];
    }
  }
  return Object.keys(details).length ? details : undefined;
}

function extractApiErrorMessage(body, status) {
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  }
  if (typeof body === 'string' && body.trim() && body.length < 300) return body;
  return `Payment API request failed with status ${status}.`;
}

async function readResponseBody(response) {
  const contentType = safeHeader(response, 'content-type') || '';
  if (response.status === 204) return null;
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

export class HttpClient {
  constructor({ apiKey, baseUrl, timeoutMs = 30000, fetchImpl, userAgent, getJwtToken, autoAuthenticate } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.nowpayments.io').replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.userAgent = userAgent || '@nowpayments-sdk/node/0.1.0';
    this.getJwtToken = getJwtToken;
    this.autoAuthenticate = autoAuthenticate;

    if (typeof this.fetchImpl !== 'function') {
      throw new NetworkError('No fetch implementation is available. Use Node.js >= 18 or pass { fetch } to the SDK constructor.', {
        code: 'FETCH_UNAVAILABLE'
      });
    }
  }

  buildUrl(path, query) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(path, { method = 'GET', query, body, apiKey = true, bearer = false, headers = {}, timeoutMs } = {}) {
    if (apiKey) assertConfiguredApiKey(this.apiKey);

    const url = this.buildUrl(path, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);

    const requestHeaders = compactObject({
      accept: 'application/json',
      'content-type': body === undefined ? undefined : 'application/json',
      'user-agent': this.userAgent,
      'x-api-key': apiKey ? this.apiKey : undefined,
      ...headers
    });

    if (bearer) {
      let token = this.getJwtToken?.();
      if (!token && this.autoAuthenticate) {
        token = await this.autoAuthenticate();
      }
      if (token) requestHeaders.authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === 'AbortError') {
        throw new NetworkError('Payment API request timed out.', {
          type: 'timeout',
          code: 'REQUEST_TIMEOUT',
          details: { path, timeoutMs: timeoutMs ?? this.timeoutMs },
          cause: error
        });
      }
      throw new NetworkError('Network error while calling payment API.', {
        code: 'NETWORK_ERROR',
        details: { path },
        cause: error
      });
    }

    clearTimeout(timeout);
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw new APIError(extractApiErrorMessage(responseBody, response.status), {
        code: 'API_REQUEST_FAILED',
        httpStatus: response.status,
        requestId: safeHeader(response, 'x-request-id') || safeHeader(response, 'cf-ray'),
        details: sanitizeApiErrorBody(responseBody)
      });
    }

    return responseBody;
  }
}
