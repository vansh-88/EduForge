


export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    // Pass the Zod error directly to the global error handler
    return next(result.error);
  }

  // Overwrite req.body with validated and typed data
  req.body = result.data;
  next();
};