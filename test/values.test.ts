import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAssignments,
  getPath,
  parseCommandValue,
  parseLiteral,
  readJsonObject,
  redact,
  setPath,
} from "../src/values";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("values", () => {
  test("parses typed command values", () => {
    expect(parseCommandValue("42", "integer", "limit")).toBe(42);
    expect(parseCommandValue("1.5", "number", "start-time")).toBe(1.5);
    expect(parseCommandValue("false", "boolean", "mine")).toBe(false);
    expect(parseCommandValue(true, "boolean", "mine")).toBe(true);
    expect(parseCommandValue("a, b", "csv", "emails")).toEqual(["a", "b"]);
    expect(parseCommandValue('{"active":true}', "json", "input")).toEqual({ active: true });
    expect(parseCommandValue("text", "string", "title")).toBe("text");
  });

  test("rejects invalid typed values", () => {
    expect(() => parseCommandValue("1.5", "integer", "limit")).toThrow("must be an integer");
    expect(() => parseCommandValue("maybe", "boolean", "mine")).toThrow("must be true or false");
    expect(() => parseCommandValue("", "csv", "emails")).toThrow("at least one value");
    expect(() => parseCommandValue("{", "json", "input")).toThrow("invalid JSON");
  });

  test("reads text and JSON from files", () => {
    const directory = mkdtempSync(join(tmpdir(), "fireflies-values-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "variables.json");
    writeFileSync(path, '{"limit":10}');
    expect(() => readJsonObject(`@${path}`)).toThrow("JSON");
    expect(() => readJsonObject("[]")).toThrow("must be a JSON object");
  });

  test("applies dotted assignments and parses literals", () => {
    const target: Record<string, unknown> = {};
    applyAssignments(target, ["input.title=Quarterly review", "input.count=2", "input.active=true"]);
    expect(target).toEqual({ input: { title: "Quarterly review", count: 2, active: true } });
    expect(getPath(target, "input.count")).toBe(2);
    expect(getPath(target, "missing.value")).toBeUndefined();
    expect(parseLiteral("null")).toBeNull();
    expect(parseLiteral('["a"]')).toEqual(["a"]);
  });

  test("rejects malformed and unsafe assignments", () => {
    expect(() => applyAssignments({}, ["broken"])).toThrow("Use path=value");
    expect(() => setPath({}, "input.__proto__.polluted", true)).toThrow("Unsafe assignment path");
    expect(() => setPath({}, "", true)).toThrow("cannot be empty");
  });

  test("redacts secrets recursively", () => {
    expect(redact({
      apiKey: "secret",
      nested: { token: "download-token", password: "password", visible: "value" },
      array: [{ authorization: "Bearer secret" }],
    })).toEqual({
      apiKey: "[redacted]",
      nested: { token: "[redacted]", password: "[redacted]", visible: "value" },
      array: [{ authorization: "[redacted]" }],
    });
  });
});

