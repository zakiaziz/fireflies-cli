# fireflies-cli

Command-line interface for the Fireflies.ai API. It reads and changes transcripts, live meetings, AskFred threads, soundbites, users, channels, analytics, automation rule executions, and audit events, and it sends raw GraphQL requests. It is not an official Fireflies product.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g @zakiaziz/fireflies-cli
bun add -g @zakiaziz/fireflies-cli
cd fireflies-cli && bun run build && bun link
```

## Quick start

```bash
fireflies setup
# List your transcripts since August 1 as a table.
fireflies transcripts list --mine --from-date 2026-08-01 --format human
# Get one transcript with its sentences, summary, and analytics.
fireflies transcripts get 01HXYZ
# Preview a title change without sending it.
fireflies transcripts title update 01HXYZ --title 'Q3 planning review' --dry-run
```

## Commands

### analytics

| Command | Description | Options |
| --- | --- | --- |
| fireflies analytics get | Get team and user conversation analytics. | --from-date DATE, --to-date DATE |

### apps

| Command | Description | Options |
| --- | --- | --- |
| fireflies apps list | List AI App outputs. | --app-id ID, --transcript-id ID, --page-size N, --cursor TOKEN, --all, --max-items N |

### askfred

| Command | Description | Options |
| --- | --- | --- |
| fireflies askfred threads list | List AskFred threads. | --transcript-id ID |
| fireflies askfred threads get THREAD_ID | Get one AskFred thread and its messages. | None |
| fireflies askfred threads create | Create an AskFred thread. | --question TEXT, --transcript-id ID, --from-date DATE, --to-date DATE, --channel-id ID, --organizer EMAIL, --participant EMAIL, --filter-transcript-id ID, --response-language LANGUAGE, --response-format FORMAT, --yes, --dry-run |
| fireflies askfred threads delete THREAD_ID | Delete an AskFred thread. | --yes, --dry-run |
| fireflies askfred threads continue THREAD_ID | Ask a follow-up question in an AskFred thread. | --question TEXT, --response-language LANGUAGE, --response-format FORMAT, --yes, --dry-run |

### audio-files

| Command | Description | Options |
| --- | --- | --- |
| fireflies audio-files upload URL | Queue a media URL for transcription. | --title TEXT, --webhook URL, --language LANGUAGE, --save-video BOOLEAN, --attendee EMAIL, --client-reference-id ID, --bypass-size-check, --download-auth-file PATH, --yes, --dry-run |

### audit-events

| Command | Description | Options |
| --- | --- | --- |
| fireflies audit-events list | List audit events. | --category CATEGORY, --action ACTION, --from-date DATE, --to-date DATE, --actor-user-id ID, --actor-email EMAIL, --page-size N, --cursor TOKEN, --all, --max-items N |

### bites

| Command | Description | Options |
| --- | --- | --- |
| fireflies bites list | List soundbites. | --mine, --transcript-id ID, --my-team BOOLEAN, --page-size N, --cursor TOKEN, --all, --max-items N |
| fireflies bites get BITE_ID | Get one soundbite. | None |
| fireflies bites create TRANSCRIPT_ID | Create a soundbite from a transcript time range. | --start-time SECONDS, --end-time SECONDS, --name TEXT, --media-type TYPE, --privacy PRIVACY, --summary TEXT, --yes, --dry-run |

### channels

| Command | Description | Options |
| --- | --- | --- |
| fireflies channels list | List channels. | None |
| fireflies channels get CHANNEL_ID | Get one channel. | None |

### contacts

| Command | Description | Options |
| --- | --- | --- |
| fireflies contacts list | List contacts. | None |

### meetings

| Command | Description | Options |
| --- | --- | --- |
| fireflies meetings list | List active or paused live meetings. | --email EMAIL, --state STATE |
| fireflies meetings action-items list MEETING_ID | List action items of a live meeting. | None |
| fireflies meetings action-items create MEETING_ID | Create an action item in a live meeting. | --prompt TEXT, --yes, --dry-run |
| fireflies meetings bots create MEETING_LINK | Add the Fireflies bot to an ongoing meeting. | --title TEXT, --meeting-password-file PATH, --duration MINUTES, --language LANGUAGE, --attendee EMAIL, --yes, --dry-run |
| fireflies meetings soundbites create MEETING_ID | Create a soundbite in a live meeting. | --prompt TEXT, --yes, --dry-run |
| fireflies meetings state update MEETING_ID | Pause or resume the recording of a live meeting. | --action ACTION, --yes, --dry-run |

### rules

| Command | Description | Options |
| --- | --- | --- |
| fireflies rules executions list | List automation rule executions grouped by meeting. | --logs-per-meeting N, --rule-id ID, --meeting-id ID, --from-date DATE, --to-date DATE, --test BOOLEAN, --page-size N, --cursor TOKEN, --all, --max-items N |

### transcripts

| Command | Description | Options |
| --- | --- | --- |
| fireflies transcripts list | List and filter transcripts. | --keyword TEXT, --scope SCOPE, --title TEXT, --date DATE, --from-date DATE, --to-date DATE, --host-email EMAIL, --user-id ID, --mine, --organizer EMAIL, --participant EMAIL, --channel-id ID, --page-size N, --cursor TOKEN, --all, --max-items N |
| fireflies transcripts get TRANSCRIPT_ID | Get one transcript with sentences, summary, and analytics. | None |
| fireflies transcripts delete TRANSCRIPT_ID | Delete a transcript. | --yes, --dry-run |
| fireflies transcripts share TRANSCRIPT_ID | Share a transcript by email. | --email EMAIL, --expiry-days DAYS, --yes, --dry-run |
| fireflies transcripts access revoke TRANSCRIPT_ID | Revoke shared access to a transcript. | --email EMAIL, --yes, --dry-run |
| fireflies transcripts channel update TRANSCRIPT_ID | Move a transcript to a channel. | --channel-id ID, --yes, --dry-run |
| fireflies transcripts privacy update TRANSCRIPT_ID | Update the privacy of a transcript. | --privacy PRIVACY, --yes, --dry-run |
| fireflies transcripts title update TRANSCRIPT_ID | Update the meeting title of a transcript. | --title TEXT, --yes, --dry-run |

### users

| Command | Description | Options |
| --- | --- | --- |
| fireflies users list | List team users. | None |
| fireflies users get USER_ID | Get one user. | None |
| fireflies users current get | Get the user that owns the API key. | None |
| fireflies users groups list | List user groups. | --mine |
| fireflies users role update USER_ID | Update the role of a user. | --role ROLE, --yes, --dry-run |

### setup

| Command | Description | Options |
| --- | --- | --- |
| fireflies setup [NAME] | Create and activate a profile. | --api-key-file PATH, --base-url URL, --from-env |

### profiles

| Command | Description | Options |
| --- | --- | --- |
| fireflies profiles list | List saved profiles. | None |
| fireflies profiles get NAME | Get one saved profile with secrets redacted. | None |
| fireflies profiles create NAME | Create a profile without activating it. | --api-key-file PATH, --base-url URL |
| fireflies profiles update NAME | Update fields of a profile. | --api-key-file PATH, --base-url URL, --clear-base-url |
| fireflies profiles delete NAME | Delete a profile. | None |
| fireflies profiles use NAME | Make a profile the active profile. | None |

### config

| Command | Description | Options |
| --- | --- | --- |
| fireflies config list | List every configuration key. | None |
| fireflies config get KEY | Get one configuration value. | None |
| fireflies config set KEY VALUE | Set one configuration value. | None |
| fireflies config unset KEY | Remove one configuration value. | None |
| fireflies config path | Get the configuration paths. | None |

### auth

| Command | Description | Options |
| --- | --- | --- |
| fireflies auth verify | Verify the API key. | None |

### api

| Command | Description | Options |
| --- | --- | --- |
| fireflies api request METHOD PATH | Send a raw API request. | --query KEY=VALUE, --file PATH, --yes, --dry-run |

### completions

| Command | Description | Options |
| --- | --- | --- |
| fireflies completions SHELL | Print a shell completion script. | None |

## Global options

| Option | Description |
| --- | --- |
| -h, --help | Show help. Uses no credentials or network. |
| --version | Print the executable name and version. |
| --profile NAME | Select a saved profile. |
| --format FORMAT | Output format. Allowed: json, pretty, human. Default: json. |
| --color WHEN | Color for pretty and human output. Allowed: auto, always, never. Default: auto. |
| -q, --quiet | Suppress progress and notices. Results and errors still print. |
| -v, --verbose | Print redacted diagnostics to stderr. |
| --no-input | Never prompt. Fail when input is missing. |
| --timeout DURATION | Per-request timeout in ms, s, or m, from 1ms to 10m. Default: 30s. |

Network commands (the resource commands, `auth verify`, and `api request`) accept every option except `--version`. Local commands (`setup`, `profiles`, and `config`) accept `--help`, `--format`, `--color`, `--quiet`, `--verbose`, and `--no-input`. `completions` accepts only `--help`. With no command, only `--help`, `--version`, `--verbose`, and `--quiet` apply, and `--version` with a command word fails.

## Authentication

Create a Fireflies API key in the Fireflies web app under **Integrations > Fireflies API**.

```bash
fireflies setup work --api-key-file ./fireflies-api-key.txt
fireflies auth verify
```

`setup [NAME]` creates a profile (default name: `default`) and makes it the active profile. It fails when the profile exists. If activation fails after the profile is written, the profile stays saved and `setup` exits 8 with `PARTIAL_FAILURE`. In a terminal without `--no-input`, `setup` prompts for a missing API key with hidden input. Secrets are never command-line values: pass `--api-key-file PATH` (`-` reads stdin), set `FIREFLIES_API_KEY`, or enter the key at the prompt. `setup --from-env` copies `FIREFLIES_API_KEY` and `FIREFLIES_BASE_URL` into the profile and cannot be combined with `--api-key-file` or `--base-url`. The same rule covers `audio-files upload --download-auth-file PATH` and `meetings bots create --meeting-password-file PATH`, which read a secret from a file, or from stdin with `-`.

| Variable | Purpose |
| --- | --- |
| `FIREFLIES_PROFILE` | Select a saved profile. |
| `FIREFLIES_API_KEY` | Fireflies API key (bearer token). |
| `FIREFLIES_BASE_URL` | Complete GraphQL endpoint URL. Default: `https://api.fireflies.ai/graphql`. |
| `XDG_CONFIG_HOME` | Configuration root when it is an absolute path. Otherwise `~/.config`. |
| `NO_COLOR` | Disables color with `--color auto` when set and nonempty. |
| `CI` | Disables prompts when nonempty and not `0` or `false`. |

