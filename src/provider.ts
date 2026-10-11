import { CliError, type ErrorCode } from "./core/errors.js";
import type { Provider, ProviderErrorDetail } from "./core/provider.js";
import { isRecord, visibleAsciiConstraint } from "./core/values.js";
import { commands, groups, offsetPagination } from "./registry.js";

const VERIFY_QUERY = "query VerifyCredential { user { user_id email name is_admin } }";

const ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  UNAUTHENTICATED: "AUTHENTICATION_FAILED",
  auth_failed: "AUTHENTICATION_FAILED",
  FORBIDDEN: "PERMISSION_DENIED",
  forbidden: "PERMISSION_DENIED",
  require_elevated_privilege: "PERMISSION_DENIED",
  not_in_team: "PERMISSION_DENIED",
  paid_required: "PERMISSION_DENIED",
  account_cancelled: "PERMISSION_DENIED",
  object_not_found: "NOT_FOUND",
  too_many_requests: "RATE_LIMITED",
  BAD_USER_INPUT: "INVALID_REQUEST",
  GRAPHQL_VALIDATION_FAILED: "INVALID_REQUEST",
  invalid_arguments: "INVALID_REQUEST",
  args_required: "INVALID_REQUEST",
  invalid_language_code: "INVALID_REQUEST",
  file_size_error: "INVALID_REQUEST",
  payload_too_small: "INVALID_REQUEST",
  request_size_exceeded: "INVALID_REQUEST",
  unsupported_platform: "INVALID_REQUEST",
};

export const provider: Provider = {
  bin: "fireflies",
  name: "Fireflies",
  secrets: [{ key: "apiKey", label: "API key", validate: visibleAsciiConstraint }],
  authScheme: "a bearer token",
  authorize: (credential) => ({ Authorization: `Bearer ${credential.apiKey}` }),
  baseUrl: { default: "https://api.fireflies.ai/graphql", allowPath: true },
  protocol: "graphql",
  rootFailure,
  requestIdHeader: "x-request-id",
  errorDetail,
  errorCodes: ERROR_CODES,
  pagination: offsetPagination,
  verify: {
    method: "POST",
    path: "/graphql",
    query: [],
    body: { query: VERIFY_QUERY },
    field: "user",
    effect: "Sends POST /graphql with the VerifyCredential query. Success proves that Fireflies accepted the API key and identifies its owner. It does not prove complete permission coverage.",
    validate(user) {
      if (!isRecord(user)) throw new CliError("INVALID_RESPONSE", "Fireflies returned no user for the credential check.");
    },
    identity: (user) => user,
  },
  api: {
    methods: ["POST"],
    graphql: true,
    examples: ["fireflies api request POST /graphql --file request.json --dry-run", "fireflies api request POST /graphql --file request.json --yes"],
  },
  groups,
  commands,
};

function errorDetail(body: unknown): ProviderErrorDetail {
  if (!isRecord(body)) return {};
  const first = Array.isArray(body.errors) ? body.errors.find(isRecord) : undefined;
  const extensions = first && isRecord(first.extensions) ? first.extensions : undefined;
  const message = [first?.message, body.message, body.error].find((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  const code = [extensions?.code, body.code].find((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  return {
    ...(message ? { message } : {}),
    ...(code ? { code } : {}),
    ...(typeof body.request_id === "string" ? { requestId: body.request_id } : {}),
  };
}

function rootFailure(root: unknown): ProviderErrorDetail | undefined {
  if (!isRecord(root) || root.success !== false) return undefined;
  return { message: typeof root.message === "string" && root.message !== "" ? root.message : "Fireflies reported success false." };
}
