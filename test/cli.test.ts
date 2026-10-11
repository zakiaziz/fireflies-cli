import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "fireflies.ts");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("CLI", () => {
  test("shows help and version", () => {
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("fireflies transcripts list");
    expect(help.stdout).toContain("fireflies api request POST /graphql");

    const version = run(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("fireflies 0.1.0");
  });

  test("dry-runs a mutation with redacted credentials", () => {
    const result = run([
      "audio-files",
      "upload",
      "https://example.com/meeting.mp3",
      "--api-key",
      "api-secret",
      "--download-auth",
      '{"type":"bearer_token","bearer":{"token":"download-secret"}}',
      "--dry-run",
    ]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      data: { headers: { Authorization: string };
      body: { variables: { input: { download_auth: { bearer: { token: string } } } } };
    } };
    expect(output.data.headers.Authorization).toBe("[redacted]");
    expect(output.data.body.variables.input.download_auth.bearer.token).toBe("[redacted]");
  });

  test("requires confirmation for registered and raw mutations", () => {
    const registered = run([
      "transcripts",
      "delete",
      "tx-1",
      "--api-key",
      "api-secret",
    ]);
    expect(registered.status).toBe(9);
    expect(registered.stderr).toContain("changes Fireflies state");

  });


  test("creates, activates, and redacts a profile", () => {
    const directory = mkdtempSync(join(tmpdir(), "fireflies-cli-"));
    temporaryDirectories.push(directory);
    const environment = { XDG_CONFIG_HOME: directory, FIREFLIES_API_KEY: "environment-secret" };
    const setup = run(["setup", "work", "--from-env"], environment);
    expect(setup.status).toBe(0);
    expect(JSON.parse(setup.stdout).data).toMatchObject({ profile: "work", active: true });

    const show = run(["profiles", "get", "work"], environment);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).data).toEqual({ apiKey: "[redacted]" });

    const list = run(["profiles", "list"], environment);
    expect(JSON.parse(list.stdout)).toEqual({ data: ["work"], meta: { active: "work" } });
  });

  test("prints shell completions and rejects unknown commands", () => {
    expect(run(["completions", "bash"]).stdout).toContain("complete -F _fireflies_complete fireflies");
    const unknown = run(["not-a-command"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Unknown command");
  });

  test("rejects global options that the selected command does not use", () => {
    const setup = run(["setup", "--variables", "{}"]);
    expect(setup.status).toBe(2);
    expect(setup.stderr).toContain("Unsupported option --variables");

    const profileList = run(["profiles", "list", "--api-key", "unused"]);
    expect(profileList.status).toBe(2);
    expect(profileList.stderr).toContain("Unsupported option --api-key");

    const queryConfirmation = run(["transcripts", "list", "--api-key", "key", "--yes"]);
    expect(queryConfirmation.status).toBe(2);
    expect(queryConfirmation.stderr).toContain("Unsupported option --yes");
  });
  test("reads raw request JSON from stdin for a dry run", () => {
    const result = Bun.spawnSync([
      process.execPath,
      cli,
      "api",
      "request",
      "POST",
      "/graphql",
      "--file",
      "-",
      "--api-key",
      "secret",
      "--dry-run",
    ], {
      cwd: root,
      env: process.env,
      stdin: Buffer.from('{"query":"query { user { user_id } }"}'),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString()).data.operation).toBe("api request");
  });

});

function run(
  args: readonly string[],
  extraEnvironment: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnvironment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}
