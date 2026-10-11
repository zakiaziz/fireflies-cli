import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { askConfirmation, askSecret, commandHelp, main, version } from "../src/cli";

let directory = "";
let stdout = "";
let writeSpy: ReturnType<typeof spyOn> | undefined;
const originalXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fireflies-cli-unit-"));
  process.env.XDG_CONFIG_HOME = directory;
  stdout = "";
  writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });


});

afterEach(() => {
  writeSpy?.mockRestore();
  rmSync(directory, { recursive: true, force: true });
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;


});

describe("CLI dispatcher", () => {
  test("runs informational and local configuration commands", async () => {
    await main(["--help"]);
    expect(stdout).toContain("fireflies transcripts list");
    stdout = "";
    await main(["--version"]);
    expect(stdout.trim()).toBe("fireflies 0.1.0");

    await main(["setup", "work", "--api-key", "secret", "--base-url", "https://api.fireflies.ai/graphql"]);
    await main(["setup", "interactive"], { stdinIsTTY: true, readSecret: async () => "interactive-secret" });
    await main(["profiles", "list"]);
    await main(["profiles", "get", "work"]);
    await main(["profiles", "create", "other", "--api-key", "other-secret"]);
    await main(["profiles", "update", "other", "--base-url", "https://api.fireflies.ai/graphql"]);
    await main(["profiles", "use", "other"]);
    await main(["profiles", "delete", "work"]);
    await main(["config", "path"]);
    await main(["config", "list"]);
    await main(["config", "set", "baseUrl", "https://api.fireflies.ai/graphql"]);
    await main(["config", "get", "baseUrl"]);
    await main(["config", "unset", "baseUrl"]);
    await main(["completions", "zsh"]);

    expect(stdout).toContain('"profile":"other"');
    expect(stdout).toContain("#compdef fireflies");
  });

  test("builds registered, authentication, and raw dry runs", async () => {
    await main(["auth", "verify", "--api-key", "secret", "--dry-run"]);
    await main(["transcripts", "list", "--api-key", "secret", "--dry-run"]);
    await main(["transcripts", "delete", "tx-1", "--api-key", "secret", "--dry-run"]);
    expect(stdout).toContain('"kind":"query"');
    expect(stdout).toContain('"kind":"mutation"');
  });

  test("executes a query with the injected transport", async () => {
    await main(["users", "list", "--api-key", "secret"], {
      fetcher: async () => new Response('{"data":{"users":[]}}'),
    });
    expect(JSON.parse(stdout)).toEqual({ data: [], meta: { next_cursor: null, has_more: false } });
  });

  test("reads an interactive secret without echoing it", async () => {
    const promptInput = new PassThrough();
    const promptOutput = new PassThrough();
    let rendered = "";
    promptOutput.on("data", (chunk) => {
      rendered += chunk.toString();
    });
    promptInput.end("hidden-secret\n");

    expect(await askSecret("API key: ", promptInput, promptOutput)).toBe("hidden-secret");
    expect(rendered).toContain("API key:");
    expect(rendered).not.toContain("hidden-secret");
  });

  test("rejects a package without a version", () => {
    const packagePath = join(directory, "package.json");
    writeFileSync(packagePath, "{}");
    expect(() => version(packagePath)).toThrow(`Missing version in ${packagePath}`);
  });

  test("rejects invalid dispatch and usage", async () => {
    await expect(main(["setup"])).rejects.toThrow("Setup needs an API key");
    await expect(main(["setup", "one", "two", "--api-key", "key"])).rejects.toThrow("Usage: fireflies setup");
    await expect(main(["profiles", "get"])).rejects.toThrow("profiles get <name>");
    await expect(main(["profiles", "list", "unexpected"])).rejects.toThrow("profiles list");
    await expect(main(["profiles", "create", "missing-key"])).rejects.toThrow("needs --api-key");
    await expect(main(["profiles", "invalid"])).rejects.toThrow("profiles <list|get|create|update|delete|use>");
    await expect(main(["config", "get"])).rejects.toThrow("config get <key>");
    await expect(main(["config", "invalid"])).rejects.toThrow("config <path|list|get|set|unset>");
    await expect(main(["auth"])).rejects.toThrow("fireflies auth verify");
    await expect(main(["auth", "verify", "extra"])).rejects.toThrow("fireflies auth verify");
    await expect(main(["api", "invalid"])).rejects.toThrow("Usage: fireflies api request");
    await expect(main(["completions", "bash", "--unknown"])).rejects.toThrow("Unknown option --unknown");
    await expect(main(["completions", "bash", "unexpected"])).rejects.toThrow("fireflies completions <bash|zsh|fish>");
    await expect(main(["config", "list", "--api-key", "unused"])).rejects.toThrow("Unsupported option --api-key");
    await expect(main(["not-a-command"])).rejects.toThrow("Unknown command");
    await expect(main(["transcripts", "delete", "tx-1", "--api-key", "secret"])).rejects.toThrow("requires confirmation");
  });
  test("preserves raw API responses and confirms every raw POST", async () => {
    const request = join(directory, "request.json");
    writeFileSync(request, JSON.stringify({ query: "query Viewer { user { user_id } }" }));
    await expect(main([
      "api", "request", "POST", "/graphql", "--file", request, "--api-key", "secret",
    ], { stdinIsTTY: false })).rejects.toMatchObject({ exitCode: 9 });

    await main([
      "api", "request", "POST", "/graphql", "--file", request, "--api-key", "secret", "--yes",
    ], {
      fetcher: async () => new Response('{"data":{"user":{"user_id":"u-1"}}}'),
      stdinIsTTY: false,
    });
    expect(JSON.parse(stdout)).toEqual({ data: { user: { user_id: "u-1" } } });
  });

  test("traverses offset pages without exceeding max-items", async () => {
    const requests: Array<Record<string, unknown>> = [];
    await main([
      "transcripts", "list", "--api-key", "secret", "--page-size", "2", "--all", "--max-items", "3",
    ], {
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { variables: Record<string, unknown> };
        requests.push(body.variables);
        return body.variables.skip === 2
          ? new Response('{"data":{"transcripts":[{"id":"3"}]}}')
          : new Response('{"data":{"transcripts":[{"id":"1"},{"id":"2"}]}}');
      },
    });
    expect(requests).toEqual([{ limit: 2 }, { limit: 1, skip: 2 }]);
    expect(JSON.parse(stdout).data).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  test("renders focused help at command and resource levels", () => {
    expect(commandHelp(["transcripts", "get", "tx-1"])).toContain("Usage: fireflies transcripts get <transcriptId>");
    expect(commandHelp(["transcripts", "list"])).toContain("--page-size");
    expect(commandHelp(["transcripts"])).toContain("transcripts commands");
    expect(commandHelp(["profiles", "list"])).toContain("List local profile names");
    expect(commandHelp(["profiles"])).toContain("Manage protected Fireflies profiles");
    expect(() => commandHelp(["unknown"])).toThrow("Unknown command");
  });

  test("handles interactive confirmation, diagnostics, and individual output", async () => {
    let diagnostics = "";
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      diagnostics += String(chunk);
      return true;
    });
    await main(["transcripts", "delete", "tx-1", "--api-key", "secret", "--verbose"], {
      stdinIsTTY: true,
      confirm: async () => true,
      fetcher: async () => new Response('{"data":{"deleteTranscript":{"id":"tx-1"}}}'),
    });
    expect(JSON.parse(stdout).data).toEqual({ id: "tx-1" });
    expect(diagnostics).toContain("operation=transcripts delete");
    stdout = "";
    await expect(main(["transcripts", "delete", "tx-1", "--api-key", "secret"], {
      stdinIsTTY: true,
      confirm: async () => false,
    })).rejects.toMatchObject({ exitCode: 9, code: "CONFIRMATION_DECLINED" });
    stderrSpy.mockRestore();
  });

  test("reads an interactive confirmation response", async () => {
    const promptInput = new PassThrough();
    const promptOutput = new PassThrough();
    let rendered = "";
    promptOutput.on("data", (chunk) => {
      rendered += chunk.toString();
    });
    promptInput.end("yes\n");
    expect(await askConfirmation("Continue? ", promptInput, promptOutput)).toBe(true);
    expect(rendered).toContain("Continue?");
  });

  test("validates raw API routing and stdin confirmation", async () => {
    await expect(main(["api", "invalid", "POST", "/graphql", "--file", "request.json"]))
      .rejects.toThrow("supports only");
    const invalid = join(directory, "invalid-request.json");
    writeFileSync(invalid, "{");
    await expect(main(["api", "request", "POST", "/graphql", "--file", invalid], { stdinIsTTY: true }))
      .rejects.toThrow("--file contains invalid JSON");
  });

  test("traverses cursor pages and rejects unusable continuation", async () => {
    let calls = 0;
    await main([
      "audit-events", "list", "--category", "AUTHENTICATION", "--api-key", "secret",
      "--page-size", "1", "--all", "--max-items", "2",
    ], {
      fetcher: async () => {
        calls += 1;
        return calls === 1
          ? new Response('{"data":{"auditEvents":{"events":[{"id":"1"}],"has_more":true,"next_cursor":"next"}}}')
          : new Response('{"data":{"auditEvents":{"events":[{"id":"2"}],"has_more":false,"next_cursor":null}}}');
      },
    });
    expect(JSON.parse(stdout)).toEqual({
      data: [{ id: "1" }, { id: "2" }],
      meta: { next_cursor: null, has_more: false },
    });

    stdout = "";
    await expect(main([
      "audit-events", "list", "--category", "AUTHENTICATION", "--api-key", "secret", "--all",
    ], {
      fetcher: async () => new Response(
        '{"data":{"auditEvents":{"events":[{"id":"1"}],"has_more":true,"next_cursor":null}}}',
      ),
    })).rejects.toThrow("without a continuation cursor");
  });



  test("preserves nested arrays on an individual transcript and fails missing resources", async () => {
    await main(["transcripts", "get", "tx-1", "--api-key", "secret"], {
      fetcher: async () => new Response('{"data":{"transcript":{"id":"tx-1","sentences":[{"text":"hello"}],"speakers":[{"id":"one"}]}}}'),
    });
    expect(JSON.parse(stdout).data).toEqual({
      id: "tx-1",
      sentences: [{ text: "hello" }],
      speakers: [{ id: "one" }],
    });
    stdout = "";
    await expect(main(["transcripts", "get", "missing", "--api-key", "secret"], {
      fetcher: async () => new Response('{"data":{"transcript":null}}'),
    })).rejects.toMatchObject({ code: "NOT_FOUND", exitCode: 5 });
  });


  test("rejects provider pages larger than requested", async () => {
    await expect(main(["transcripts", "list", "--api-key", "secret", "--page-size", "2"], {
      fetcher: async () => new Response('{"data":{"transcripts":[{"id":"1"},{"id":"2"},{"id":"3"}]}}'),
    })).rejects.toThrow("returned 3 items after 2 were requested");
  });

});
