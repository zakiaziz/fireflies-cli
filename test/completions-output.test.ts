import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { completionScript } from "../src/completions";
import { configureOutput, printEnvelope, printError, printJson, printRedacted, printResult, printText } from "../src/output";

afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
  configureOutput({ format: "json", color: "auto" });
});

describe("shell completions", () => {
  test("renders Bash, Z shell, and fish scripts", () => {
    expect(completionScript("bash")).toContain("complete -F _fireflies_complete fireflies");
    expect(completionScript("zsh")).toContain("#compdef fireflies");
    const fish = completionScript("fish");
    expect(fish).toContain("complete -c fireflies -a 'transcripts'");
    expect(fish).not.toContain("<transcriptId>");
  });

  test("rejects an unsupported shell", () => {
    expect(() => completionScript("powershell")).toThrow("fireflies completions <bash|zsh|fish>");
  });
});

describe("output", () => {
  test("prints JSON, text, and redacted values", () => {
    let written = "";
    spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });

    printJson({ ok: true });
    printText("done");
    printRedacted({ apiKey: "secret" });

    expect(written).toBe('{"data":{"ok":true},"meta":{}}\ndone\n{"data":{"apiKey":"[redacted]"},"meta":{}}\n');
  });
  test("renders pretty, human, raw, collection, and error presentations", () => {
    let stdout = "";
    let stderr = "";
    spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    printResult({ name: "Ada", count: 2, enabled: true, missing: null }, { format: "pretty", color: "always" });
    expect(stdout).toContain("\u001b[38;2;88;166;255m");
    expect(stdout).toContain("\u001b[38;2;63;185;80m");
    expect(stdout).toContain("\u001b[38;2;210;153;34m");
    expect(stdout).toContain("\u001b[38;2;57;197;207m");

    stdout = "";
    printResult([{ id: "1", title: "One" }], { format: "human", color: "never" });
    expect(stdout).toBe("id\ttitle\n1\tOne\n");
    stdout = "";
    printResult([], { format: "human", color: "never" });
    expect(stdout).toBe("No results.\n");
    stdout = "";
    printResult("value", { format: "human", color: "never" });
    expect(stdout).toBe("value\n");
    stdout = "";
    printResult([1, 2], { format: "human", color: "never" });
    expect(stdout).toBe("[1,2]\n");
    stdout = "";
    printResult({ id: "1" }, { format: "human", color: "always" });
    expect(stdout).toContain("\u001b[38;2;88;166;255mid");
    stdout = "";
    printResult({ provider: true }, { format: "json", color: "always" }, true);
    expect(stdout).toBe('{"provider":true}\n');
    stdout = "";
    configureOutput({ format: "json", color: "never" });
    printEnvelope(["one"], { has_more: false });
    expect(JSON.parse(stdout)).toEqual({ data: ["one"], meta: { has_more: false } });

    printError({ code: "INVALID_ARGUMENT", message: "Bad input", hint: "Fix it", retryable: false }, { format: "human", color: "always" });
    expect(stderr).toContain("\u001b[38;2;248;81;73mINVALID_ARGUMENT");
    expect(stderr).toContain("Hint: Fix it");
    stderr = "";
    printError({ code: "INVALID_ARGUMENT", message: "Bad input", retryable: false }, { format: "pretty", color: "never" });
    expect(JSON.parse(stderr).error.code).toBe("INVALID_ARGUMENT");
  });

});
