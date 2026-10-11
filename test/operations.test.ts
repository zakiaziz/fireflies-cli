import { describe, expect, test } from "bun:test";
import { commandUsage, findOperation, operationSpecification, operations, utilityCommands } from "../src/operations";

describe("operation registry", () => {
  test("covers every documented query and mutation", () => {
    expect(operations.filter((operation) => operation.kind === "query")).toHaveLength(18);
    expect(operations.filter((operation) => operation.kind === "mutation")).toHaveLength(16);
  });

  test("uses unique names and command patterns", () => {
    expect(new Set(operations.map((operation) => operation.name)).size).toBe(operations.length);
    expect(new Set(operations.map((operation) => operation.pattern.join(" "))).size).toBe(operations.length);
  });

  test("extracts required path parameters", () => {
    const match = findOperation(["transcripts", "get", "transcript-123"]);
    expect(match?.operation.name).toBe("transcripts get");
    expect(match?.parameters).toEqual({ transcriptId: "transcript-123" });
  });

  test("supports an optional trailing path parameter", () => {
    expect(findOperation(["users", "get"])?.parameters).toEqual({});
    expect(findOperation(["users", "get", "user-123"])?.parameters).toEqual({ userId: "user-123" });
  });

  test("rejects partial and extra command paths", () => {
    expect(findOperation(["transcripts"])).toBeUndefined();
    expect(findOperation(["channels", "list", "extra"])).toBeUndefined();
  });

  test("formats required and optional parameters for help", () => {
    const showTranscript = operations.find((operation) => operation.name === "transcripts get");
    const showUser = operations.find((operation) => operation.name === "users get");
    expect(showTranscript && commandUsage(showTranscript)).toBe("transcripts get <transcriptId>");
    expect(showUser && commandUsage(showUser)).toBe("users get [userId]");
  });

  test("links every operation to official Fireflies documentation", () => {
    for (const operation of operations) {
      expect(operation.docs).toStartWith("https://docs.fireflies.ai/");
    }
  });
  test("exposes complete specifications and shared utility definitions", () => {
    expect(utilityCommands.some((command) => command.usage === "api request POST /graphql --file REQUEST.json")).toBe(true);
    for (const operation of operations) {
      const specification = operationSpecification(operation);
      expect(specification.command).toStartWith("fireflies ");
      expect(specification.summary.length).toBeGreaterThan(0);
      expect(specification.authentication.permissions.length).toBe(1);
      expect(specification.output.schema).toBe("data-meta-envelope");
      expect(specification.failures).toContain("INVALID_ARGUMENT");
      expect(specification.examples.length).toBe(1);
      if (operation.name === "audio-files upload") expect(specification.exceptions[0]).toContain("CLI-SAFE-8");
      else expect(specification.exceptions).toEqual([]);
    }
  });

});
