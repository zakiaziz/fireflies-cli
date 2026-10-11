export class CliError extends Error {
  constructor(
    message: string,
    readonly code = "INVALID_ARGUMENT",
    readonly exitCode = 2,
    readonly hint?: string,
    readonly retryable = false,
    readonly provider?: { status?: number; code?: string; request_id?: string },
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/API key|authentication|credential|Profile .* does not exist|\b401\b/i.test(message)) return new CliError(message, "AUTHENTICATION_FAILED", 3);
  if (/\b404\b|not found/i.test(message)) return new CliError(message, "NOT_FOUND", 5);
  if (/\b401\b|\b403\b|permission|forbidden/i.test(message)) return new CliError(message, "PERMISSION_DENIED", 4);
  if (/\b409\b|conflict|precondition/i.test(message)) return new CliError(message, "CONFLICT", 6);
  if (/\b429\b|rate limit|network|timed? out|\b5\d\d\b/i.test(message)) return new CliError(message, "TRANSIENT_FAILURE", 7, undefined, true);
  if (/^(Usage:|Unknown command|Unknown option|Unsupported option|Invalid option|Missing value|Option --|--|Setup needs|Profile may|fireflies .* needs)/.test(message)) {
    return new CliError(message, "INVALID_ARGUMENT", 2);
  }
  return new CliError(message, "UNEXPECTED_ERROR", 1);
}
