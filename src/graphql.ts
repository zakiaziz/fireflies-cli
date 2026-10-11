import { readFileSync } from "node:fs";
import { Kind, parse, type OperationDefinitionNode } from "graphql";
import { requireApiKey, resolveAuth } from "./auth";
import { CliError } from "./errors";
import { graphqlResponseError } from "./provider-errors";
import type {
  Fetcher,
  GlobalOptions,
  GraphQLRequestBody,
  GraphQLResponsePayload,
  OperationKind,
  OperationMatch,
  ParsedArgs,
  RequestPlan,
  RuntimeContext,
  VariableBinding,
} from "./types";
import { assertFirefliesBaseUrl } from "./url";
import {
  applyAssignments,
  getPath,
  isObject,
  parseCommandValue,
  readJsonObject,
  redact,
  setPath,
} from "./values";

export function buildOperationPlan(
  match: OperationMatch,
  parsed: ParsedArgs,
  options: GlobalOptions,
  context: RuntimeContext,
): RequestPlan {
  const allowedFlags = new Set(match.operation.bindings.flatMap((binding) => binding.flag ? [binding.flag] : []));
  const flagValues = new Map<string, string | boolean | string[]>();
  for (const flag of parsed.unknownFlags) {
    if (!allowedFlags.has(flag.name)) {
      const allowed = [...allowedFlags].sort().map((name) => `--${name}`).join(", ");
      throw new CliError(`Unknown option --${flag.name} for "${match.operation.name}".${allowed ? ` Allowed: ${allowed}` : ""}`);
    }
    const binding = match.operation.bindings.find((candidate) => candidate.flag === flag.name);
    const current = flagValues.get(flag.name);
    if (current !== undefined && binding?.kind !== "csv") {
      throw new CliError(`Option --${flag.name} may only be provided once`);
    }
    if (current !== undefined) {
      flagValues.set(flag.name, [...(Array.isArray(current) ? current : [String(current)]), String(flag.value)]);
    } else {
      flagValues.set(flag.name, flag.value);
    }
  }

  const variables = readJsonObject(options.variables);
  for (const binding of match.operation.bindings) {
    const parsedValue = binding.flag ? parsed.flags[binding.flag] : undefined;
    const raw = binding.flag
      ? flagValues.get(binding.flag) ?? (Array.isArray(parsedValue) && parsedValue.length === 1 ? parsedValue[0] : parsedValue)
      : binding.parameter ? match.parameters[binding.parameter] : undefined;
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      if (binding.kind !== "csv") throw new CliError(`Option --${binding.flag} may only be provided once`);
      setPath(variables, binding.path, raw.flatMap((item) =>
        parseCommandValue(item, binding.kind, binding.flag ?? binding.path) as unknown[]));
      continue;
    }
    setPath(variables, binding.path, parseCommandValue(raw, binding.kind, binding.flag ?? binding.parameter ?? binding.path));
  }
  applyAssignments(variables, options.set);
  validateVariables(match, variables);

  const selection = selectionBlock(options.fields ? options.fields : match.operation.selection);
  const query = `${match.operation.kind} ${match.operation.operationName}${match.operation.variableDefinitions} {\n  ${match.operation.invocation} ${selection}\n}`;
  parseDocument(query);
  const plan = createPlan(
    match.operation.kind,
    match.operation.name,
    { query, ...(Object.keys(variables).length > 0 ? { variables } : {}) },
    options,
    context,
  );
  const paginated = match.operation.bindings.some((binding) => binding.path === "limit");
  const all = parsed.flags.all === true;
  const maxItemsRaw = parsed.flags["max-items"];
  if ((all || maxItemsRaw !== undefined) && !paginated) throw new CliError(`Pagination options are unsupported for "${match.operation.name}"`);
  if (maxItemsRaw !== undefined && !all) throw new CliError("--max-items requires --all");
  const maxItems = typeof maxItemsRaw === "string" ? Number(maxItemsRaw) : undefined;
  if (maxItemsRaw !== undefined && (!Number.isInteger(maxItems) || (maxItems ?? 0) < 1)) {
    throw new CliError(`--max-items must be a positive integer; received "${String(maxItemsRaw)}"`);
  }
  return paginated
    ? { ...plan, pagination: { all, ...(maxItems ? { maxItems } : {}), offset: match.operation.bindings.some((binding) => binding.path === "skip") } }
    : plan;
}

