/** Error shape for every non-2xx response (spec section 9). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, "UNAUTHORIZED", "You must be signed in"),
  forbidden: (msg = "You do not have permission to do this") => new ApiError(403, "FORBIDDEN", msg),
  /** Cross-tenant and missing records are indistinguishable by design (spec 4.4). */
  notFound: (entity = "Record") => new ApiError(404, `${entity.toUpperCase().replace(/\s+/g, "_")}_NOT_FOUND`, `${entity} not found`),
  validation: (details: Record<string, unknown>) => new ApiError(422, "VALIDATION_ERROR", "Some fields are invalid", details),
  conflict: (code: string, msg: string) => new ApiError(409, code, msg),
  rateLimited: () => new ApiError(429, "RATE_LIMITED", "Too many requests. Please try again shortly."),
  bad: (code: string, msg: string, details: Record<string, unknown> = {}) => new ApiError(400, code, msg, details),
};
