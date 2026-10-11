import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, getGlobalOptions } from "../src/args";
import { buildOperationPlan, buildRawRequestPlan, executeRequest, renderDryRun } from "../src/graphql";
import { findOperation } from "../src/operations";
import type { GlobalOptions, RequestPlan, RuntimeContext } from "../src/types";

const context: RuntimeContext = { baseUrl: "https://api.fireflies.ai/graphql" };
const baseOptions: GlobalOptions = {
  apiKey: "api-secret",
  set: [],
  yes: false,
  dryRun: false,
  format: "json",
  color: "auto",
  quiet: false,
  verbose: false,
  noInput: false,
  timeoutMs: 30_000,
  help: false,
  version: false,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("registered GraphQL requests", () => {
  test("builds a typed transcripts query from command flags", () => {
    const parsed = parseArgs([
      "transcripts",
      "list",
      "--keyword",
      "Acme",
      "--mine",
      "true",
      "--organizers",
      "host@example.com,other@example.com",
      "--page-size",
      "25",
    ]);
    const match = findOperation(parsed.command);
    expect(match).toBeDefined();
    const plan = buildOperationPlan(match!, parsed, { ...baseOptions, ...getGlobalOptions(parsed), apiKey: "api-secret" }, context);

    expect(plan.kind).toBe("query");
    expect(plan.body.query).toContain("query Transcripts(");
    expect(plan.body.query).toContain("keyword: $keyword");
    expect(plan.body.variables).toEqual({
      keyword: "Acme",
      mine: true,
      organizers: ["host@example.com", "other@example.com"],
      limit: 25,
    });
    expect(plan.headers.Authorization).toBe("Bearer api-secret");
  });

  test("merges variables, flags, and assignments in precedence order", () => {
    const parsed = parseArgs(["transcripts", "list", "--page-size", "20", "--set", "limit=30"]);
    const match = findOperation(parsed.command);
    expect(match).toBeDefined();
    const parsedOptions = getGlobalOptions(parsed);
    const plan = buildOperationPlan(match!, parsed, {
      ...baseOptions,
      ...parsedOptions,
      apiKey: "api-secret",
      variables: '{"limit":10,"skip":5}',
    }, context);
    expect(plan.body.variables).toEqual({ limit: 30, skip: 5 });
  });

  test("accepts a fields override from a file", () => {
    const directory = mkdtempSync(join(tmpdir(), "fireflies-fields-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fields.graphql");
    writeFileSync(path, "id title");
    const parsed = parseArgs(["transcripts", "get", "tx-1"]);
    const match = findOperation(parsed.command);
    expect(match).toBeDefined();
    const plan = buildOperationPlan(match!, parsed, { ...baseOptions, fields: "id title" }, context);
    expect(plan.body.query).toContain("{\nid title\n  }");
    expect(plan.body.query).not.toContain("sentences");
  });

  test("rejects unknown flags and variables", () => {
    const withFlag = parseArgs(["channels", "list", "--page-size", "10"]);
    const match = findOperation(withFlag.command);
    expect(match).toBeDefined();
    expect(() => buildOperationPlan(match!, withFlag, baseOptions, context)).toThrow("Unknown option --page-size");

    const transcripts = parseArgs(["transcripts", "list", "--not-real"]);
    expect(() => buildOperationPlan(findOperation(transcripts.command)!, transcripts, baseOptions, context)).toThrow(
      "Allowed: --channel-id",
    );

    const clean = parseArgs(["channels", "list"]);
    expect(() => buildOperationPlan(match!, clean, { ...baseOptions, variables: '{"unknown":true}' }, context)).toThrow(
      'Unknown variable "unknown"',
    );
  });

  test("validates required values, choices, limits, and ranges", () => {
    const audit = parseArgs(["audit-events", "list"]);
    const auditMatch = findOperation(audit.command);
    expect(auditMatch).toBeDefined();
    expect(() => buildOperationPlan(auditMatch!, audit, baseOptions, context)).toThrow("Missing required --category");

    const privacy = parseArgs(["transcripts", "privacy", "update", "tx-1", "--privacy", "everyone"]);
    const privacyMatch = findOperation(privacy.command);
    expect(privacyMatch).toBeDefined();
    expect(() => buildOperationPlan(privacyMatch!, privacy, baseOptions, context)).toThrow("must be one of");

    const list = parseArgs(["transcripts", "list", "--page-size", "51"]);
    const listMatch = findOperation(list.command);
    expect(listMatch).toBeDefined();
    expect(() => buildOperationPlan(listMatch!, list, baseOptions, context)).toThrow("must be at most 50");

    const duplicate = parseArgs(["transcripts", "title", "update", "tx-1", "--title", "First title", "--title", "Second title"]);
    expect(() => buildOperationPlan(findOperation(duplicate.command)!, duplicate, baseOptions, context))
      .toThrow("may only be provided once");

    const invalidDate = parseArgs(["transcripts", "list", "--from-date", "tomorrow"]);
    expect(() => buildOperationPlan(findOperation(invalidDate.command)!, invalidDate, baseOptions, context))
      .toThrow("must be an ISO 8601");

    const emptyEmails = parseArgs(["transcripts", "share", "tx-1"]);
    expect(() => buildOperationPlan(findOperation(emptyEmails.command)!, emptyEmails, {
      ...baseOptions,
      variables: '{"input":{"emails":[]}}',
    }, context)).toThrow("at least 1 values");

    const bite = parseArgs(["bites", "create", "tx-1", "--start-time", "10", "--end-time", "5"]);
    const biteMatch = findOperation(bite.command);
    expect(biteMatch).toBeDefined();
    expect(() => buildOperationPlan(biteMatch!, bite, baseOptions, context)).toThrow("greater than --start-time");
  });

  test("validates every registered constraint shape", () => {
    const validStates = parseArgs(["meetings", "list", "--states", "active,paused"]);
    const validPlan = buildOperationPlan(findOperation(validStates.command)!, validStates, baseOptions, context);
    expect(validPlan.body.variables).toEqual({ states: ["active", "paused"] });

    const states = parseArgs(["meetings", "list", "--states", "active,stopped"]);
    expect(() => buildOperationPlan(findOperation(states.command)!, states, baseOptions, context)).toThrow("must be one of");

    const skip = parseArgs(["transcripts", "list", "--cursor=-1"]);
    expect(() => buildOperationPlan(findOperation(skip.command)!, skip, baseOptions, context)).toThrow("must be at least 0");

    const title = parseArgs(["transcripts", "title", "update", "tx-1", "--title", "no"]);
    expect(() => buildOperationPlan(findOperation(title.command)!, title, baseOptions, context)).toThrow("at least 5 characters");

    const longKeyword = parseArgs(["transcripts", "list", "--keyword", "x".repeat(256)]);
    expect(() => buildOperationPlan(findOperation(longKeyword.command)!, longKeyword, baseOptions, context)).toThrow(
      "at most 255 characters",
    );

    const channel = parseArgs(["transcripts", "channel", "update", "tx-1", "--channel-id", "channel-1"]);
    const channelPlan = buildOperationPlan(findOperation(channel.command)!, channel, baseOptions, context);
    expect(channelPlan.body.variables).toEqual({
      input: { transcript_ids: ["tx-1"], channel_id: "channel-1" },
    });

    const fields = parseArgs(["contacts", "list"]);
    expect(() => buildOperationPlan(findOperation(fields.command)!, fields, { ...baseOptions, fields: " " }, context)).toThrow(
      "--fields cannot be empty",
    );
  });

  test("supports documented legacy transcript filters", () => {
    const parsed = parseArgs([
      "transcripts",
      "list",
      "--title",
      "Planning",
      "--date",
      "1725321600000",
      "--organizer-email",
      "host@example.com",
    ]);
    const plan = buildOperationPlan(findOperation(parsed.command)!, parsed, baseOptions, context);
    expect(plan.body.variables).toEqual({
      title: "Planning",
      date: 1725321600000,
      organizerEmail: "host@example.com",
    });
    expect(plan.body.query).toContain("organizer_email: $organizerEmail");

    const repeated = parseArgs([
      "transcripts", "list", "--participants", "one@example.com", "--participants", "two@example.com",
    ]);
    const repeatedPlan = buildOperationPlan(findOperation(repeated.command)!, repeated, baseOptions, context);
    expect(repeatedPlan.body.variables?.participants).toEqual(["one@example.com", "two@example.com"]);
  });

  test("validates transcript filter combinations", () => {
    const invalidArguments = [
      [["transcripts", "list", "--scope", "all"], "--scope requires --keyword"],
      [["transcripts", "list", "--title", "Planning", "--keyword", "budget"], "--title cannot be combined"],
      [["transcripts", "list", "--user-id", "u-1", "--mine", "false"], "provide only one identity filter"],
      [["transcripts", "list", "--organizer-email", "a@example.com", "--organizers", "b@example.com"], "cannot be combined with --organizer-email"],
      [["transcripts", "list", "--organizer-email", "a@example.com", "--participants", "b@example.com"], "cannot be combined with --organizer-email"],
      [["transcripts", "list", "--participant-email", "a@example.com", "--organizers", "b@example.com"], "cannot be combined with --organizer-email or --participant-email"],
      [["transcripts", "list", "--participant-email", "a@example.com", "--participants", "b@example.com"], "cannot be combined with --organizer-email or --participant-email"],
    ] as const;

    for (const [args, message] of invalidArguments) {
      const parsed = parseArgs([...args]);
      expect(() => buildOperationPlan(findOperation(parsed.command)!, parsed, baseOptions, context)).toThrow(message);
    }
  });

  test("rejects AskFred transcript and meeting filters together", () => {
    const parsed = parseArgs([
      "askfred",
      "threads",
      "create",
      "--query",
      "What changed?",
      "--transcript-id",
      "tx-1",
      "--participants",
      "person@example.com",
    ]);
    expect(() => buildOperationPlan(findOperation(parsed.command)!, parsed, baseOptions, context)).toThrow(
      "--transcript-id cannot be combined with meeting filter options",
    );
  });

  test("validates pagination controls before requests", () => {
    const invalidMax = parseArgs(["transcripts", "list", "--all", "--max-items", "zero"]);
    expect(() => buildOperationPlan(findOperation(invalidMax.command)!, invalidMax, baseOptions, context))
      .toThrow("--max-items must be a positive integer");
    const maxWithoutAll = parseArgs(["transcripts", "list", "--max-items", "2"]);
    expect(() => buildOperationPlan(findOperation(maxWithoutAll.command)!, maxWithoutAll, baseOptions, context))
      .toThrow("--max-items requires --all");
    const unsupported = parseArgs(["users", "list", "--all"]);
    expect(() => buildOperationPlan(findOperation(unsupported.command)!, unsupported, baseOptions, context))
      .toThrow("Pagination options are unsupported");
  });

  test("requires HTTPS media URLs", () => {
    const parsed = parseArgs(["audio-files", "upload", "http://example.com/file.mp3"]);
    const match = findOperation(parsed.command);
    expect(match).toBeDefined();
    expect(() => buildOperationPlan(match!, parsed, baseOptions, context)).toThrow(expect.objectContaining({
      message: "Audio URL must use HTTPS and be directly downloadable by Fireflies",
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    }));
  });

  test("rejects collections above their provider maximum", () => {
    const parsed = parseArgs(["transcripts", "share", "tx-1", ...Array.from({ length: 51 }, (_, index) => ["--emails", `user${index}@example.com`]).flat()]);
    expect(() => buildOperationPlan(findOperation(parsed.command)!, parsed, baseOptions, context))
      .toThrow("must contain at most 50 values");
  });

});

describe("raw GraphQL requests", () => {
  function requestFile(body: unknown): string {
    const directory = mkdtempSync(join(tmpdir(), "fireflies-raw-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "request.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  test("builds an exact raw request and detects effects", () => {
    const query = buildRawRequestPlan(
      requestFile({ query: "query Viewer { user { user_id } }", operationName: "Viewer" }),
      ["trace=one", "trace=two"],
      baseOptions,
      context,
    );
    expect(query.kind).toBe("query");
    expect(query.requiresConfirmation).toBe(true);
    expect(query.url).toContain("trace=one&trace=two");

    const mutation = buildRawRequestPlan(
      requestFile({ query: "mutation { deleteTranscript(id: \"tx-1\") { id } }" }),
      [],
      baseOptions,
      context,
    );
    expect(mutation.kind).toBe("mutation");
  });

  test("validates raw request files and selected operations", () => {
    const invalidJson = requestFile({});
    writeFileSync(invalidJson, "{");
    expect(() => buildRawRequestPlan(invalidJson, [], baseOptions, context)).toThrow("--file contains invalid JSON");
    const multiple = requestFile({
      query: "query Viewer { user { user_id } } mutation Delete { deleteTranscript(id: \"x\") { id } }",
    });
    expect(() => buildRawRequestPlan(multiple, [], baseOptions, context)).toThrow("multiple operations");

    const selected = requestFile({
      query: "query Viewer { user { user_id } } mutation Delete { deleteTranscript(id: \"x\") { id } }",
      operationName: "Missing",
    });
    expect(() => buildRawRequestPlan(selected, [], baseOptions, context)).toThrow('does not contain operation "Missing"');

    expect(() => buildRawRequestPlan(requestFile({ query: "query {" }), [], baseOptions, context)).toThrow(
      "Invalid GraphQL document",
    );
    expect(() => buildRawRequestPlan(requestFile({ query: "query { user { user_id } }", extra: true }), [], baseOptions, context))
      .toThrow("unsupported field");
  });

  test("validates URL and query parameters before attaching credentials", () => {
    const file = requestFile({ query: "query { user { user_id } }" });
    expect(() => buildRawRequestPlan(file, [], baseOptions, { baseUrl: "http://example.com/graphql" })).toThrow("must use HTTPS");
    expect(() => buildRawRequestPlan(file, ["invalid"], baseOptions, context)).toThrow("--query requires key=value");
    expect(buildRawRequestPlan(file, [], baseOptions, { baseUrl: "http://localhost:3000/graphql" }).url)
      .toBe("http://localhost:3000/graphql");
  });
});

describe("GraphQL transport", () => {
  const plan: RequestPlan = {
    kind: "query",
    operation: "users list",
    url: "https://api.fireflies.ai/graphql",
    auth: { apiKey: "api-secret", source: "--api-key" },
    headers: { Authorization: "Bearer api-secret", "Content-Type": "application/json" },
    body: { query: "{ users { user_id } }" },
  };

  test("returns a successful response", async () => {
    const result = await executeRequest(plan, async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify(plan.body));
      return new Response('{"data":{"users":[]}}', { headers: { "content-type": "application/json" } });
    });
    expect(result).toEqual({ data: { users: [] } });
  });

  test("reports HTTP and GraphQL errors", async () => {
    await expect(executeRequest(plan, async () => new Response('{"error":"denied"}', { status: 401, statusText: "Unauthorized" })))
      .rejects.toThrow("401 Unauthorized");
    await expect(executeRequest(plan, async () => new Response(JSON.stringify({
      errors: [{ message: "Denied", path: ["users"], extensions: { code: "auth_failed" } }],
    }))))
      .rejects.toThrow("Denied code=auth_failed path=users");
  });

  test("rejects a successful non-JSON response", async () => {
    await expect(executeRequest(plan, async () => new Response("gateway response"))).rejects.toThrow("non-JSON response");
  });

  test("handles empty and malformed JSON responses", async () => {
    await expect(executeRequest(plan, async () => new Response(""))).rejects.toThrow("non-JSON response");
    expect(await executeRequest(plan, async () => new Response(""), true)).toBeNull();
    expect(await executeRequest(plan, async () => new Response("plain text"), true)).toBe("plain text");
    await expect(executeRequest(plan, async () => new Response("{", {
      headers: { "content-type": "application/json" },
    }))).rejects.toThrow("non-JSON response");
    await expect(executeRequest(plan, async () => new Response('{"errors":[{}]}')))
      .rejects.toThrow("Unknown GraphQL error");
  });

  test("redacts API and nested download credentials", () => {
    const dryRun = renderDryRun({
      ...plan,
      kind: "mutation",
      body: {
        query: "mutation Upload($input: AudioUploadInput!) { uploadAudio(input: $input) { success } }",
        variables: { input: { download_auth: { bearer: { token: "download-secret" } } } },
      },
    }) as { headers: Record<string, string>; body: { variables: { input: { download_auth: { bearer: { token: string } } } } } };
    expect(dryRun.headers.Authorization).toBe("[redacted]");
    expect(dryRun.body.variables.input.download_auth.bearer.token).toBe("[redacted]");
  });
  test("retries transient reads but never retries mutations", async () => {
    let readAttempts = 0;
    const readResult = await executeRequest(plan, async () => {
      readAttempts += 1;
      return readAttempts < 3
        ? new Response('{"error":"busy"}', { status: 503 })
        : new Response('{"data":{"users":[]}}');
    });
    expect(readAttempts).toBe(3);
    expect(readResult.data).toEqual({ users: [] });

    let mutationAttempts = 0;
    await expect(executeRequest({ ...plan, kind: "mutation" }, async () => {
      mutationAttempts += 1;
      return new Response('{"error":"busy"}', { status: 503 });
    })).rejects.toMatchObject({ exitCode: 7, retryable: true });
    expect(mutationAttempts).toBe(1);

    await expect(executeRequest(plan, async () => {
      throw "offline";
    })).rejects.toMatchObject({ code: "TRANSIENT_FAILURE", exitCode: 7 });
  });

  test("reports provider metadata and partial GraphQL completion", async () => {
    await expect(executeRequest(plan, async () => new Response(
      '{"code":"invalid_token"}',
      { status: 401, headers: { "x-request-id": "req-1" } },
    ))).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      exitCode: 3,
      provider: { status: 401, code: "invalid_token", request_id: "req-1" },
    });

    await expect(executeRequest(plan, async () => new Response(JSON.stringify({
      data: { users: [{ user_id: "u-1" }] },
      errors: [{ message: "Team unavailable", path: ["team"], extensions: { code: "PARTIAL" } }],
    }), { headers: { "x-request-id": "req-2" } }))).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      exitCode: 8,
      details: {
        completed: { users: [{ user_id: "u-1" }] },
        failed: [{ message: "Team unavailable", path: ["team"], code: "PARTIAL" }],
      },
    });
  });

  test("uses the default fetch dependency", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"data":{"users":[]}}')) as unknown as typeof fetch;
    try {
      expect((await executeRequest(plan)).data).toEqual({ users: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});
