const DEFAULT_MESSAGES = {
  configuration: 'SDK configuration error.',
  validation: 'Input validation error.',
  network: 'Network error while calling payment API.',
  timeout: 'Payment API request timed out.',
  api: 'Payment API returned an error.',
  unknown: 'Unexpected SDK error.'
};

export class SDKError extends Error {
  constructor({ type = 'unknown', code = 'SDK_ERROR', message, httpStatus, requestId, details, cause } = {}) {
    super(message || DEFAULT_MESSAGES[type] || DEFAULT_MESSAGES.unknown, { cause });
    this.name = 'SDKError';
    this.type = type;
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      details: this.details
    };
  }
}

export class ConfigurationError extends SDKError {
  constructor(message, options = {}) {
    super({ type: 'configuration', code: options.code || 'CONFIGURATION_ERROR', message, ...options });
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends SDKError {
  constructor(message, options = {}) {
    super({ type: 'validation', code: options.code || 'VALIDATION_ERROR', message, ...options });
    this.name = 'ValidationError';
  }
}

export class NetworkError extends SDKError {
  constructor(message, options = {}) {
    super({ type: options.type || 'network', code: options.code || 'NETWORK_ERROR', message, ...options });
    this.name = 'NetworkError';
  }
}

export class APIError extends SDKError {
  constructor(message, options = {}) {
    super({ type: 'api', code: options.code || 'API_ERROR', message, ...options });
    this.name = 'APIError';
  }
}

export function isSDKError(error) {
  return error instanceof SDKError;
}

export function toSDKError(error) {
  if (isSDKError(error)) return error;
  return new SDKError({
    type: 'unknown',
    code: 'UNEXPECTED_ERROR',
    message: error?.message || 'Unexpected SDK error.',
    cause: error
  });
}
