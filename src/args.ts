import { CliError } from "./errors";
import type { GlobalOptions, ParsedArgs, UnknownFlag } from "./types";

const valueFlags = new Set([
  "profile",
  "api-key",
  "base-url",
  "variables",
  "fields",
  "set",
  "format",
  "color",
  "timeout",
  "file",
  "query",
  "max-items",
]);

const booleanFlags = new Set(["yes", "dry-run", "help", "version", "from-env", "quiet", "verbose", "no-input", "all"]);

const aliases: Record<string, string> = {
  h: "help",
  v: "verbose",
  q: "quiet",
  y: "yes",
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const unknownFlags: UnknownFlag[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--") {
      command.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      command.push(arg);
      continue;
    }

    if (arg.startsWith("---")) throw new CliError(`Invalid option spelling "${arg}"`);
    const parsed = parseFlagToken(arg);
    const isShort = /^-[^-]$/.test(arg.split("=", 1)[0] ?? "");
    if (!arg.startsWith("--") && !isShort) throw new CliError(`Invalid option spelling "${arg}"`);
    const name = isShort ? aliases[parsed.name] : parsed.name;
    if (!name) throw new CliError(`Unknown option ${arg}`);

    if (booleanFlags.has(name)) {
      if (parsed.value !== undefined && parsed.value !== "true" && parsed.value !== "false") {
        throw new CliError(`--${name} accepts only true or false; received "${parsed.value}"`);
      }
      setFlag(flags, name, parsed.value === undefined ? true : parsed.value === "true");
      continue;
    }

    if (valueFlags.has(name)) {
      const value = parsed.value ?? argv[index + 1];
      if (value === undefined || value === "" || (parsed.value === undefined && value.startsWith("-") && !(name === "file" && value === "-"))) {
        throw new CliError(`Missing value for --${name}`);
      }
      if (parsed.value === undefined) index += 1;
      setFlag(flags, name, value);
      continue;
    }

    const value = parsed.value ?? nextFlagValue(argv[index + 1]);
    if (parsed.value === undefined && value !== true) index += 1;
    unknownFlags.push({ name, value });
  }

  return { command, flags, unknownFlags };
}

export function getGlobalOptions(parsed: ParsedArgs): GlobalOptions {
  const format = getString(parsed.flags, "format") ?? "json";
  if (!["json", "pretty", "human"].includes(format)) throw new CliError(`--format must be json, pretty, or human; received "${format}"`);
  const color = getString(parsed.flags, "color") ?? "auto";
  if (!["auto", "always", "never"].includes(color)) throw new CliError(`--color must be auto, always, or never; received "${color}"`);
  if (getBoolean(parsed.flags, "quiet") && getBoolean(parsed.flags, "verbose")) throw new CliError("--quiet cannot be combined with --verbose");
  return {
    profile: getString(parsed.flags, "profile"),
    apiKey: getString(parsed.flags, "api-key"),
    baseUrl: getString(parsed.flags, "base-url"),
    variables: getString(parsed.flags, "variables"),
    fields: getString(parsed.flags, "fields"),
    set: getStringArray(parsed.flags, "set"),
    yes: getBoolean(parsed.flags, "yes"),
    dryRun: getBoolean(parsed.flags, "dry-run"),
    format: format as GlobalOptions["format"],
    color: color as GlobalOptions["color"],
    quiet: getBoolean(parsed.flags, "quiet"),
    verbose: getBoolean(parsed.flags, "verbose"),
    noInput: getBoolean(parsed.flags, "no-input"),
    timeoutMs: parseTimeout(getString(parsed.flags, "timeout") ?? "30s"),
    help: getBoolean(parsed.flags, "help"),
    version: getBoolean(parsed.flags, "version"),
  };
}

function parseTimeout(value: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(value);
  if (!match) throw new CliError(`--timeout requires a duration with units (ms, s, or m); received "${value}"`);
  const amount = Number(match[1]);
  const milliseconds = amount * (match[2] === "ms" ? 1 : match[2] === "s" ? 1000 : 60000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647) {
    throw new CliError(`--timeout must resolve to 1..2147483647ms; received "${value}"`);
  }
  return milliseconds;
}

export function getString(
  flags: Record<string, string | boolean | string[]>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.at(-1);
  return undefined;
}

export function getBoolean(flags: Record<string, string | boolean | string[]>, name: string): boolean {
  const value = flags[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

export function getStringArray(flags: Record<string, string | boolean | string[]>, name: string): string[] {
  const value = flags[name];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function parseFlagToken(arg: string): { name: string; value?: string } {
  const trimmed = arg.replace(/^-+/, "");
  const separator = trimmed.indexOf("=");
  if (separator === -1) return { name: trimmed };
  return { name: trimmed.slice(0, separator), value: trimmed.slice(separator + 1) };
}

function nextFlagValue(value: string | undefined): string | boolean {
  if (value === undefined || value.startsWith("-")) return true;
  return value;
}

function setFlag(
  flags: Record<string, string | boolean | string[]>,
  name: string,
  value: string | boolean,
): void {
  if (name === "set" || name === "query") {
    const current = flags[name];
    if (Array.isArray(current)) {
      current.push(String(value));
      return;
    }
    flags[name] = [String(value)];
    return;
  }
  if (flags[name] !== undefined) throw new CliError(`Option --${name} may only be provided once`);
  flags[name] = value;
}

