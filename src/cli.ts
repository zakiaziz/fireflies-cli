import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getGlobalOptions, getString, parseArgs } from "./args";
import { loadRuntimeContext } from "./auth";
import { completionScript } from "./completions";
import {
  configGet,
  configPath,
  configSet,
  configUnset,
  deleteProfile,
  getActiveProfileName,
  listProfiles,
  profilePath,
  readConfig,
  readProfile,
  requireProfile,
  setActiveProfileName,
  showProfile,
  writeProfile,
} from "./config";
import { CliError } from "./errors";
import { buildOperationPlan, buildRawRequestPlan, executeRequest, renderDryRun } from "./graphql";
import { commandUsage, findOperation, operations, utilityCommands } from "./operations";
import { configureOutput, printEnvelope, printJson, printRedacted, printText } from "./output";
import type { Fetcher, GlobalOptions, ParsedArgs, Profile, RequestPlan } from "./types";
import { parseLiteral, redact } from "./values";

export interface CliDependencies {
  readonly fetcher?: Fetcher;
  readonly readSecret?: (prompt: string) => Promise<string>;
  readonly stdinIsTTY?: boolean;
  readonly confirm?: (prompt: string) => Promise<boolean>;
}

export async function main(argv = process.argv.slice(2), dependencies: CliDependencies = {}): Promise<void> {
  const parsed = parseArgs(argv);
  const options = getGlobalOptions(parsed);
  configureOutput(options);

  if (options.version) {
    printText(`fireflies ${version()}`);
    return;
  }
  if (options.help || parsed.command.length === 0) {
    printText(parsed.command.length === 0 ? help() : commandHelp(parsed.command));
    return;
  }
  await dispatch(parsed, options, dependencies);
}

async function dispatch(parsed: ParsedArgs, options: GlobalOptions, dependencies: CliDependencies): Promise<void> {
  const [group, action] = parsed.command;
  if (group === "setup") {
    await runSetup(parsed, dependencies);
    return;
  }
  if (group === "profiles") {
    runProfiles(parsed);
    return;
  }
  if (group === "config") {
    runConfig(parsed);
    return;
  }
  if (group === "auth") {
    await runAuth(parsed, options, dependencies);
    return;
  }
  if (group === "completions") {
    assertNoUnknownFlags(parsed);
    assertAllowedGlobalFlags(parsed, []);
    assertPositionals(parsed, 2, "Usage: fireflies completions <bash|zsh|fish>");
    printText(completionScript(action));
    return;
  }
  if (group === "api") {
    await runRawApi(parsed, options, dependencies);
    return;
  }

  const match = findOperation(parsed.command);
  if (!match) throw new CliError(`Unknown command "${parsed.command.join(" ")}". Run fireflies --help.`);
  assertAllowedGlobalFlags(parsed, [
    "profile",
    "api-key",
    "base-url",
    "variables",
    "fields",
    "set",
    "dry-run",
    "timeout",
    ...(match.operation.bindings.some((binding) => binding.path === "limit") ? ["all", "max-items"] : []),
    ...(match.operation.kind === "mutation" ? ["yes"] : []),
  ]);
  const plan = buildOperationPlan(match, parsed, options, loadRuntimeContext(options));
  await runPlan(plan, options, dependencies);
}

async function runSetup(parsed: ParsedArgs, dependencies: CliDependencies): Promise<void> {
  assertNoUnknownFlags(parsed);
  assertAllowedGlobalFlags(parsed, ["profile", "api-key", "base-url", "from-env"]);
  if (parsed.command.length > 2) {
    throw new CliError("Usage: fireflies setup [profile] [--api-key KEY] [--base-url URL] [--from-env]");
  }
  const optionProfile = getString(parsed.flags, "profile");
  if (optionProfile && parsed.command[1]) throw new CliError("Profile may be supplied as a positional argument or --profile, not both");
  const profileName = optionProfile ?? parsed.command[1] ?? "default";
  const fromEnvironment = Boolean(parsed.flags["from-env"]);
  if (fromEnvironment && parsed.flags["api-key"] !== undefined) throw new CliError("--from-env cannot be combined with --api-key");
  let apiKey = getString(parsed.flags, "api-key");
  if (fromEnvironment) apiKey = apiKey ?? process.env.FIREFLIES_API_KEY;
  const ci = !["", "0", "false"].includes((process.env.CI ?? "").toLowerCase());
  if (!apiKey && !parsed.flags["no-input"] && !ci && (dependencies.stdinIsTTY ?? process.stdin.isTTY)) {
    apiKey = (await (dependencies.readSecret ?? askSecret)("Fireflies API key: ")).trim() || undefined;
  }
  if (!apiKey) throw new CliError("Setup needs an API key. Use --api-key, --from-env, or an interactive terminal.");
  if (readProfile(profileName)) throw new CliError(`Profile "${profileName}" already exists`, "CONFLICT", 6);
  const baseUrl = getString(parsed.flags, "base-url");
  writeProfile(profileName, { apiKey, ...(baseUrl ? { baseUrl } : {}) });
  setActiveProfileName(profileName);
  printJson({ profile: profileName, path: profilePath(profileName), active: true });
}

