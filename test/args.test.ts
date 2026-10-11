import { describe, expect, test } from "bun:test";
import { getGlobalOptions, parseArgs } from "../src/args";

describe("argument parsing", () => {
  test("separates command words, global flags, and operation flags", () => {
    const parsed = parseArgs([
      "transcripts",
      "list",
      "--profile",
      "work",
      "--keyword=Acme",
      "--mine",
      "false",
      "--set",
      "limit=10",
      "--set=skip=20",
      "-y",
    ]);

    expect(parsed.command).toEqual(["transcripts", "list"]);
    expect(parsed.unknownFlags).toEqual([
      { name: "keyword", value: "Acme" },
      { name: "mine", value: "false" },
    ]);
    expect(getGlobalOptions(parsed)).toMatchObject({
      profile: "work",
      set: ["limit=10", "skip=20"],
      yes: true,
    });
  });

  test("supports reserved aliases", () => {
    const options = getGlobalOptions(parseArgs(["-h", "-v"]));
    expect(options.help).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.yes).toBe(false);
  });

  test("stops flag parsing after a separator", () => {
    const parsed = parseArgs(["graphql", "query", "--", "--not-a-flag"]);
    expect(parsed.command).toEqual(["graphql", "query", "--not-a-flag"]);
    expect(parsed.unknownFlags).toEqual([]);
  });

  test("uses true for an operation flag without a value", () => {
    const parsed = parseArgs(["users", "groups", "--mine"]);
    expect(parsed.unknownFlags).toEqual([{ name: "mine", value: true }]);
  });

  test("rejects unsafe option spellings, boolean values, blanks, and timeout overflow", () => {
    for (const argv of [["---help"], ["-quiet"], ["--yes=garbage"], ["--format="], ["--timeout=999999999999999999m"]]) {
      expect(() => getGlobalOptions(parseArgs(argv))).toThrow();
    }
    expect(parseArgs(["--q"]).unknownFlags).toEqual([{ name: "q", value: true }]);
    expect(getGlobalOptions(parseArgs(["--yes=false"])).yes).toBe(false);
  });

  test("rejects a missing global flag value", () => {
    expect(() => parseArgs(["transcripts", "list", "--api-key"])).toThrow("Missing value for --api-key");
    expect(() => parseArgs(["--api-key", "--help"])).toThrow("Missing value for --api-key");
  });
});
