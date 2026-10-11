import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Profile } from "./types";
import { CliError } from "./errors";
import { assertFirefliesBaseUrl } from "./url";
import { redact } from "./values";

export interface AppConfig {
  readonly activeProfile?: string;
  readonly baseUrl?: string;
}

type ConfigKey = keyof AppConfig;

export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "fireflies");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function profilesDir(): string {
  return join(configDir(), "profiles");
}

export function profilePath(name: string): string {
  assertProfileName(name);
  return join(profilesDir(), `${name}.json`);
}

export function readConfig(): AppConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  secureOwnedPaths();
  chmodSync(path, 0o600);
  try {
    return parseConfig(readJsonFile(path), path);
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 3) throw error;
    throw new CliError(error instanceof Error ? error.message : String(error), "CONFIGURATION_ERROR", 3);
  }
}

export function writeConfig(config: AppConfig): void {
  const path = configPath();
  writeSecureJson(path, parseConfig(config, path));
}

export function getActiveProfileName(): string | undefined {
  return readConfig().activeProfile;
}

export function setActiveProfileName(name: string): void {
  assertProfileName(name);
  writeConfig({ ...readConfig(), activeProfile: name });
}

export function listProfiles(): string[] {
  const dir = profilesDir();
  if (!existsSync(dir)) return [];
  secureOwnedPaths();
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .sort();
}

export function readProfile(name: string | undefined): Profile | undefined {
  if (!name) return undefined;
  const path = profilePath(name);
  if (!existsSync(path)) return undefined;
  secureOwnedPaths();
  chmodSync(path, 0o600);
  try {
    return parseProfile(readJsonFile(path), path);
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 3) throw error;
    throw new CliError(error instanceof Error ? error.message : String(error), "CONFIGURATION_ERROR", 3);
  }
}

export function requireProfile(name: string): Profile {
  const profile = readProfile(name);
  if (!profile) throw new CliError(`Profile "${name}" does not exist`, "NOT_FOUND", 5);
  return profile;
}

export function writeProfile(name: string, profile: Profile): void {
  const path = profilePath(name);
  writeSecureJson(path, parseProfile(profile, path));
}

export function deleteProfile(name: string): void {
  const path = profilePath(name);
  if (!existsSync(path)) throw new CliError(`Profile "${name}" does not exist`, "NOT_FOUND", 5);
  rmSync(path);
}

export function showProfile(name: string, showSecrets = false): unknown {
  const profile = requireProfile(name);
  return showSecrets ? profile : redact(profile);
}

export function resolveProfileName(explicit: string | undefined): string | undefined {
  return explicit ?? getActiveProfileName();
}

export function configGet(path: string): unknown {
  const key = configKey(path);
  return readConfig()[key];
}

export function configSet(path: string, value: unknown): AppConfig {
  const key = configKey(path);
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`Config key "${key}" requires a non-empty string value`);
  }
  if (key === "activeProfile") requireProfile(value);
  if (key === "baseUrl") assertFirefliesBaseUrl(value);
  const next = { ...readConfig(), [key]: value };
  writeConfig(next);
  return next;
}

export function configUnset(path: string): AppConfig {
  const key = configKey(path);
  const config = readConfig();
  const next: AppConfig = key === "activeProfile"
    ? config.baseUrl ? { baseUrl: config.baseUrl } : {}
    : config.activeProfile ? { activeProfile: config.activeProfile } : {};
  writeConfig(next);
  return next;
}

function configKey(path: string): ConfigKey {
  if (path === "activeProfile" || path === "baseUrl") return path;
  throw new CliError('Unknown config key. Allowed keys: "activeProfile", "baseUrl"');
}

function writeSecureJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  secureOwnedPaths();
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function secureOwnedPaths(): void {
  const toolDirectory = configDir();
  if (existsSync(toolDirectory)) chmodSync(toolDirectory, 0o700);
  const profileDirectory = profilesDir();
  if (existsSync(profileDirectory)) chmodSync(profileDirectory, 0o700);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new CliError(`Cannot read configuration at ${path}; check file permissions and JSON syntax`, "CONFIGURATION_ERROR", 3);
  }
}

function parseConfig(value: unknown, path: string): AppConfig {
  const record = configRecord(value, path, ["activeProfile", "baseUrl"]);
  const activeProfile = optionalString(record.activeProfile, "activeProfile", path);
  const baseUrl = optionalString(record.baseUrl, "baseUrl", path);
  if (activeProfile !== undefined) assertProfileName(activeProfile);
  if (baseUrl !== undefined) assertFirefliesBaseUrl(baseUrl);
  return {
    ...(activeProfile !== undefined ? { activeProfile } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
}

function parseProfile(value: unknown, path: string): Profile {
  const record = configRecord(value, path, ["apiKey", "baseUrl"]);
  const apiKey = optionalString(record.apiKey, "apiKey", path);
  const baseUrl = optionalString(record.baseUrl, "baseUrl", path);
  if (baseUrl !== undefined) assertFirefliesBaseUrl(baseUrl);
  return {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
}

function configRecord(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`Invalid configuration in ${path}: expected a JSON object`, "CONFIGURATION_ERROR", 3);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new CliError(`Invalid configuration in ${path}: unknown key "${unknown}"`, "CONFIGURATION_ERROR", 3);
  return record;
}

function optionalString(value: unknown, key: string, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`Invalid configuration in ${path}: "${key}" must be a non-empty string`, "CONFIGURATION_ERROR", 3);
  }
  return value;
}

function assertProfileName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new CliError(`Profile name "${name}" may only contain letters, numbers, dots, underscores, and hyphens`);
  }
}
