import { CliError } from "./errors";
import type { GraphQLResponsePayload } from "./types";

export function graphqlResponseError(result: GraphQLResponsePayload, requestId?: string): CliError {
  const errors = result.errors ?? [];
  const partial = result.data !== undefined;
  const provider = {
    code: typeof errors[0]?.extensions?.code === "string" ? errors[0].extensions.code : undefined,
    request_id: requestId,
  };
  const details = partial ? {
    completed: result.data,
    failed: errors.map((error) => ({
      message: error.message ?? "Unknown GraphQL error",
      path: error.path ?? [],
      code: error.extensions?.code,
    })),
  } : undefined;
  const message = errors.map((error) => {
    const text = error.message ?? "Unknown GraphQL error";
    const code = error.extensions?.code;
    const path = error.path?.join(".");
    return [text, typeof code === "string" ? `code=${code}` : undefined, path ? `path=${path}` : undefined]
      .filter(Boolean)
      .join(" ");
  }).join("; ");
  return new CliError(
    `Fireflies API returned GraphQL errors: ${message}`,
    partial ? "PARTIAL_FAILURE" : "PROVIDER_ERROR",
    partial ? 8 : 1,
    partial ? "Some fields completed; inspect the provider paths in this error." : undefined,
    false,
    provider,
    details,
  );
}