A `FIREFLIES_` variable that is set but empty, a malformed `FIREFLIES_PROFILE`, and an invalid `FIREFLIES_BASE_URL` fail with `CONFIGURATION_ERROR` and name the variable. None of them falls through to the next source.

Precedence:

1. Profile selection: `--profile`, `FIREFLIES_PROFILE`, then `activeProfile` in `config.json`. A selected or active profile that does not exist fails with `CONFIGURATION_ERROR`, with no fallback.
2. Credentials: `FIREFLIES_API_KEY`, then the selected profile.
3. Endpoint: `FIREFLIES_BASE_URL`, the selected profile, `baseUrl` in `config.json`, then `https://api.fireflies.ai/graphql`.

`fireflies auth verify` sends `POST /graphql` with the VerifyCredential query. Success proves that Fireflies accepted the API key and identifies its owner. It does not prove complete permission coverage.

## Output and errors

The default output format is `json`: one compact, uncolored line on stdout with the envelope `{"data":...,"meta":{...}}`. `--format pretty` prints the same document indented, with syntax highlighting when color applies. `--format human` prints tables for collections and labeled fields for one resource. Errors go to stderr in the selected format. Help, `--version`, and `completions` print plain text.

`data` is an object for one resource, an array for a collection, or `null`, and keeps Fireflies field names. `meta` is always present.

