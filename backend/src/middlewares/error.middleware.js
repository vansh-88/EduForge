import {NODE_ENV} from '../config/env.config.js';
import { ApiError } from '../utils/ApiError.js';

export const errorHandler = (err, req, res, next) => {
  
  // 1. Intercept custom API Errors first (Most specific)
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.code && { code: err.code }),
      ...(err.details && { details: err.details }),
    });
  }

  // 2. Intercept Zod Validation Errors
  if (err.name === 'ZodError') {
    const rawIssues = err.issues || err.errors || [];

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: rawIssues.map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join('.') : '',
        message: issue.message,
      })),
    });
  }

  // 3. Intercept MongoDB Duplicate Key Errors (e.g., unique indexes)
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: 'Resource already exists',
      message: err.message,
    });
  }

  // 4. Fallback for all other errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  return res.status(statusCode).json({
    success: false,
    error: message,
    // Only leak stack traces in development
    ...(NODE_ENV !== 'production' && { stack: err.stack }),
  });
};