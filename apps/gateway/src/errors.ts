import type { ApiProblem } from "@harbor/contracts";

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { retryable?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function problemFromError(
  error: unknown,
  requestId: string,
): ApiProblem {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
      details: error.details,
    };
  }

  if (typeof error === "object" && error !== null && "validation" in error) {
    const validation = (error as { validation?: unknown }).validation;
    return {
      code: "validation_error",
      message: "Request validation failed.",
      retryable: false,
      requestId,
      details: Array.isArray(validation)
        ? validation.map((item) => {
            if (!item || typeof item !== "object")
              return { message: "Invalid field." };
            const value = item as Record<string, unknown>;
            return {
              field:
                typeof value.instancePath === "string"
                  ? value.instancePath
                  : undefined,
              message:
                typeof value.message === "string"
                  ? value.message
                  : "Invalid field.",
            };
          })
        : undefined,
    };
  }

  return {
    code: "internal_error",
    message: "The gateway could not complete the request.",
    retryable: false,
    requestId,
  };
}
