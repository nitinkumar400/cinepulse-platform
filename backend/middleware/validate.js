const { ZodError } = require('zod');

function fromRequest(schema, req) {
  return schema.parse({
    body: req.body,
    query: req.query,
    params: req.params,
  });
}

function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = fromRequest(schema, req);
      req.validated = parsed;
      if (parsed.body) req.body = parsed.body;
      if (parsed.query) req.query = parsed.query;
      if (parsed.params) req.params = parsed.params;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed.',
          error: {
            code: 'VALIDATION_ERROR',
            details: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        });
      }
      return next(error);
    }
  };
}

module.exports = {
  validate,
};
