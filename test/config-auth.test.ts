import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadRuntimeContext, requireApiKey, resolveAuth } from "../src/auth";
import {
  configGet,
  configPath,
  configSet,
  configUnset,
  deleteProfile,
  getActiveProfileName,
  listProfiles,
  profilePath,
  readConfig,
  readProfile,
  requireProfile,
  setActiveProfileName,
  showProfile,
  writeProfile,
} from "../src/config";
import type { GlobalOptions } from "../src/types";

let directory = "";
const originalXdg = process.env.XDG_CONFIG_HOME;
const originalApiKey = process.env.FIREFLIES_API_KEY;
const originalBaseUrl = process.env.FIREFLIES_BASE_URL;

const options: GlobalOptions = {
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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fireflies-config-"));
  process.env.XDG_CONFIG_HOME = directory;
  delete process.env.FIREFLIES_API_KEY;
  delete process.env.FIREFLIES_BASE_URL;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  restoreEnvironment("XDG_CONFIG_HOME", originalXdg);
  restoreEnvironment("FIREFLIES_API_KEY", originalApiKey);
  restoreEnvironment("FIREFLIES_BASE_URL", originalBaseUrl);
});

describe("configuration and authentication", () => {
  test("writes secure profiles and selects an active profile", () => {
    writeProfile("work", { apiKey: "profile-key", baseUrl: "https://example.com/graphql" });
    setActiveProfileName("work");
    expect(listProfiles()).toEqual(["work"]);
    expect(getActiveProfileName()).toBe("work");
    expect(readProfile("work")).toEqual({ apiKey: "profile-key", baseUrl: "https://example.com/graphql" });
    expect(showProfile("work")).toEqual({ apiKey: "[redacted]", baseUrl: "https://example.com/graphql" });
    expect(statSync(profilePath("work")).mode & 0o777).toBe(0o600);
  });

  test("sets, gets, and unsets supported configuration", () => {
    configSet("baseUrl", "https://example.com/graphql");
    expect(configGet("baseUrl")).toBe("https://example.com/graphql");
    expect(configUnset("baseUrl")).toEqual({});
    expect(configGet("baseUrl")).toBeUndefined();
    expect(() => configGet("unknown")).toThrow("Unknown config key");
    expect(() => configGet("unknown")).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", exitCode: 2 }));
    expect(() => configSet("baseUrl", true)).toThrow("requires a non-empty string");
    expect(() => configSet("baseUrl", "")).toThrow("requires a non-empty string");
    expect(() => configSet("activeProfile", "missing")).toThrow("does not exist");
  });

  test("deletes profiles and rejects invalid names", () => {
    writeProfile("temporary", { apiKey: "key" });
    deleteProfile("temporary");
    expect(readProfile("temporary")).toBeUndefined();
    expect(() => deleteProfile("temporary")).toThrow(expect.objectContaining({ code: "NOT_FOUND", exitCode: 5 }));
    expect(() => profilePath("../escape")).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", exitCode: 2 }));
    expect(() => requireProfile("missing")).toThrow(expect.objectContaining({ code: "NOT_FOUND", exitCode: 5 }));
  });

  test("reports malformed JSON with its path", () => {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{");
    expect(() => configGet("baseUrl")).toThrow(expect.objectContaining({
      message: `Cannot read configuration at ${path}; check file permissions and JSON syntax`,
      code: "CONFIGURATION_ERROR",
      exitCode: 3,
    }));
  });

  test("rejects invalid stored configuration and profiles", () => {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });

    writeFileSync(path, "[]");
    expect(() => readConfig()).toThrow("expected a JSON object");
    writeFileSync(path, '{"unexpected":true}');
    expect(() => readConfig()).toThrow('unknown key "unexpected"');
    writeFileSync(path, '{"baseUrl":42}');
    expect(() => readConfig()).toThrow('"baseUrl" must be a non-empty string');
    writeFileSync(path, '{"activeProfile":"../escape"}');
    expect(() => readConfig()).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR", exitCode: 3 }));

    const profile = profilePath("invalid");
    mkdirSync(dirname(profile), { recursive: true });
    writeFileSync(profile, '{"apiKey":"key","unknown":true}');
    expect(() => readProfile("invalid")).toThrow('unknown key "unknown"');
    writeFileSync(profile, '{"apiKey":""}');
    expect(() => readProfile("invalid")).toThrow('"apiKey" must be a non-empty string');
  });

  test("rejects unsafe base URLs before writing configuration", () => {
    expect(() => configSet("baseUrl", "ftp://example.com/graphql")).toThrow('"ftp://example.com/graphql" must use HTTPS');
    expect(() => configSet("baseUrl", "not-a-url")).toThrow('Invalid Fireflies base URL "not-a-url"');
    expect(() => writeProfile("unsafe", { apiKey: "key", baseUrl: "http://example.com/graphql" })).toThrow(
      '"http://example.com/graphql" must use HTTPS',
    );
    expect(readProfile("unsafe")).toBeUndefined();
  });

  test("resolves flags, environment, and profiles in order", () => {
    writeProfile("work", { apiKey: "profile-key", baseUrl: "https://profile.example/graphql" });
    setActiveProfileName("work");
    process.env.FIREFLIES_API_KEY = "env-key";
    process.env.FIREFLIES_BASE_URL = "https://env.example/graphql";

    const context = loadRuntimeContext(options);
    expect(context.baseUrl).toBe("https://env.example/graphql");
    expect(resolveAuth(options, context)).toEqual({ apiKey: "env-key", source: "FIREFLIES_API_KEY" });
    expect(resolveAuth({ ...options, apiKey: "flag-key" }, context)).toEqual({ apiKey: "flag-key", source: "--api-key" });

    delete process.env.FIREFLIES_API_KEY;
    delete process.env.FIREFLIES_BASE_URL;
    const profileContext = loadRuntimeContext(options);
    expect(profileContext.baseUrl).toBe("https://profile.example/graphql");
    expect(resolveAuth(options, profileContext)).toEqual({ apiKey: "profile-key", source: "profile:work" });
  });

  test("requires an API key with actionable setup guidance", () => {
    expect(resolveAuth(options, { baseUrl: "https://api.fireflies.ai/graphql" })).toEqual({});
    expect(() => requireApiKey({}, "users list")).toThrow("run fireflies setup");
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
