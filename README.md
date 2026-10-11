# fireflies-cli

A complete command line interface for the [Fireflies.ai API](https://docs.fireflies.ai/getting-started/introduction).

This project owns the `fireflies` binary. It is not the official Fireflies.ai CLI.

## Install

Install from npm with Node 22 or newer, or with Bun:

```bash
npm install -g @zakiaziz/fireflies-cli
bun add -g @zakiaziz/fireflies-cli
```

To work on the CLI, build and link a checkout with `bun install`, `bun run build`, and `bun link`.

## Setup

```bash
fireflies setup --profile default
fireflies auth verify
```

Profiles live in `~/.config/fireflies`. Setup accepts `--api-key`, `--base-url`, and `--from-env`. Interactive setup prompts for a missing API key.

API-key resolution order:

1. `--api-key`
2. `FIREFLIES_API_KEY`
3. The profile selected by `--profile <name>`
4. The active profile

The GraphQL endpoint resolves from `--base-url`, `FIREFLIES_BASE_URL`, the selected profile, global configuration, and then `https://api.fireflies.ai/graphql`.

## Command conventions

Operational commands default to compact, uncolored JSON with a `data`/`meta` envelope. Use `--format pretty` for indented JSON with terminal color or `--format human` for tables and labeled fields. A GraphQL `errors` response exits nonzero and includes each error's message, code, and path when Fireflies provides them.

Every remote mutation requires interactive confirmation or `--yes`. Noninteractive execution without `--yes` exits 9. Use `--dry-run` to print the redacted GraphQL request without sending it:

```bash
fireflies transcripts privacy update transcript-id --privacy owner --dry-run
fireflies transcripts privacy update transcript-id --privacy owner --yes
```

Registered operations accept command-specific flags, a complete variables object with literal JSON in `--variables`, and repeatable `--set path=value` assignments. Values resolve in that order, so command flags replace values from `--variables`, and `--set` applies last.

Use `--fields` to replace a registered operation's default GraphQL selection set:

```bash
fireflies transcripts get transcript-id \
  --fields 'id title summary { short_summary action_items }'
```

Use `fireflies api request POST /graphql --file REQUEST.json` when Fireflies adds an operation or field before this CLI registry is updated.

## Pagination

Paginated reads fetch one provider page by default. Use `--page-size N`, `--cursor TOKEN`, `--all`, and `--max-items N`. `--max-items` requires `--all`. Output metadata contains `next_cursor` and `has_more`; a non-null cursor resumes without dropping unread items. Fireflies preserves provider ordering. Offset-backed endpoints expose the next offset as an opaque cursor.

Date filters accept `YYYY-MM-DD` at midnight UTC or an ISO 8601 date-time with an explicit offset. `--from-date` is inclusive, and `--to-date` is exclusive.

## Complete command reference

### Setup, profiles, and configuration

| Command | Description |
| --- | --- |
| `fireflies setup [profile] [--profile NAME] [--api-key KEY] [--from-env]` | Create and activate a profile. |
| `fireflies profiles list` | List profile names and the active profile. |
| `fireflies profiles get <name>` | Show a profile with its API key redacted. |
| `fireflies profiles create <name> --api-key KEY` | Create a profile. |
| `fireflies profiles update <name> [--api-key KEY] [--base-url URL]` | Update a profile. |
| `fireflies profiles delete <name>` | Delete a profile. |
| `fireflies profiles use <name>` | Make a profile active. |
| `fireflies config path` | Show the configuration file path. |
| `fireflies config list` | Show global configuration with secrets redacted. |
| `fireflies config get <key>` | Read `baseUrl` or `activeProfile`. |
| `fireflies config set <key> <value>` | Set `baseUrl` or `activeProfile`. |
| `fireflies config unset <key>` | Remove `baseUrl` or `activeProfile`. |
| `fireflies auth verify` | Verify the configured API key by querying its owner. |
| `fireflies completions bash` | Print Bash completions. |
| `fireflies completions zsh` | Print Z shell completions. |
| `fireflies completions fish` | Print fish completions. |

### Transcripts

| Command | Access | Description |
| --- | --- | --- |
| `fireflies transcripts list` | Read | List transcripts. Supports `--keyword`, `--scope`, `--from-date`, `--to-date`, `--page-size`, `--cursor`, `--host-email`, `--user-id`, `--mine`, `--organizers`, `--participants`, and `--channel-id`. |
| `fireflies transcripts get <transcriptId>` | Read | Get transcript details, sentences, summary, and analytics. |
| `fireflies transcripts delete <transcriptId>` | Write | Delete a transcript. |
| `fireflies transcripts title update <transcriptId> --title TITLE` | Write | Update the meeting title. |
| `fireflies transcripts privacy update <transcriptId> --privacy PRIVACY` | Write | Set `link`, `owner`, `participants`, `teammatesandparticipants`, or `teammates` privacy. |
| `fireflies transcripts channel update <transcriptId> --channel-id ID` | Write | Assign one transcript to a channel. |
| `fireflies transcripts share <transcriptId> --emails EMAILS [--expiry-days 7\|14\|30]` | Write | Share a transcript with up to 50 comma-separated email addresses. |
| `fireflies transcripts revoke-access <transcriptId> --email EMAIL` | Write | Revoke an email address's shared access. |

Examples:

```bash
fireflies transcripts list --mine true --from-date 2026-08-01T00:00:00.000Z --page-size 50
fireflies transcripts list --keyword underwriting --scope all --participants buyer@example.com
fireflies transcripts get transcript-id --fields 'id title summary { short_summary }'
```

For compatibility with the Fireflies API, `transcripts list` also accepts the deprecated `--title`, `--date`, `--organizer-email`, and `--participant-email` filters. Prefer `--keyword`, date ranges, `--organizers`, and `--participants` for new scripts.

### Live meetings

| Command | Access | Description |
| --- | --- | --- |
| `fireflies meetings list` | Read | List active or paused meetings. Supports `--email` and `--states active,paused`. |
| `fireflies meetings action-items list <meetingId>` | Read | List action items for a live meeting. |
| `fireflies meetings bots create <meetingLink>` | Write | Add the Fireflies bot to an ongoing meeting. Supports `--title`, `--meeting-password`, `--duration`, `--language`, and `--attendees`. |
| `fireflies meetings state update <meetingId> --action ACTION` | Write | Use `pause_recording` or `resume_recording`. |
| `fireflies meetings action-items create <meetingId> --prompt PROMPT` | Write | Create an action item during a live meeting. |
| `fireflies meetings soundbites create <meetingId> --prompt PROMPT` | Write | Create a soundbite during a live meeting. |

Supply attendees as a JSON array or a JSON file:

```bash
fireflies meetings add https://meet.google.com/example \
  --attendees '[{"email":"person@example.com"}]' \
  --dry-run
```

### Audio uploads

| Command | Access | Description |
| --- | --- | --- |
| `fireflies audio-files upload <url>` | Write | Queue a directly downloadable HTTPS media URL. Supports `--title`, `--webhook`, `--language`, `--save-video`, `--attendees`, `--client-reference-id`, `--bypass-size-check`, and `--download-auth`. |

Fireflies downloads media from a URL. The API does not accept a local file upload. For protected media, pass a `DownloadAuthInput` JSON object:

```bash
fireflies audio-files upload https://media.example.com/meeting.mp3 \
  --download-auth '{"type":"bearer_token","bearer":{"token":"download-token"}}' \
  --dry-run
```

Nested tokens and passwords are redacted from dry-run output.

### AskFred

| Command | Access | Description |
| --- | --- | --- |
| `fireflies askfred threads list` | Read | List AskFred threads. Supports `--transcript-id`. |
| `fireflies askfred threads get <threadId>` | Read | Get a thread and its messages. |
| `fireflies askfred threads create --query QUESTION` | Write | Start a thread for one transcript or a filtered meeting set. |
| `fireflies askfred threads update <threadId> --query QUESTION` | Write | Ask a follow-up question. |
| `fireflies askfred threads delete <threadId>` | Write | Delete a thread and its messages. |

`askfred threads create` supports `--transcript-id`, `--start-time`, `--end-time`, `--channel-ids`, `--organizers`, `--participants`, `--transcript-ids`, `--response-language`, and `--response-format markdown|plaintext`.

### Users and channels

| Command | Access | Description |
| --- | --- | --- |
| `fireflies users list` | Read | List team users. |
| `fireflies users get [userId]` | Read | Get a user, or omit the ID to get the API-key owner. |
| `fireflies users groups list` | Read | List user groups. Supports `--mine`. |
| `fireflies users role update <userId> --role admin\|user` | Write | Set a user's role. |
| `fireflies channels list` | Read | List channels. |
| `fireflies channels get <channelId>` | Read | Get one channel and its members. |
| `fireflies contacts list` | Read | List contacts. |

### Bites

| Command | Access | Description |
| --- | --- | --- |
| `fireflies bites list --mine true\|false` | Read | List bites. Supports `--transcript-id`, `--my-team`, `--page-size`, and `--cursor`. |
| `fireflies bites get <biteId>` | Read | Get one bite. |
| `fireflies bites create <transcriptId> --start-time N --end-time N` | Write | Create a bite. Supports `--name`, `--media-type audio\|video`, `--privacies`, and `--summary`. |

### Analytics, apps, rules, and audit events

| Command | Access | Description |
| --- | --- | --- |
| `fireflies analytics get` | Read | Get team and user analytics. Supports `--start-time` and `--end-time`. |
| `fireflies apps list` | Read | List AI App outputs. Supports `--app-id`, `--transcript-id`, `--cursor`, and `--page-size`. |
| `fireflies rules executions list` | Read | List rule executions by meeting. Supports pagination and rule, meeting, date, and test filters. |
| `fireflies audit-events list --category CATEGORY` | Read | List audit events. Supports `--page-size`, `--cursor`, `--action`, `--from-date`, `--to-date`, `--actor-user-id`, and `--actor-email`. |

Audit categories are `MEETING_OPERATIONS`, `TEAM_OPERATIONS`, `USER_OPERATIONS`, and `AUTHENTICATION`.

### Raw API

| Command | Access | Description |
| --- | --- | --- |
| `fireflies api request POST /graphql --file REQUEST.json` | Read or write | Execute an exact GraphQL request body. Mutations require confirmation. |

The request file accepts exactly `query`, `variables`, and `operationName`. Repeat `--query key=value` for URL query parameters. Raw output preserves the Fireflies response shape.

```bash
fireflies api request POST /graphql --file request.json --dry-run
```

## Global options

| Option | Purpose |
| --- | --- |
| `--profile NAME` | Select a saved profile. |
| `--api-key KEY` | Override the Fireflies API key. Prefer `FIREFLIES_API_KEY` or a protected profile. |
| `--base-url URL` | Override the GraphQL endpoint. HTTPS is required outside localhost. |
| `--format json\|pretty\|human` | Select output. Default: `json`. |
| `--color auto\|always\|never` | Control pretty and human color. Default: `auto`. |
| `--quiet`, `-q` | Suppress notices and progress. |
| `--verbose`, `-v` | Show redacted diagnostics on stderr. |
| `--no-input` | Never prompt. |
| `--timeout DURATION` | Set the request timeout with `ms`, `s`, or `m`. Default: `30s`. |
| `--help`, `-h` | Show local help. |
| `--version` | Show the executable name and version. |

Command-specific options include `--yes`, `-y`, `--dry-run`, `--file`, and pagination controls. JSON output is always uncolored. `NO_COLOR` disables automatic color for pretty and human output.

## API coverage

The command registry covers every query and mutation listed in the Fireflies API documentation on `2026-09-03`. Webhooks and the Realtime API require server or streaming processes, so they are documented by Fireflies but are not one-shot CLI commands. Raw GraphQL access preserves forward compatibility with new fields and operations.
