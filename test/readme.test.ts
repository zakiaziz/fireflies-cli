import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandUsage, operations } from "../src/operations";

const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"), "utf8");

describe("README command reference", () => {
  test("documents every registered API command", () => {
    for (const operation of operations) {
      const command = `fireflies ${commandUsage(operation)}`;
      expect(readme, `missing ${command}`).toContain(command);
    }
  });

  test("documents every built-in command", () => {
    for (const command of [
      "setup",
      "profiles list",
      "profiles get <name>",
      "profiles create <name>",
      "profiles update <name>",
      "profiles delete <name>",
      "profiles use <name>",
      "config path",
      "config list",
      "config get <key>",
      "config set <key> <value>",
      "config unset <key>",
      "auth verify",
      "completions bash",
      "completions zsh",
      "completions fish",
      "api request POST /graphql",
    ]) {
      expect(readme, `missing fireflies ${command}`).toContain(`fireflies ${command}`);
    }
  });

  test("documents safety and authentication contracts", () => {
    expect(readme).toContain("Every remote mutation requires interactive confirmation or `--yes`");
    expect(readme).toContain("FIREFLIES_API_KEY");
    expect(readme).toContain("Nested tokens and passwords are redacted");
  });
});
