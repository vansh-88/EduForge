


export const validate = (schema, source = 'body') => (req, res, next) => {
  // Parse the specified source (body, query, params, etc.)
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    // Pass the Zod error directly to the global error handler
    return next(result.error);
  }

  // Initialize req.validated if it doesn't exist (supports stacked validations)
  req.validated ??= {};

  // Store the validated and typed data safely
  req.validated[source] = result.data;
  
  next();
};