export function buildRawRequestPlan(
  file: string,
  queryParameters: readonly string[],
  options: GlobalOptions,
  context: RuntimeContext,
): RequestPlan {
  const source = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`--file contains invalid JSON: ${reason}`);
  }
  if (!isObject(parsedBody)) throw new CliError("--file must contain a JSON object");
  const body = parsedBody as unknown as GraphQLRequestBody;
  const allowed = new Set(["query", "variables", "operationName"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new CliError(`Raw request file contains unsupported field(s): ${unknown.join(", ")}`);
  if (typeof body.query !== "string" || !body.query.trim()) throw new CliError("Raw request file requires a non-empty string query");
  if (body.variables !== undefined && !isObject(body.variables)) throw new CliError("Raw request variables must be an object");
  if (body.operationName !== undefined && typeof body.operationName !== "string") throw new CliError("Raw request operationName must be a string");
  const kind = selectedDocumentKind(body.query, body.operationName);
  const plan = createPlan(kind, "api request", body, options, context);
  const url = new URL(plan.url);
  for (const item of queryParameters) {
    const separator = item.indexOf("=");
    if (separator < 1) throw new CliError(`--query requires key=value; received "${item}"`);
    url.searchParams.append(item.slice(0, separator), item.slice(separator + 1));
  }
  return { ...plan, url: url.toString(), requiresConfirmation: true };
}

function selectedDocumentKind(document: string, operationName: string | undefined): OperationKind {
  const parsed = parseDocument(document);
  const definitions = parsed.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );
  if (definitions.length === 0) throw new CliError("GraphQL document does not contain an operation");
  const selected = operationName
    ? definitions.find((operation) => operation.name?.value === operationName)
    : definitions.length === 1 ? definitions[0] : undefined;
  if (!selected) throw new CliError(operationName
    ? `GraphQL document does not contain operation "${operationName}"`
    : "GraphQL document contains multiple operations. Set operationName in the request file.");
  if (selected.operation === "subscription") throw new CliError("Raw API requests do not support GraphQL subscriptions");
  return selected.operation;
}

export function executeRequest(plan: RequestPlan, fetcher?: Fetcher): Promise<GraphQLResponsePayload>;
export function executeRequest(plan: RequestPlan, fetcher: Fetcher | undefined, raw: true): Promise<unknown>;
export async function executeRequest(
  plan: RequestPlan,
  fetcher: Fetcher = fetch,
  raw = false,
): Promise<unknown> {
  let response: Response | undefined;
  let lastNetworkError: unknown;
  const retryableRead = plan.kind === "query" && !plan.requiresConfirmation;
  for (let attempt = 0; attempt < (retryableRead ? 3 : 1); attempt += 1) {
    try {
      response = await fetcher(plan.url, {
        method: "POST",
        headers: plan.headers,
        body: JSON.stringify(plan.body),
        signal: AbortSignal.timeout(plan.timeoutMs ?? 30_000),
        redirect: "error",
      });
      if (!(response.status === 429 || response.status >= 500) || attempt === 2 || !retryableRead) break;
      await response.body?.cancel();
      await delay(retryDelay(response, attempt));
    } catch (error) {
      lastNetworkError = error;
      if (!retryableRead || attempt === 2) break;
      await delay(100 * (2 ** attempt));
    }
  }
  if (!response) {
    const reason = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
    throw new CliError(`Fireflies request failed: ${reason}`, "TRANSIENT_FAILURE", 7, undefined, true);
  }
  const text = await response.text();
  const payload = parseResponsePayload(text, response.headers.get("content-type"));
  if (!response.ok) {
    const provider = providerMetadata(response, payload);
    const [code, exitCode, retryable] = response.status === 401
      ? ["AUTHENTICATION_FAILED", 3, false] as const
      : response.status === 403
        ? ["PERMISSION_DENIED", 4, false] as const
        : response.status === 404
          ? ["NOT_FOUND", 5, false] as const
          : response.status === 409
            ? ["CONFLICT", 6, false] as const
            : response.status === 429 || response.status >= 500
              ? ["TRANSIENT_FAILURE", 7, true] as const
              : ["PROVIDER_ERROR", 1, false] as const;
    throw new CliError(
      `Fireflies API returned ${response.status} ${response.statusText}: ${formatPayload(payload)}`,
      code,
      exitCode,
      undefined,
      retryable,
      provider,
    );
  }
  if (raw) return payload;
  if (!isObject(payload)) {
    throw new Error(`Fireflies API returned a non-JSON response: ${formatPayload(payload)}`);
  }
  const result = payload as GraphQLResponsePayload;
  if (result.errors && result.errors.length > 0) {
    throw graphqlResponseError(result, response.headers.get("x-request-id") ?? undefined);
  }
  return result;
}