export async function askSecret(
  prompt: string,
  promptInput: Readable = input,
  promptOutput: Writable = output,
): Promise<string> {
  let muted = false;
  const hiddenOutput = new Writable({
    /* c8 ignore next */
    write(chunk, _encoding, callback) {
      if (!muted) promptOutput.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: promptInput, output: hiddenOutput, terminal: true });
  try {
    const answer = rl.question(prompt);
    muted = true;
    return await answer;
  } finally {
    rl.close();
    promptOutput.write("\n");
  }
}

function runProfiles(parsed: ParsedArgs): void {
  assertNoUnknownFlags(parsed);
  const action = parsed.command[1];
  const allowedFlags = action === "create" || action === "update" ? ["api-key", "base-url"] : [];
  assertAllowedGlobalFlags(parsed, allowedFlags);
  const name = parsed.command[2] ?? "";
  switch (action) {
    case "list":
      assertPositionals(parsed, 2, "Usage: fireflies profiles list");
      printEnvelope(listProfiles(), { active: getActiveProfileName() });
      return;
    case "get":
      assertPositionals(parsed, 3, "Usage: fireflies profiles get <name>");
      printRedacted(showProfile(name));
      return;
    case "create":
    case "update": {
      assertPositionals(parsed, 3, `Usage: fireflies profiles ${action} <name> --api-key KEY`);
      if (action === "create" && readProfile(name)) throw new CliError(`Profile "${name}" already exists`, "CONFLICT", 6);
      const existing = action === "update" ? requireProfile(name) : {};
      const profile: Profile = { ...existing, ...profileFieldsFromFlags(parsed) };
      if (!profile.apiKey) throw new CliError(`fireflies profiles ${action} needs --api-key`);
      writeProfile(name, profile);
      printJson({ profile: name, path: profilePath(name) });
      return;
    }
    case "delete":
      assertPositionals(parsed, 3, "Usage: fireflies profiles delete <name>");
      deleteProfile(name);
      printJson({ deleted: name });
      return;
    case "use":
      assertPositionals(parsed, 3, "Usage: fireflies profiles use <name>");
      requireProfile(name);
      setActiveProfileName(name);
      printJson({ active: name });
      return;
    default:
      throw new CliError("Usage: fireflies profiles <list|get|create|update|delete|use> [name]");
  }
}

function runConfig(parsed: ParsedArgs): void {
  assertNoUnknownFlags(parsed);
  assertAllowedGlobalFlags(parsed, []);
  const action = parsed.command[1];
  const key = parsed.command[2];
  switch (action) {
    case "path":
      assertPositionals(parsed, 2, "Usage: fireflies config path");
      printJson({ config: configPath() });
      return;
    case "list":
      assertPositionals(parsed, 2, "Usage: fireflies config list");
      printRedacted(readConfig());
      return;
    case "get":
      assertPositionals(parsed, 3, "Usage: fireflies config get <key>");
      if (!key) throw new CliError("Usage: fireflies config get <key>");
      printJson(configGet(key));
      return;
    case "set": {
      assertPositionals(parsed, 4, "Usage: fireflies config set <key> <value>");
      const value = parsed.command[3];
      if (!key || value === undefined) throw new CliError("Usage: fireflies config set <key> <value>");
      printRedacted(configSet(key, parseLiteral(value)));
      return;
    }
    case "unset":
      assertPositionals(parsed, 3, "Usage: fireflies config unset <key>");
      if (!key) throw new CliError("Usage: fireflies config unset <key>");
      printRedacted(configUnset(key));
      return;
    default:
      throw new CliError("Usage: fireflies config <path|list|get|set|unset>");
  }
}

async function runAuth(parsed: ParsedArgs, options: GlobalOptions, dependencies: CliDependencies): Promise<void> {
  assertNoUnknownFlags(parsed);
  assertAllowedGlobalFlags(parsed, ["profile", "api-key", "base-url", "dry-run", "timeout"]);
  if (parsed.command.length !== 2 || parsed.command[1] !== "verify") {
    throw new CliError("Usage: fireflies auth verify");
  }
  const match = findOperation(["users", "get"]);
  if (!match) throw new Error("Internal error: user verification operation is unavailable");
  const verificationArgs: ParsedArgs = { command: ["users", "get"], flags: parsed.flags, unknownFlags: [] };
  const plan = buildOperationPlan(match, verificationArgs, options, loadRuntimeContext(options));
  await runPlan(plan, options, dependencies);
}

async function runRawApi(parsed: ParsedArgs, options: GlobalOptions, dependencies: CliDependencies): Promise<void> {
  assertNoUnknownFlags(parsed);
  assertAllowedGlobalFlags(parsed, ["profile", "api-key", "base-url", "file", "query", "dry-run", "yes", "timeout"]);
  assertPositionals(parsed, 4, "Usage: fireflies api request POST /graphql --file REQUEST.json");
  const [, action, method, path] = parsed.command;
  if (action !== "request" || method !== "POST" || path !== "/graphql") {
    throw new CliError("Fireflies raw access supports only: fireflies api request POST /graphql --file REQUEST.json");
  }
  const file = getString(parsed.flags, "file");
  if (!file) throw new CliError("fireflies api request requires --file REQUEST.json");
  const query = parsed.flags.query;
  const queryParameters = Array.isArray(query) ? query : typeof query === "string" ? [query] : [];
  const plan = buildRawRequestPlan(file, queryParameters, options, loadRuntimeContext(options));
  await runPlan(plan, options, dependencies, true, file === "-");
}

async function runPlan(plan: RequestPlan, options: GlobalOptions, dependencies: CliDependencies, raw = false, stdinIsContent = false): Promise<void> {
  if (options.verbose && !options.quiet) {
    process.stderr.write(`fireflies: operation=${plan.operation} profile=${options.profile ?? "active"} endpoint=${new URL(plan.url).origin} timeout_ms=${plan.timeoutMs ?? 30_000}\n`);
  }
  if ((plan.kind === "mutation" || plan.requiresConfirmation) && !options.yes && !options.dryRun) {
    const interactive = dependencies.stdinIsTTY ?? process.stdin.isTTY;
    const ci = !["", "0", "false"].includes((process.env.CI ?? "").toLowerCase());
    if (options.noInput || stdinIsContent || !interactive || ci) {
      throw new CliError(
        `"${plan.operation}" changes Fireflies state and requires confirmation.`,
        "CONFIRMATION_REQUIRED",
        9,
        "Re-run with --dry-run to preview or --yes to execute.",
      );
    }
    const confirmed = await (dependencies.confirm ?? askConfirmation)(
      `Profile: ${options.profile ?? "active"}\nTarget: ${plan.operation} ${JSON.stringify(redact(plan.body.variables ?? {}))}\nEffect: remote Fireflies mutation\nContinue? [y/N] `,
    );
    if (!confirmed) throw new CliError("Mutation declined.", "CONFIRMATION_DECLINED", 9);
  }
  if (options.dryRun) {
    printJson(renderDryRun(plan));
    return;
  }
  if (raw) {
    const response = await executeRequest(plan, dependencies.fetcher, true);
    const { printResult } = await import("./output");
    printResult(response, options, true);
    return;
  }
  const response = await executeRequest(plan, dependencies.fetcher);
  const page = extractPage(response, plan);
  if (!plan.pagination?.all) {
    if (page.collection) {
      printEnvelope(page.items, { next_cursor: page.nextCursor, has_more: page.hasMore });
    } else {
      printJson(page.value);
    }
    return;
  }
  const items = [...page.items];
  let current = page;
  let currentPlan = plan;
  const visitedCursors = new Set<string>();
  while (current.hasMore && (plan.pagination.maxItems === undefined || items.length < plan.pagination.maxItems)) {
    if (current.nextCursor) {
      if (visitedCursors.has(current.nextCursor)) throw new Error(`Provider repeated pagination cursor "${current.nextCursor}"`);
      visitedCursors.add(current.nextCursor);
    }
    const remaining = plan.pagination.maxItems === undefined ? undefined : plan.pagination.maxItems - items.length;
    currentPlan = nextPagePlan(currentPlan, current, remaining);
    current = extractPage(await executeRequest(currentPlan, dependencies.fetcher), currentPlan);
    items.push(...current.items);
  }
  printEnvelope(items, { next_cursor: current.nextCursor, has_more: current.hasMore });

}

export async function askConfirmation(
  prompt: string,
  promptInput: Readable = input,
  promptOutput: Writable = process.stderr,
): Promise<boolean> {
  promptOutput.write(prompt);
  const rl = createInterface({ input: promptInput, output: promptOutput });
  try {
    return /^(y|yes)$/i.test((await rl.question("")).trim());
  } finally {
    rl.close();
  }
}

interface ExtractedPage {
  readonly collection: boolean;
  readonly value: unknown;
  readonly items: unknown[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

function extractPage(response: { data?: unknown }, plan: RequestPlan): ExtractedPage {
  const providerData = response.data;
  const root = typeof providerData === "object" && providerData !== null && !Array.isArray(providerData)
    && Object.keys(providerData).length === 1 ? Object.values(providerData)[0] : providerData ?? null;
  const isCollection = plan.operation.endsWith(" list");
  if (!isCollection) {
    if (plan.kind === "query" && root === null) throw new CliError(`Requested resource for "${plan.operation}" was not found`, "NOT_FOUND", 5);
    return { collection: false, value: root, items: [], nextCursor: null, hasMore: false };
  }
  if (!plan.pagination) {
    const items = Array.isArray(root) ? root : [];
    return { collection: true, value: root, items, nextCursor: null, hasMore: false };
  }
  const record = typeof root === "object" && root !== null && !Array.isArray(root) ? root as Record<string, unknown> : undefined;
  const nestedItems = record ? Object.values(record).find((value) => Array.isArray(value)) : undefined;
  const items = Array.isArray(root) ? root : Array.isArray(nestedItems) ? nestedItems : [];
  const requestedLimit = typeof plan.body.variables?.limit === "number" ? plan.body.variables.limit : 50;
  if (items.length > requestedLimit) {
    throw new Error(`Provider returned ${items.length} items after ${requestedLimit} were requested`);
  }
  const hasMore = record?.has_more === true || Boolean(plan.pagination.offset && items.length >= requestedLimit);
  const nextCursor = typeof record?.next_cursor === "string"
    ? record.next_cursor
    : hasMore && plan.pagination.offset
      ? String((typeof plan.body.variables?.skip === "number" ? plan.body.variables.skip : 0) + items.length)
      : null;
  return { collection: true, value: root, items, nextCursor, hasMore };
}

function nextPagePlan(plan: RequestPlan, page: ExtractedPage, remaining: number | undefined): RequestPlan {
  const variables = { ...(plan.body.variables ?? {}) };
  const pageSize = typeof variables.limit === "number" ? variables.limit : 50;
  variables.limit = remaining === undefined ? pageSize : Math.min(pageSize, remaining);
  if (plan.pagination?.offset) {
    variables.skip = (typeof variables.skip === "number" ? variables.skip : 0) + page.items.length;
  } else {
    if (!page.nextCursor) throw new Error("Provider reported another page without a continuation cursor");
    variables.cursor = page.nextCursor;
  }
  return { ...plan, body: { ...plan.body, variables } };
}

function profileFieldsFromFlags(parsed: ParsedArgs): Profile {
  const apiKey = getString(parsed.flags, "api-key");
  const baseUrl = getString(parsed.flags, "base-url");
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function assertNoUnknownFlags(parsed: ParsedArgs): void {
  if (parsed.unknownFlags.length > 0) {
    throw new CliError(`Unknown option ${parsed.unknownFlags.map((flag) => `--${flag.name}`).join(", ")}`);
  }
}

function assertAllowedGlobalFlags(parsed: ParsedArgs, allowed: readonly string[]): void {
  const allowedSet = new Set([...allowed, "format", "color", "quiet", "verbose", "no-input"]);
  const invalid = Object.keys(parsed.flags).filter((name) => !allowedSet.has(name));
  if (invalid.length > 0) {
    throw new CliError(`Unsupported option ${invalid.map((name) => `--${name}`).join(", ")} for this command`);
  }
}

function assertPositionals(parsed: ParsedArgs, length: number, usage: string): void {
  if (parsed.command.length !== length) throw new CliError(usage);
}

export function help(): string {
  const commandLines = operations
    .map((operation) => `  fireflies ${commandUsage(operation).padEnd(46)} ${operation.description}`)
    .join("\n");
  return `fireflies ${version()}

A complete command line interface for the Fireflies.ai GraphQL API.

Setup and utilities:
${utilityCommands.map((command) => `  fireflies ${command.usage.padEnd(48)} ${command.description}`).join("\n")}

API commands:
${commandLines}

Raw API:
  fireflies api request POST /graphql --file request.json [--query key=value]

Global options:
  --format json|pretty|human Select result presentation (default: json).
  --color auto|always|never  Control pretty and human color (default: auto).
  --quiet, -q                Suppress progress and notices.
  --verbose, -v              Print redacted diagnostics.
  --no-input                 Never prompt.
  --help, -h                 Show help.
  --version                  Show the version.

Provider command options:
  --profile NAME             Select a saved profile.
  --api-key KEY              Override the Fireflies API key.
  --base-url URL             Override the GraphQL endpoint.
  --timeout DURATION         Request timeout (default: 30s).
  --variables JSON           Supply exact GraphQL variables.
  --set PATH=VALUE           Set a variable path; repeatable.
  --fields TEXT              Override a registered operation's selection set.
  --dry-run                  Validate and preview without writing.
  --yes, -y                  Confirm a remote mutation.`;
}

export function commandHelp(command: readonly string[]): string {
  const match = findOperation(command);
  if (match) {
    const operation = match.operation;
    const optionLines = operation.bindings
      .filter((binding) => binding.flag)
      .map((binding) => `  --${binding.flag} <${binding.kind}>${binding.required ? " (required)" : ""}`)
      .join("\n");
    return `${operation.description}

Usage: fireflies ${commandUsage(operation)} [options]

Options:
${optionLines || "  No command-specific options."}
  --dry-run                  Validate and preview mutations without a request.
  --yes, -y                  Confirm a remote mutation.
  --format json|pretty|human Output format (default: json).
  --help, -h                 Show this help.

Output: data/meta envelope. Collection pagination follows registered provider fields.
Side effects: ${operation.kind === "mutation" ? "Remote mutation; confirmation required; not atomic across multiple requests." : "Read-only provider request."}
Failures: invalid input (2), authentication (3), permission (4), not found (5), conflict (6), transient provider failure (7), confirmation (9).
Example: fireflies ${commandUsage(operation)} --help
Provider documentation: ${operation.docs}`;
  }
  const prefix = command.join(" ");
  const utilityMatch = utilityCommands.find((candidate) =>
    command.length >= candidate.pattern.length
    && candidate.pattern.every((part, index) => command[index] === part));
  if (utilityMatch) {
    return `${utilityMatch.description}

Usage: fireflies ${utilityMatch.usage} [options]

Output: local commands use the data/meta envelope; api request preserves the provider response.
Side effects: profile and config mutations write only local protected configuration. Raw POST requests require confirmation.
Failures: invalid input (2), authentication (3), permission (4), not found (5), conflict (6), transient provider failure (7), confirmation (9).
Example: fireflies ${utilityMatch.pattern.join(" ")} --help`;
  }
  const children = operations
    .filter((operation) => operation.pattern.slice(0, command.length).every((part, index) => part === command[index]))
    .map((operation) => `  fireflies ${commandUsage(operation)}  ${operation.description}`);
  if (children.length > 0) return `${prefix} commands

Usage: fireflies ${prefix} <command> [options]

${children.join("\n")}

Use --help on a complete command for arguments, output, side effects, and failures.`;
  const utility: Record<string, string> = {
    profiles: "Manage protected Fireflies profiles.",
    config: "Inspect and update Fireflies configuration.",
    auth: "Verify the configured Fireflies credential and API owner.",
    completions: "Print a shell completion script without changing shell files.",
    api: "Send an exact GraphQL request body to the selected Fireflies endpoint.",
    setup: "Create and activate a profile using the profile configuration operations.",
  };
  if (utility[command[0] ?? ""]) return `${utility[command[0] ?? ""]}

Usage: fireflies ${prefix} [options]

Run fireflies --help for the complete command list.`;
  throw new CliError(`Unknown command "${prefix}". Run fireflies --help.`);
}

export function version(packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")): string {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string") throw new Error(`Missing version in ${packagePath}`);
  return packageJson.version;
}
