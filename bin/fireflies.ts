#!/usr/bin/env node
import { main } from "../src/cli";
import { normalizeError } from "../src/errors";
import { configureOutput, printError } from "../src/output";

const presentation = parsePresentation(process.argv.slice(2));
configureOutput(presentation);
process.once("SIGINT", () => {
  process.exitCode = 130;
});

main().catch((cause: unknown) => {
  const error = normalizeError(cause);
  printError({
    code: error.code,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    retryable: error.retryable,
    ...(error.provider ? { provider: error.provider } : {}),
    ...(error.details !== undefined ? { details: error.details } : {}),
  }, presentation);
  process.exitCode = error.exitCode;
});

function parsePresentation(argv: readonly string[]): {
  format: "json" | "pretty" | "human";
  color: "auto" | "always" | "never";
} {
  let format: "json" | "pretty" | "human" = "json";
  let color: "auto" | "always" | "never" = "auto";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") break;
    const [name, inline] = token.split("=", 2);
    if (name !== "--format" && name !== "--color") continue;
    const value = inline ?? argv[index + 1];
    if (!inline) index += 1;
    if (name === "--format" && (value === "json" || value === "pretty" || value === "human")) format = value;
    if (name === "--color" && (value === "auto" || value === "always" || value === "never")) color = value;
  }
  return { format, color };
}
