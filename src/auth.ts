import { readConfig, readProfile, resolveProfileName } from "./config";
import { CliError } from "./errors";
import type { GlobalOptions, ResolvedAuth, RuntimeContext } from "./types";

export const defaultBaseUrl = "https://api.fireflies.ai/graphql";

export function loadRuntimeContext(options: GlobalOptions): RuntimeContext {
  const profileName = resolveProfileName(options.profile);
  const profile = readProfile(profileName);
  if (profileName && !profile) throw new CliError(`Profile "${profileName}" does not exist`, "CONFIGURATION_ERROR", 3);
  const config = readConfig();
  return {
    profileName,
    profile,
    baseUrl: options.baseUrl ?? process.env.FIREFLIES_BASE_URL ?? profile?.baseUrl ?? config.baseUrl ?? defaultBaseUrl,
  };
}

export function resolveAuth(options: GlobalOptions, context: RuntimeContext): ResolvedAuth {
  if (options.apiKey) return { apiKey: options.apiKey, source: "--api-key" };
  if (process.env.FIREFLIES_API_KEY) {
    return { apiKey: process.env.FIREFLIES_API_KEY, source: "FIREFLIES_API_KEY" };
  }
  if (context.profile?.apiKey) {
    return { apiKey: context.profile.apiKey, source: `profile:${context.profileName}` };
  }
  return {};
}

export function requireApiKey(auth: ResolvedAuth, commandName: string): string {
  if (auth.apiKey) return auth.apiKey;
  throw new CliError(
    `Missing API key for "${commandName}". Use --api-key, FIREFLIES_API_KEY, or run fireflies setup.`,
    "AUTHENTICATION_FAILED",
    3,
  );
}

