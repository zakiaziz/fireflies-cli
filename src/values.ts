import type { ValueKind } from "./types";
import { CliError } from "./errors";

const unsafePathSegments = new Set(["__proto__", "prototype", "constructor"]);

export function readJsonObject(source: string | undefined, option = "--variables"): Record<string, unknown> {
  if (!source) return {};
  const parsed = JSON.parse(source) as unknown;
  if (!isObject(parsed)) throw new CliError(`${option} must be a JSON object`);
  return parsed;
}

export function parseCommandValue(value: string | boolean, kind: ValueKind, flag: string): unknown {
  if (kind === "string") {
    if (typeof value !== "string" || value.length === 0) throw new CliError(`--${flag} requires a value`);
    return value;
  }

  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new CliError(`--${flag} must be true or false`);
  }

  if (kind === "integer" || kind === "number") {
    if (typeof value !== "string" || value.length === 0) throw new CliError(`--${flag} requires a number`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (kind === "integer" && !Number.isInteger(parsed))) {
      throw new CliError(`--${flag} must be ${kind === "integer" ? "an integer" : "a number"}`);
    }
    return parsed;
  }

  if (kind === "single-list") {
    if (typeof value !== "string" || value.length === 0) throw new CliError(`--${flag} requires a value`);
    return [value];
  }

  if (kind === "csv") {
    if (typeof value !== "string") throw new CliError(`--${flag} requires a comma-separated value`);
    const parsed = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (parsed.length === 0) throw new CliError(`--${flag} requires at least one value`);
    return parsed;
  }

  if (typeof value !== "string") throw new CliError(`--${flag} requires JSON`);
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`--${flag} contains invalid JSON: ${reason}`);
  }
}

export function parseLiteral(input: string): unknown {
  const value = input.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value) as unknown;
  }
  return input;
}

export function applyAssignments(target: Record<string, unknown>, assignments: readonly string[]): void {
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) throw new CliError(`Invalid assignment "${assignment}". Use path=value.`);
    setPath(target, assignment.slice(0, separator), parseLiteral(assignment.slice(separator + 1)));
  }
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new CliError("Assignment path cannot be empty");
  for (const part of parts) {
    if (unsafePathSegments.has(part)) throw new CliError(`Unsafe assignment path "${path}"`);
  }

  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) as string] = value;
}

export function getPath(target: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = target;
  for (const part of path.split(".").filter(Boolean)) {
    if (!isObject(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /api.?key|token|secret|password|authorization/i.test(key) ? "[redacted]" : redact(child),
    ]),
  );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