export function renderDryRun(plan: RequestPlan): unknown {
  return {
    kind: plan.kind,
    operation: plan.operation,
    url: plan.url,
    auth: { source: plan.auth.source },
    headers: redact(plan.headers),
    body: redact(plan.body),
  };
}

function createPlan(
  kind: OperationKind,
  operation: string,
  body: GraphQLRequestBody,
  options: GlobalOptions,
  context: RuntimeContext,
): RequestPlan {
  assertFirefliesBaseUrl(context.baseUrl);
  const auth = resolveAuth(options, context);
  const apiKey = requireApiKey(auth, operation);
  return {
    kind,
    operation,
    url: context.baseUrl,
    auth,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    timeoutMs: options.timeoutMs,
  };
}

function validateVariables(match: OperationMatch, variables: Record<string, unknown>): void {
  const allowedRoots = new Set(match.operation.bindings.map((binding) => binding.path.split(".")[0]));
  for (const root of Object.keys(variables)) {
    if (!allowedRoots.has(root)) throw new CliError(`Unknown variable "${root}" for "${match.operation.name}"`);
  }
  for (const binding of match.operation.bindings) validateBinding(binding, variables);
  match.operation.validate?.(variables);
}

function validateBinding(binding: VariableBinding, variables: Record<string, unknown>): void {
  const value = getPath(variables, binding.path);
  const label = binding.flag ? `--${binding.flag}` : binding.parameter ?? binding.path;
  if (value === undefined || value === null) {
    if (binding.required) throw new CliError(`Missing required ${binding.flag ? `--${binding.flag}` : `<${label}>`}`);
    return;
  }

  if (binding.jsonShape === "array" && !Array.isArray(value)) throw new CliError(`${label} must be a JSON array`);
  if (binding.jsonShape === "object" && !isObject(value)) throw new CliError(`${label} must be a JSON object`);
  const values = Array.isArray(value) ? value : [value];
  if (binding.choices) {
    for (const child of values) {
      if (!binding.choices.includes(child as string | number | boolean)) {
        throw new CliError(`${label} must be one of: ${binding.choices.join(", ")}`);
      }
    }
  }
  if (typeof value === "number" && binding.minimum !== undefined && value < binding.minimum) {
    throw new CliError(`${label} must be at least ${binding.minimum}`);
  }
  if (typeof value === "number" && binding.maximum !== undefined && value > binding.maximum) {
    throw new CliError(`${label} must be at most ${binding.maximum}`);
  }
  if (typeof value === "string" && binding.minLength !== undefined && value.length < binding.minLength) {
    throw new CliError(`${label} must contain at least ${binding.minLength} characters`);
  }
  if (typeof value === "string" && binding.maxLength !== undefined && value.length > binding.maxLength) {
    throw new CliError(`${label} must contain at most ${binding.maxLength} characters`);
  }
  if (typeof value === "string" && binding.kind === "string" && binding.flag
    && ["from-date", "to-date"].includes(binding.flag)
    && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new CliError(`${label} must be an ISO 8601 date or date-time with an explicit offset`);
  }
  if (Array.isArray(value) && binding.minItems !== undefined && value.length < binding.minItems) {
    throw new CliError(`${label} must contain at least ${binding.minItems} values`);
  }
  if (Array.isArray(value) && binding.maxItems !== undefined && value.length > binding.maxItems) {
    throw new CliError(`${label} must contain at most ${binding.maxItems} values`);
  }
}

function selectionBlock(selection: string): string {
  const trimmed = selection.trim();
  if (!trimmed) throw new CliError("--fields cannot be empty");
  return trimmed.startsWith("{") ? trimmed : `{\n${trimmed}\n  }`;
}

function parseDocument(document: string): ReturnType<typeof parse> {
  try {
    return parse(document);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`Invalid GraphQL document: ${reason}`);
  }
}

function parseResponsePayload(text: string, contentType: string | null): unknown {
  if (!text) return null;
  if (contentType?.includes("application/json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 2000);
  return 100 * (2 ** attempt);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerMetadata(response: Response, payload: unknown): { status: number; code?: string; request_id?: string } {
  const record = isObject(payload) ? payload : {};
  const code = typeof record.code === "string" ? record.code : typeof record.error === "string" ? record.error : undefined;
  const requestId = response.headers.get("x-request-id")
    ?? response.headers.get("request-id")
    ?? (typeof record.request_id === "string" ? record.request_id : undefined);
  return {
    status: response.status,
    ...(code ? { code } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}


function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}
