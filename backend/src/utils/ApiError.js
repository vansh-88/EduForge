export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Capture the stack trace, excluding the constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, opts) {
    return new ApiError(400, message, opts);
  }

  static unauthorized(message, opts) {
    return new ApiError(401, message, opts);
  }

  static forbidden(message, opts) {
    return new ApiError(403, message, opts);
  }

  static notFound(message, opts) {
    return new ApiError(404, message, opts);
  }

  static conflict(message, opts) {
    return new ApiError(409, message, opts);
  }
}