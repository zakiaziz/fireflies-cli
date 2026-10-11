import { CliError } from "./errors";
export function assertFirefliesBaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid Fireflies base URL "${value}"`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new CliError(`Fireflies base URL "${value}" must use HTTPS; HTTP is allowed only for localhost testing`);
  }
}