| `meta` key | When |
| --- | --- |
| `next_cursor` | Paginated collection reads. A string, or `null` when no page remains. |
| `has_more` | Paginated collection reads. |
| `dry_run`, `validation` | Dry-run previews. `validation` is `local`. |

Errors print one document on stderr, for example `{"error":{"code":"RATE_LIMITED","message":"Fireflies rejected the request: too many requests (HTTP 429).","hint":"Wait 20 seconds and retry.","retryable":true,"provider":{"status":429,"code":"too_many_requests","request_id":"req_123","retry_after_seconds":20}}}`. Optional keys are `hint`, `outcome` (`unknown` when a mutation may have applied), `provider` (`status`, `code`, `request_id`, `retry_after_seconds`), `details`, and `partial`. `--format human` prints `Error [CODE]: message` and `Hint: ...`.

| Exit | Error codes |
| --- | --- |
| 0 | Success, including empty collections. |
| 1 | `UNEXPECTED_ERROR`, `PROVIDER_ERROR`, `INVALID_RESPONSE`, `UNSUPPORTED_RESPONSE` |
| 2 | `INVALID_ARGUMENT`, `INVALID_REQUEST` |
| 3 | `CONFIGURATION_ERROR`, `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_FAILED` |
| 4 | `PERMISSION_DENIED` |
| 5 | `NOT_FOUND` |
| 6 | `CONFLICT` |
| 7 | `RATE_LIMITED`, `TRANSIENT_FAILURE` |
| 8 | `PARTIAL_FAILURE` |
| 9 | `CONFIRMATION_REQUIRED`, `CONFIRMATION_DECLINED` |
| 130 | `INTERRUPTED` |

