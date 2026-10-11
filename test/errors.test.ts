import { describe, expect, test } from "bun:test";
import { CliError, normalizeError } from "../src/errors";

describe("error classification", () => {
  test("preserves typed errors and classifies external failures", () => {
    const typed = new CliError("typed", "CONFLICT", 6);
    expect(normalizeError(typed)).toBe(typed);

    for (const [message, code, exitCode, retryable] of [
      ["Missing API key", "AUTHENTICATION_FAILED", 3, false],
      ["404 not found", "NOT_FOUND", 5, false],
      ["403 forbidden", "PERMISSION_DENIED", 4, false],
      ["409 conflict", "CONFLICT", 6, false],
      ["429 rate limit", "TRANSIENT_FAILURE", 7, true],
      ["unexpected", "UNEXPECTED_ERROR", 1, false],
    ] as const) {
      expect(normalizeError(new Error(message))).toMatchObject({ code, exitCode, retryable });
    }
    expect(normalizeError("network failed")).toMatchObject({ code: "TRANSIENT_FAILURE", exitCode: 7 });
  });
});
