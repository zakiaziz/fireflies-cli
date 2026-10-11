import { redact } from "./values";
import type { GlobalOptions } from "./types";

type Presentation = Pick<GlobalOptions, "format" | "color">;

let presentation: Presentation = { format: "json", color: "auto" };

export function configureOutput(options: Presentation): void {
  presentation = options;
}

function rgb(hex: string, value: string): string {
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `\u001b[38;2;${red};${green};${blue}m${value}\u001b[0m`;
}

export function printJson(value: unknown): void {
  printResult(value, presentation);
}

export function printEnvelope(data: unknown, meta: Record<string, unknown> = {}): void {
  process.stdout.write(render({ data, meta }, presentation, process.stdout.isTTY === true));
}

export function printResult(value: unknown, options: Presentation, raw = false): void {
  const document = raw ? value : { data: value === undefined ? null : value, meta: {} };
  process.stdout.write(render(document, options, process.stdout.isTTY === true));
}

export function printText(value: string): void {
  process.stdout.write(`${value}\n`);
}

export function printRedacted(value: unknown): void {
  printResult(redact(value), presentation);
}

export function printError(
  error: { code: string; message: string; hint?: string; retryable: boolean; provider?: unknown; details?: unknown },
  options: Presentation,
): void {
  if (options.format === "human") {
    const useColor = options.color === "always"
      || (options.color === "auto" && process.stderr.isTTY === true && !process.env.NO_COLOR);
    const label = useColor ? rgb("f85149", error.code) : error.code;
    process.stderr.write(`${label}: ${error.message}${error.hint ? `\nHint: ${error.hint}` : ""}\n`);
    return;
  }
  process.stderr.write(render({ error }, options, process.stderr.isTTY === true));
}

function render(value: unknown, options: Presentation, isTTY: boolean): string {
  if (options.format === "human") {
    const useColor = options.color === "always" || (options.color === "auto" && isTTY && !process.env.NO_COLOR);
    return `${human(value, useColor)}\n`;
  }
  if (options.format === "json") return `${JSON.stringify(value)}\n`;
  const json = JSON.stringify(value, null, 2);
  const useColor = options.color === "always" || (options.color === "auto" && isTTY && !process.env.NO_COLOR);
  return `${useColor ? highlight(json) : json}\n`;
}

function human(value: unknown, useColor = false): string {
  const data = typeof value === "object" && value !== null && "data" in value
    ? (value as { data: unknown }).data
    : value;
  if (Array.isArray(data)) {
    if (data.length === 0) return "No results.";
    if (data.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
      const keys = [...new Set(data.flatMap((row) => Object.keys(row as Record<string, unknown>)))];
      return [keys.join("\t"), ...data.map((row) => keys.map((key) => scalar((row as Record<string, unknown>)[key])).join("\t"))].join("\n");
    }
  }
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return Object.entries(data).map(([key, child]) => `${useColor ? rgb("58a6ff", key) : key}: ${scalar(child)}`).join("\n");
  }
  return scalar(data);
}

function scalar(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function highlight(json: string): string {
  return json.replace(/("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g, (token, key) => {
    if (key) return rgb("58a6ff", token);
    if (token === "true" || token === "false" || token === "null") return rgb("39c5cf", token);
    if (token.startsWith('"')) return rgb("3fb950", token);
    return rgb("d29922", token);
  });
}