IDs are opaque strings. Options accept `--name value` and `--name=value`, and `--` ends options. Tri-state Fireflies filters (`--test`, `--my-team`, `--save-video`) take `true` or `false`, and omitting them sends nothing. Dates accept `YYYY-MM-DD` (read as 00:00 UTC) and `YYYY-MM-DDTHH:MM:SS[.fff](Z|+HH:MM)`; the CLI sends the UTC instant, and Fireflies does not document whether date boundaries are inclusive. Unknown commands, options, extra arguments, invalid values, and conflicting options fail with exit code 2 before any request.

Remote mutations need confirmation. The CLI validates arguments first, then resolves credentials (exit 3 when missing), then asks for confirmation. In a terminal, it shows the profile, operation, request, and effect, then prompts. `--yes` confirms without a prompt. With `--no-input`, a non-terminal stdin or stderr, or CI mode, a missing confirmation exits 9. Ctrl-C or end of input at a prompt exits 130 with `INTERRUPTED`. `--dry-run` prints a redacted preview of the request and sends nothing. It validates locally, reads nothing remotely, and needs no credentials. Preview success does not guarantee that the request succeeds. Each mutation sends one GraphQL request and is not atomic across requests.

A GraphQL response that returns data and errors together, or a pagination failure after at least one page, exits 8 with `PARTIAL_FAILURE` and a `partial` object, and never implies a rollback. A mutation that succeeds but fails read-back verification (`transcripts channel update` when the response omits the transcript) also exits 8 with `details.cause` set to `INVALID_RESPONSE`. A GraphQL response with errors and no usable data fails with the error code that Fireflies reports. The `partial` object has one of two shapes. Multi-step failures use `{"completed":[{"step":"transcript","result":{}}],"failed":[{"step":"transcript.summary","error":{"code":"PERMISSION_DENIED","message":"..."}}],"not_attempted":[]}`, where `step` is a GraphQL root field or error path. Pagination failures use `{"data":[...items read so far],"next_cursor":"20"}`, and `next_cursor` points at the first unread item. Known secret values (the API key, download credentials, and the meeting password) are replaced with `[redacted]` in Fireflies messages and response bodies before anything prints.

Reads make up to 3 attempts on HTTP 429, 500, 502, 503, 504, network errors, and timeouts, waiting 250 ms, then 500 ms, or the `Retry-After` value up to 10 seconds. A `Retry-After` above 10 seconds is not waited on: the command fails with `RATE_LIMITED` and `provider.retry_after_seconds`. Mutations make one attempt. `--timeout` applies to each attempt. `--verbose` writes redacted request, response, and retry diagnostics to stderr.

## Pagination

Paginated commands fetch one page by default. Fireflies documents a maximum of 50 items per page for transcripts, bites, audit events, and rule execution groups, and a maximum of 10 for AI App outputs. The default page size is 20 for audit events and 10 for rule execution groups and AI App outputs, as Fireflies documents, and the maximum for the others. Fireflies documents no result order, so the CLI passes the provider order through. Each rule execution group lists at most `--logs-per-meeting` executions (Fireflies default 5, maximum 20), so `--all` pages meeting groups and can omit executions. Other lists are not paginated and return `meta: {}`.

`--all` follows every cursor. `--max-items N` (with `--all`) shrinks the last request so the read stops on a page boundary, and `meta.next_cursor` resumes it. `--cursor TOKEN` resumes from a previous `meta.next_cursor`, with or without `--all`. `transcripts list`, `bites list`, and `apps list` use decimal offsets as cursors, and Fireflies reports no page count, so `has_more` is true whenever a page is full and the last page can be empty. `audit-events list` and `rules executions list` pass the Fireflies continuation token through unchanged.

```bash
fireflies transcripts list --all --max-items 100 > transcripts.json
fireflies transcripts list --all --cursor "$(jq -r '.meta.next_cursor' transcripts.json)"
```

A repeated cursor or an oversized page on the first page fails with `INVALID_RESPONSE` and exit 1. A failure on a later page exits 8 with `PARTIAL_FAILURE`. The items read so far are in `error.partial.data`, `error.partial.next_cursor` points at the first unread item, and `error.details.cause` names the underlying error code, such as `INVALID_RESPONSE`.

## Raw API access

```bash
fireflies api request POST /graphql --file request.json --dry-run
fireflies api request POST /graphql --file request.json --yes
```

`--file PATH` reads a JSON object with `query`, `variables`, and `operationName` from a path, or from stdin with `-`, and the CLI sends it as `application/json`. `PATH` must be `/graphql`, which selects the configured endpoint, and any other `PATH` fails with `INVALID_ARGUMENT`. `--query KEY=VALUE` adds a query parameter to the request URL and is repeatable. The CLI sends the selected profile's bearer token only to that endpoint. Fireflies validates the document, and the CLI does not parse it, so it cannot tell whether a document reads or writes and every request needs confirmation. JSON responses print as parsed, other text prints as a JSON string, an empty body prints `null`, and binary responses fail with `UNSUPPORTED_RESPONSE`. A GraphQL `errors` field in a 2xx body is part of that body and does not change the exit code. Non-2xx responses use the same error mapping as other commands. Use `api request` for attendees with a name or phone number, because `--attendee EMAIL` adds an attendee by email address only.

## Configuration

Files live in `$XDG_CONFIG_HOME/fireflies` when `XDG_CONFIG_HOME` is an absolute path, and in `~/.config/fireflies` otherwise.

```text
fireflies/
  config.json            {"activeProfile": "work", "baseUrl": "https://api.fireflies.ai/graphql"}
  profiles/NAME.json     {"apiKey": "...", "baseUrl": "https://api.fireflies.ai/graphql"}
```

Keys are camelCase. Files use mode `0600`, directories use mode `0700`, and writes are atomic: the CLI creates a temporary file exclusively with mode `0600` in the same directory, then renames it. Reads reject unknown keys and non-object JSON with `CONFIGURATION_ERROR`. Profile names match `^[A-Za-z0-9._-]+$` and are not `.` or `..`. `config.json` keys: `activeProfile` (read-only through `config`; change it with `profiles use`) and `baseUrl`. Profile fields: `apiKey` and `baseUrl`. Secrets are redacted in previews, diagnostics, `profiles get`, and `config list`.

A base URL, from `--base-url`, `config set baseUrl`, `FIREFLIES_BASE_URL`, or a stored file, is the complete GraphQL endpoint. It must be an `https` URL (`http` only for `localhost`, `127.0.0.1`, or `::1`) with no credentials, query string, or fragment. Any path is accepted. Values are stored unchanged, and requests go to the full URL.

Completion scripts come from `fireflies completions bash|zsh|fish` and read only the command registry and local profile names. They complete commands, options, enum values (after `--OPT ` and `--OPT=`), `METHOD`, `SHELL`, and profile names (after `--profile` and for the `NAME` argument of `profiles get|update|delete|use`). They offer nothing after `--` or after an option that takes a free-form value.

## Exceptions

| Rule | Decision | Reason |
| --- | --- | --- |
| `CLI-GRAM-4` | `askfred threads continue`, `transcripts share`, `transcripts access revoke`, and `audio-files upload` are domain actions. | They keep the Fireflies operation names `continueAskFredThread`, `shareMeeting`, `revokeSharedMeetingAccess`, and `uploadAudio`. |
| `CLI-SAFE-8` | `audio-files upload` has no `--wait`. | Fireflies returns `success`, `title`, and `message`, but no job identifier or waitable status. |
| `STYLE-API-1` | `api request` accepts `POST /graphql` only. | GraphQL accepts POST /graphql only, so other methods and paths fail. |

## Development

```bash
bun run build
bun run check
bun link
```

`src/core/` is vendored from cli-core and is never edited here. Change cli-core and run its sync script instead. `docs/cli-conventions.md` restates the command-line contract this tool follows.

## API references

- [Fireflies API introduction](https://docs.fireflies.ai/getting-started/introduction)
- [Fireflies GraphQL API reference](https://docs.fireflies.ai/graphql-api/query/transcripts)
- [Fireflies error codes](https://docs.fireflies.ai/miscellaneous/error-codes)
