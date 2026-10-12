import { readFileSync } from "node:fs";
import { usageError } from "./core/errors.js";
import type { PagedRequest, PageInfo, PageRequest, Pagination, RequestSpec, ResourceCommand } from "./core/provider.js";
import {
  dateOption,
  type ArgumentSpec,
  type Context,
  type Effects,
  type Exception,
  type GroupSpec,
  type OptionSpec,
  type PaginationSpec,
} from "./core/registry.js";
import { echoable, invalidValue, isRecord, REDACTED, redactCredentials } from "./core/values.js";

const AUDIT_ACTIONS = [
  "MEETING_DELETED",
  "MEETING_PRIVACY_UPDATED",
  "MEETING_VIEWED",
  "MEETING_SHARED",
  "MEETING_ACCESS_REVOKED",
  "MEETING_DOWNLOADED",
  "MEETING_TITLE_UPDATED",
  "MEETING_MOVED_TO_CHANNEL",
  "SOUNDBITE_CREATED",
  "TEAMMATE_ADDED",
  "TEAMMATE_REMOVED",
  "USER_GROUP_MEMBER_ADDED",
  "USER_GROUP_MEMBER_REMOVED",
  "USER_ROLE_CHANGED",
  "SETTINGS_UPDATED",
  "LOGIN",
  "LOGOUT",
];

function variablesOf(request: PagedRequest): Record<string, unknown> {
  const body = request.body as { variables?: Record<string, unknown> };
  body.variables ??= {};
  return body.variables;
}

/** Offset pages: the cursor is the decimal offset, sent as the skip variable. Fireflies reports no page count. */
export const offsetPagination: Pagination = {
  apply(request: PagedRequest, page: PageRequest) {
    const variables = variablesOf(request);
    variables.limit = page.size;
    if (page.cursor !== null) variables.skip = Number(page.cursor);
  },
  read(_payload: unknown, _key: string | undefined, page: PageRequest, items: unknown[]): PageInfo {
    const full = items.length >= page.size;
    return { nextCursor: full ? String((page.cursor === null ? 0 : Number(page.cursor)) + items.length) : null };
  },
  checkCursor(value: string): string {
    if (/^[0-9]{1,15}$/.test(value)) return value;
    throw invalidValue("--cursor", "be a decimal offset", value, "Use the meta.next_cursor value from a previous result.");
  },
  detectRepeatedPages: true,
};

/** Token pages: the cursor is the Fireflies continuation token, read from next_cursor and has_more. */
const tokenPagination: Pagination = {
  apply(request: PagedRequest, page: PageRequest) {
    const variables = variablesOf(request);
    variables.limit = page.size;
    if (page.cursor !== null) variables.cursor = page.cursor;
  },
  read(payload: unknown): PageInfo | undefined {
    if (!isRecord(payload)) return undefined;
    const { next_cursor: next, has_more: more } = payload;
    if (typeof more !== "boolean") return undefined;
    if (next !== null && next !== undefined && (typeof next !== "string" || next === "")) return undefined;
    const nextCursor = more && typeof next === "string" ? next : null;
    if (more && nextCursor === null) return undefined;
    return { nextCursor, hasMore: more };
  },
};

const PROVIDER_ORDERING = "Order is set by Fireflies and is undocumented.";

const userFields = `
  user_id email name is_admin num_transcripts recent_transcript recent_meeting
  minutes_consumed integrations is_calendar_in_sync
  user_groups { id name handle }
`;

const channelFields = `
  id title is_private created_by created_at updated_at
  members { user_id email name }
`;

const transcriptListFields = `
  id title date dateString duration host_email organizer_email participants
  transcript_url privacy meeting_link is_live
  channels { id }
  summary { gist short_summary action_items keywords topics_discussed }
`;

const transcriptFields = `
  ${transcriptListFields}
  speakers { id name }
  sentences {
    index speaker_name speaker_id text raw_text start_time end_time
    ai_filters { task pricing metric question date_and_time text_cleanup sentiment }
  }
  analytics {
    sentiments { negative_pct neutral_pct positive_pct }
    categories { questions date_times metrics tasks }
    speakers {
      speaker_id name duration word_count longest_monologue monologues_count
      filler_words questions duration_pct words_per_minute
    }
  }
  meeting_attendees { displayName email phoneNumber name location }
  meeting_attendance { name join_time leave_time }
  meeting_info { fred_joined silent_meeting summary_status }
  summary {
    keywords action_items outline shorthand_bullet overview bullet_gist gist
    short_summary short_overview meeting_type topics_discussed transcript_chapters
  }
`;

const biteFields = `
  id transcript_id name status summary summary_status user_id start_time end_time
  media_type thumbnail preview created_at privacies
  captions { index speaker_id speaker_name text start_time end_time }
  sources { src type }
`;

const askFredThreadFields = "id title transcript_id user_id created_at";

const askFredMessageFields = `
  message {
    id thread_id query answer suggested_queries status error created_at updated_at
  }
`;


const GRAPHQL_PATH = "/graphql";

interface Definition {
  path: string[];
  summary: string;
  arguments?: ArgumentSpec[];
  options?: OptionSpec[];
  graphql: {
    kind: "query" | "mutation";
    name: string;
    variables: string;
    field: string;
    arguments?: string;
    selection: string;
  };
  variables?: (context: Context) => Record<string, unknown>;
  /** Variable names whose whole value stays out of dry-run previews. */
  hiddenVariables?: string[];
  output: string;
  collectionKey?: string;
  /** The GraphQL root field is the collection array itself. */
  collection?: boolean;
  pagination?: PaginationSpec;
  unpaginated?: string;
  effect?: string;
  examples: string[];
  exceptions?: Exception[];
}

function argument(name: string, description: string): ArgumentSpec {
  return { name, description };
}

function stringOption(name: string, placeholder: string, description: string, extra: Partial<OptionSpec> = {}): OptionSpec {
  return { name, placeholder, type: "string", description, ...extra };
}

function enumOption(name: string, placeholder: string, description: string, choices: string[], extra: Partial<OptionSpec> = {}): OptionSpec {
  return { name, placeholder, type: "enum", choices, description, ...extra };
}

function integerOption(name: string, placeholder: string, description: string, extra: Partial<OptionSpec> = {}): OptionSpec {
  return { name, placeholder, type: "integer", description, ...extra };
}

function booleanOption(name: string, description: string, extra: Partial<OptionSpec> = {}): OptionSpec {
  return { name, type: "boolean", description, ...extra };
}

function triStateOption(name: string, description: string): OptionSpec {
  return enumOption(name, "BOOLEAN", description, ["true", "false"]);
}

function triState(options: Context["options"], name: string): boolean | undefined {
  const value = options.string(name);
  return value === undefined ? undefined : value === "true";
}

function target(context: Context): string {
  return context.args[0] ?? "";
}

/** Drops undefined values, empty arrays, and empty objects so omitted options send nothing. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (!isRecord(value)) return value;
  const entries = Object.entries(value)
    .map(([key, child]) => [key, prune(child)] as const)
    .filter(([, child]) => child !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function hide(value: unknown, names: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => hide(item, names));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, names.includes(key) ? REDACTED : hide(child, names)]));
}

function lengthCheck(flag: string, min: number, max: number, secret = false): (value: string) => string {
  const range = min === 0 ? `at most ${max}` : `from ${min} to ${max}`;
  const hintRange = min === 0 ? `at most ${max}` : `${min} to ${max}`;
  return (value) => {
    if (value.length >= min && value.length <= max) return value;
    throw invalidValue(flag, `be ${range} characters`, secret ? REDACTED : echoable(value), `Use ${flag} with ${hintRange} characters.`, `${min}-${max}`);
  };
}

function emailCheck(flag: string): (value: string) => string {
  return (value) => {
    if (/^[^@\s]+@[^@\s]+$/.test(value) && value.length <= 256) return value;
    throw invalidValue(flag, "be an email address of at most 256 characters", echoable(value), `Use ${flag} person@example.com.`, "email address, at most 256 characters");
  };
}

function urlCheck(flag: string, protocols: string[]): (value: string) => string {
  const schemes = protocols.map((protocol) => protocol.slice(0, -1)).join(" or ");
  return (value) => {
    const url = parseUrl(value);
    if (url && protocols.includes(url.protocol) && url.hostname !== "") return value;
    throw invalidValue(flag, `be an ${schemes} URL with a host`, echoable(redactCredentials(value)), `Use ${flag} ${protocols[0]}//example.com/path.`, `${schemes} URL with a host`);
  };
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function attendees(context: Context): { email: string }[] | undefined {
  const emails = context.options.strings("attendee");
  return emails.length > 0 ? emails.map((email) => ({ email })) : undefined;
}

function attendeeOption(): OptionSpec {
  return stringOption("attendee", "EMAIL", "Add an attendee by email address.", { repeatable: true, check: emailCheck("--attendee") });
}

function readInput(option: string, path: string): string {
  try {
    return readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw usageError(
      `${option} could not be read${typeof code === "string" ? ` (${code})` : ""}.`,
      "Check that the path exists and is readable, or use - for stdin.",
    );
  }
}

function readSecret(path: string, flag: string): string {
  const text = readInput(flag, path).replace(/\r?\n$/, "");
  if (text === "") throw usageError(`${flag} ${path} is empty.`, `Put the value in ${path}.`);
  return text;
}

function readJsonObject(path: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readInput(flag, path));
  } catch (error) {
    if (error instanceof SyntaxError) throw usageError(`${flag} ${path} must contain valid JSON.`, `Fix the JSON in ${path}.`);
    throw error;
  }
  if (!isRecord(parsed)) throw usageError(`${flag} ${path} must contain a JSON object.`, `Put one JSON object in ${path}.`);
  return parsed;
}

function validateDownloadAuth(auth: Record<string, unknown>, flag: string, path: string): Record<string, unknown> {
  const fail = (reason: string): never => {
    throw usageError(`${flag} ${path} ${reason}.`, "Use {\"type\":\"bearer_token\",\"bearer\":{\"token\":\"TOKEN\"}} or {\"type\":\"basic_auth\",\"basic\":{\"username\":\"USER\",\"password\":\"PASSWORD\"}}.");
  };
  const type = auth.type;
  const nested = type === "bearer_token" ? auth.bearer : auth.basic;
  const fieldName = type === "bearer_token" ? "bearer" : "basic";
  if (type !== "bearer_token" && type !== "basic_auth") return fail("must set type to \"bearer_token\" or \"basic_auth\"");
  const unknownKey = Object.keys(auth).find((key) => key !== "type" && key !== fieldName);
  if (unknownKey !== undefined) return fail(`contains the unsupported field "${unknownKey}" for type ${type}`);
  if (!isRecord(nested)) return fail(`must set ${fieldName} to an object for type ${type}`);
  const allowed = type === "bearer_token" ? ["token"] : ["username", "password"];
  const unknownNested = Object.keys(nested).find((key) => !allowed.includes(key));
  if (unknownNested !== undefined) return fail(`contains the unsupported field "${fieldName}.${unknownNested}"`);
  const required = type === "bearer_token" ? "token" : "password";
  if (typeof nested[required] !== "string" || nested[required] === "") return fail(`must set ${fieldName}.${required} to a non-empty string`);
  if (nested.username !== undefined && typeof nested.username !== "string") return fail(`must set ${fieldName}.username to a string`);
  return auth;
}

function document(definition: Definition): string {
  const { kind, name, variables, field, arguments: callArguments, selection } = definition.graphql;
  const call = callArguments ? `${field}(${callArguments})` : field;
  return `${kind} ${name}${variables} { ${call} { ${selection} } }`.replace(/\s+/g, " ");
}

function fillEffect(effect: string, definition: Definition, context: Context): string {
  return (definition.arguments ?? []).reduce((text, { name }, index) => text.replaceAll(name, () => context.args[index] ?? ""), effect);
}

function requestFor(definition: Definition, text: string, context: Context): RequestSpec {
  const variables = prune(definition.variables?.(context) ?? {}) as Record<string, unknown> | undefined;
  const body = { query: text, ...(variables ? { variables } : {}) };
  const hidden = definition.hiddenVariables;
  return {
    path: GRAPHQL_PATH,
    field: definition.graphql.field,
    body,
    ...(hidden && variables ? { previewBody: { query: text, variables: hide(variables, hidden) } } : {}),
    ...(definition.effect ? { effect: fillEffect(definition.effect, definition, context) } : {}),
  };
}

function toCommand(definition: Definition): ResourceCommand {
  const mutation = definition.graphql.kind === "mutation";
  const text = document(definition);
  const effects: Effects = mutation ? { kind: "remote-mutation", ...(definition.effect ? { summary: definition.effect } : {}) } : { kind: "read" };
  return {
    path: definition.path,
    summary: definition.summary,
    arguments: definition.arguments ?? [],
    options: definition.options ?? [],
    effects,
    output: definition.output,
    method: "POST",
    ...(definition.collectionKey ? { collectionKey: definition.collectionKey } : {}),
    ...(definition.collection ? { collection: true } : {}),
    ...(definition.pagination ? { pagination: definition.pagination } : {}),
    ...(definition.unpaginated ? { unpaginated: definition.unpaginated } : {}),
    ...(!mutation && definition.path.at(-1) === "get" ? { emptyIsNotFound: true } : {}),
    examples: definition.examples,
    ...(definition.exceptions ? { exceptions: definition.exceptions } : {}),
    request: (context) => requestFor(definition, text, context),
  };
}

const UNPAGINATED = "Not paginated. The Fireflies API accepts no paging arguments for this query and returns its list in one response; meta is empty.";
const TRANSCRIPT_ID = argument("TRANSCRIPT_ID", "Transcript ID.");
const MEETING_ID = argument("MEETING_ID", "Live meeting ID.");
const THREAD_ID = argument("THREAD_ID", "AskFred thread ID.");
const USER_ID = argument("USER_ID", "User ID.");
const RESPONSE_OPTIONS = [
  stringOption("response-language", "LANGUAGE", "Language of the answer."),
  enumOption("response-format", "FORMAT", "Format of the answer.", ["markdown", "plaintext"]),
];
const PROMPT_OPTION = stringOption("prompt", "TEXT", "Prompt that describes the item. 5 to 255 characters.", {
  required: true,
  check: lengthCheck("--prompt", 5, 255),
});
const checkMeetingPassword = lengthCheck("--meeting-password-file", 0, 32, true);
const TRANSCRIPT_FILTER_OPTIONS = ["from-date", "to-date", "channel-id", "organizer", "participant", "filter-transcript-id"];

export const groups: GroupSpec[] = [
  { path: ["analytics"], summary: "Get conversation analytics.", title: "Inspect conversation analytics." },
  { path: ["apps"], summary: "List AI App outputs.", title: "Inspect AI App outputs." },
  { path: ["askfred"], summary: "Ask questions about meetings.", title: "Manage AskFred conversations." },
  { path: ["askfred", "threads"], summary: "List, get, create, continue, and delete threads.", title: "Manage AskFred threads." },
  { path: ["audio-files"], summary: "Upload audio and video for transcription.", title: "Manage audio files." },
  { path: ["audit-events"], summary: "List audit events.", title: "Inspect audit events." },
  { path: ["bites"], summary: "List, get, and create soundbites.", title: "Manage soundbites." },
  { path: ["channels"], summary: "List and get channels.", title: "Inspect channels." },
  { path: ["contacts"], summary: "List contacts.", title: "Inspect contacts." },
  { path: ["meetings"], summary: "List live meetings and act on them.", title: "Manage live meetings." },
  { path: ["meetings", "action-items"], summary: "List and create live action items.", title: "Manage live action items." },
  { path: ["meetings", "bots"], summary: "Add the bot to a live meeting.", title: "Manage live meeting bots." },
  { path: ["meetings", "soundbites"], summary: "Create live soundbites.", title: "Manage live soundbites." },
  { path: ["meetings", "state"], summary: "Pause or resume live recording.", title: "Manage live recording state." },
  { path: ["rules"], summary: "List automation rule executions.", title: "Inspect automation rules." },
  { path: ["rules", "executions"], summary: "List rule executions.", title: "Inspect rule executions." },
  { path: ["transcripts"], summary: "List, get, update, and delete meeting transcripts.", title: "Manage meeting transcripts." },
  { path: ["transcripts", "access"], summary: "Revoke shared access.", title: "Manage transcript access." },
  { path: ["transcripts", "channel"], summary: "Move a transcript to a channel.", title: "Manage transcript channels." },
  { path: ["transcripts", "privacy"], summary: "Update transcript privacy.", title: "Manage transcript privacy." },
  { path: ["transcripts", "title"], summary: "Update transcript titles.", title: "Manage transcript titles." },
  { path: ["users"], summary: "Get users and change roles.", title: "Manage users." },
  { path: ["users", "current"], summary: "Get the current user.", title: "Inspect the current user." },
  { path: ["users", "groups"], summary: "List user groups.", title: "Inspect user groups." },
  { path: ["users", "role"], summary: "Update user roles.", title: "Manage user roles." },
];

const definitions: Definition[] = [
  {
    path: ["analytics", "get"],
    summary: "Get team and user conversation analytics.",
    options: [
      dateOption("from-date", "Analytics starting from", "undocumented"),
      dateOption("to-date", "Analytics ending at", "undocumented"),
    ],
    graphql: {
      kind: "query",
      name: "Analytics",
      variables: "($startTime: String, $endTime: String)",
      field: "analytics",
      arguments: "start_time: $startTime, end_time: $endTime",
      selection: `
        team {
          conversation {
            average_filler_words average_monologues_count average_questions
            average_sentiments { negative_pct neutral_pct positive_pct }
            average_silence_duration average_talk_listen_ratio average_words_per_minute
            total_meeting_notes_count total_meetings_count teammates_count
          }
          meeting { count duration average_count average_duration }
        }
        users {
          user_id user_name user_email
          conversation {
            talk_listen_pct total_silence_duration total_speak_duration total_word_count
            user_filler_words user_longest_monologue_sec user_questions user_words_per_minute
          }
          meeting { count duration }
        }
      `,
    },
    variables: (context) => ({
      startTime: context.options.string("from-date"),
      endTime: context.options.string("to-date"),
    }),
    output: "Resource envelope. data is the analytics object with team and users; meta is empty.",
    examples: ["fireflies analytics get", "fireflies analytics get --from-date 2026-08-01 --to-date 2026-09-01 --format human"],
  },
  {
    path: ["apps", "list"],
    summary: "List AI App outputs.",
    options: [
      stringOption("app-id", "ID", "Only outputs of this AI App."),
      stringOption("transcript-id", "ID", "Only outputs for this transcript."),
    ],
    graphql: {
      kind: "query",
      name: "AIAppOutputs",
      variables: "($appId: String, $transcriptId: String, $skip: Float, $limit: Float)",
      field: "apps",
      arguments: "app_id: $appId, transcript_id: $transcriptId, skip: $skip, limit: $limit",
      selection: "outputs { transcript_id user_id app_id created_at title prompt response }",
    },
    variables: (context) => ({
      appId: context.options.string("app-id"),
      transcriptId: context.options.string("transcript-id"),
    }),
    collectionKey: "outputs",
    pagination: { max: 10, default: 10, ordering: PROVIDER_ORDERING },
    output: "Collection envelope. data is an array of AI App outputs. meta has next_cursor, a decimal offset, and has_more, which is true when a page is full, so the last page can be empty.",
    examples: ["fireflies apps list --transcript-id 01HXYZ", "fireflies apps list --all --max-items 30"],
  },
  {
    path: ["askfred", "threads", "list"],
    summary: "List AskFred threads.",
    options: [stringOption("transcript-id", "ID", "Only threads for this transcript.")],
    graphql: {
      kind: "query",
      name: "AskFredThreads",
      variables: "($transcriptId: String)",
      field: "askfred_threads",
      arguments: "transcript_id: $transcriptId",
      selection: askFredThreadFields,
    },
    variables: (context) => ({ transcriptId: context.options.string("transcript-id") }),
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of threads; meta is empty.",
    examples: ["fireflies askfred threads list", "fireflies askfred threads list --transcript-id 01HXYZ"],
  },
  {
    path: ["askfred", "threads", "get"],
    summary: "Get one AskFred thread and its messages.",
    arguments: [THREAD_ID],
    graphql: {
      kind: "query",
      name: "AskFredThread",
      variables: "($threadId: String!)",
      field: "askfred_thread",
      arguments: "id: $threadId",
      selection: `${askFredThreadFields} messages { id thread_id query answer suggested_queries status error created_at updated_at }`,
    },
    variables: (context) => ({ threadId: target(context) }),
    output: "Resource envelope. data is the thread object with its messages; meta is empty.",
    examples: ["fireflies askfred threads get 01HXYZ"],
  },
  {
    path: ["askfred", "threads", "create"],
    summary: "Create an AskFred thread.",
    options: [
      stringOption("question", "TEXT", "Question to ask. Maximum 2000 characters.", { required: true, check: lengthCheck("--question", 1, 2000) }),
      stringOption("transcript-id", "ID", "Ask about one transcript.", { conflicts: TRANSCRIPT_FILTER_OPTIONS }),
      dateOption("from-date", "Only meetings after", "undocumented"),
      dateOption("to-date", "Only meetings before", "undocumented"),
      stringOption("channel-id", "ID", "Only meetings in this channel.", { repeatable: true }),
      stringOption("organizer", "EMAIL", "Only meetings organized by this email address.", { repeatable: true, check: emailCheck("--organizer") }),
      stringOption("participant", "EMAIL", "Only meetings with this participant email address.", { repeatable: true, check: emailCheck("--participant") }),
      stringOption("filter-transcript-id", "ID", "Only this transcript in the meeting filter.", { repeatable: true }),
      ...RESPONSE_OPTIONS,
    ],
    graphql: {
      kind: "mutation",
      name: "CreateAskFredThread",
      variables: "($input: CreateAskFredThreadInput!)",
      field: "createAskFredThread",
      arguments: "input: $input",
      selection: askFredMessageFields,
    },
    variables: (context) => {
      const { options } = context;
      return {
        input: {
          query: options.string("question"),
          transcript_id: options.string("transcript-id"),
          filters: {
            start_time: options.string("from-date"),
            end_time: options.string("to-date"),
            channel_ids: options.strings("channel-id"),
            organizers: options.strings("organizer"),
            participants: options.strings("participant"),
            transcript_ids: options.strings("filter-transcript-id"),
          },
          response_language: options.string("response-language"),
          format_mode: options.string("response-format"),
        },
      };
    },
    effect: "Creates an AskFred thread and sends the question to it.",
    output: "Resource envelope. data has a message object, the first message of the new thread; meta is empty.",
    examples: [
      "fireflies askfred threads create --question 'What did we decide about pricing?' --transcript-id 01HXYZ --yes",
      "fireflies askfred threads create --question 'List open risks' --from-date 2026-08-01 --organizer ana@example.com --dry-run",
    ],
  },
  {
    path: ["askfred", "threads", "continue"],
    summary: "Ask a follow-up question in an AskFred thread.",
    arguments: [THREAD_ID],
    options: [
      stringOption("question", "TEXT", "Follow-up question. Maximum 2000 characters.", { required: true, check: lengthCheck("--question", 1, 2000) }),
      ...RESPONSE_OPTIONS,
    ],
    graphql: {
      kind: "mutation",
      name: "ContinueAskFredThread",
      variables: "($input: ContinueAskFredThreadInput!)",
      field: "continueAskFredThread",
      arguments: "input: $input",
      selection: askFredMessageFields,
    },
    variables: (context) => ({
      input: {
        thread_id: target(context),
        query: context.options.string("question"),
        response_language: context.options.string("response-language"),
        format_mode: context.options.string("response-format"),
      },
    }),
    effect: "Adds a follow-up question to AskFred thread THREAD_ID.",
    output: "Resource envelope. data has a message object, the new message; meta is empty.",
    examples: ["fireflies askfred threads continue 01HXYZ --question 'Who owns the follow-ups?' --yes"],
    exceptions: [{ rule: "CLI-GRAM-4", reason: "continue preserves the Fireflies term continueAskFredThread. The command adds a message and changes no thread field." }],
  },
  {
    path: ["askfred", "threads", "delete"],
    summary: "Delete an AskFred thread.",
    arguments: [THREAD_ID],
    graphql: {
      kind: "mutation",
      name: "DeleteAskFredThread",
      variables: "($threadId: String!)",
      field: "deleteAskFredThread",
      arguments: "id: $threadId",
      selection: askFredThreadFields,
    },
    variables: (context) => ({ threadId: target(context) }),
    effect: "Deletes AskFred thread THREAD_ID and its messages. Fireflies documents no way to restore the thread.",
    output: "Resource envelope. data is the deleted thread; meta is empty.",
    examples: ["fireflies askfred threads delete 01HXYZ --dry-run", "fireflies askfred threads delete 01HXYZ --yes"],
  },
  {
    path: ["audio-files", "upload"],
    summary: "Queue a media URL for transcription.",
    arguments: [{ ...argument("URL", "HTTPS URL that Fireflies can download directly."), check: urlCheck("URL", ["https:"]) }],
    options: [
      stringOption("title", "TEXT", "Meeting title. Maximum 256 characters.", { check: lengthCheck("--title", 0, 256) }),
      stringOption("webhook", "URL", "URL that Fireflies calls when the transcript is ready.", { check: urlCheck("--webhook", ["https:", "http:"]) }),
      stringOption("language", "LANGUAGE", "Language code of the audio."),
      triStateOption("save-video", "Keep the video when true, discard it when false. Omit to use the Fireflies default."),
      attendeeOption(),
      stringOption("client-reference-id", "ID", "Your reference ID for this upload. Maximum 128 characters.", { check: lengthCheck("--client-reference-id", 0, 128) }),
      booleanOption("bypass-size-check", "Skip the Fireflies minimum file size check."),
      { name: "download-auth-file", placeholder: "PATH", type: "path", description: "Read the download credentials as a DownloadAuthInput JSON object from PATH. - reads stdin." },
    ],
    graphql: {
      kind: "mutation",
      name: "UploadAudio",
      variables: "($input: AudioUploadInput!)",
      field: "uploadAudio",
      arguments: "input: $input",
      selection: "success title message",
    },
    variables: (context) => {
      const { options } = context;
      const authPath = options.string("download-auth-file");
      return {
        input: {
          url: target(context),
          title: options.string("title"),
          webhook: options.string("webhook"),
          custom_language: options.string("language"),
          save_video: triState(options, "save-video"),
          attendees: attendees(context),
          client_reference_id: options.string("client-reference-id"),
          bypass_size_check: options.flag("bypass-size-check") ? true : undefined,
          download_auth: authPath === undefined ? undefined : validateDownloadAuth(readJsonObject(authPath, "--download-auth-file"), "--download-auth-file", authPath),
        },
      };
    },
    effect: "Queues URL for transcription in Fireflies. Fireflies returns no job identifier, so completion cannot be awaited.",
    hiddenVariables: ["download_auth"],
    output: "Resource envelope. data has success, title, and message from Fireflies; meta is empty.",
    examples: [
      "fireflies audio-files upload https://media.example.com/meeting.mp3 --title 'Weekly sync' --dry-run",
      "fireflies audio-files upload https://media.example.com/private.mp3 --download-auth-file auth.json --yes",
    ],
    exceptions: [
      { rule: "CLI-GRAM-4", reason: "upload preserves the Fireflies term uploadAudio." },
      { rule: "CLI-SAFE-8", reason: "Fireflies returns success, title, and message but no job identifier or waitable status, so there is no --wait." },
    ],
  },
  {
    path: ["audit-events", "list"],
    summary: "List audit events.",
    options: [
      enumOption("category", "CATEGORY", "Event category.", ["MEETING_OPERATIONS", "TEAM_OPERATIONS", "USER_OPERATIONS", "AUTHENTICATION"], { required: true }),
      enumOption("action", "ACTION", "Only events with this action.", AUDIT_ACTIONS),
      dateOption("from-date", "Only events after", "undocumented"),
      dateOption("to-date", "Only events before", "undocumented"),
      stringOption("actor-user-id", "ID", "Only events caused by this user.", { conflicts: ["actor-email"] }),
      stringOption("actor-email", "EMAIL", "Only events caused by this email address.", { check: emailCheck("--actor-email") }),
    ],
    graphql: {
      kind: "query",
      name: "AuditEvents",
      variables: "($limit: Int, $cursor: String, $filters: AuditEventFiltersInput!)",
      field: "auditEvents",
      arguments: "limit: $limit, cursor: $cursor, filters: $filters",
      selection: `
        events {
          id time category action severity status message class_uid activity_id type_uid
          actor { user_id email full_name ip_address }
          resource { type id }
          metadata
        }
        has_more next_cursor
      `,
    },
    variables: (context) => ({
      filters: {
        category: context.options.string("category"),
        action: context.options.string("action"),
        date_from: context.options.string("from-date"),
        date_to: context.options.string("to-date"),
        actor_user_id: context.options.string("actor-user-id"),
        actor_email: context.options.string("actor-email"),
      },
    }),
    collectionKey: "events",
    pagination: { max: 50, default: 20, ordering: PROVIDER_ORDERING, style: tokenPagination },
    output: "Collection envelope. data is an array of Open Cybersecurity Schema Framework events; meta has next_cursor and has_more from Fireflies.",
    examples: ["fireflies audit-events list --category AUTHENTICATION", "fireflies audit-events list --category USER_OPERATIONS --all --max-items 100"],
  },
  {
    path: ["bites", "list"],
    summary: "List soundbites.",
    options: [
      booleanOption("mine", "Only soundbites the API key owner created. Omit to list team soundbites."),
      stringOption("transcript-id", "ID", "Only soundbites of this transcript."),
      triStateOption("my-team", "Include soundbites of the whole team when true. Omit to use the Fireflies default."),
    ],
    graphql: {
      kind: "query",
      name: "Bites",
      variables: "($mine: Boolean!, $transcriptId: ID, $myTeam: Boolean, $limit: Int, $skip: Int)",
      field: "bites",
      arguments: "mine: $mine, transcript_id: $transcriptId, my_team: $myTeam, limit: $limit, skip: $skip",
      selection: biteFields,
    },
    variables: (context) => ({
      mine: context.options.flag("mine"),
      transcriptId: context.options.string("transcript-id"),
      myTeam: triState(context.options, "my-team"),
    }),
    collection: true,
    pagination: { max: 50, default: 50, ordering: PROVIDER_ORDERING },
    output: "Collection envelope. data is an array of soundbites. meta has next_cursor, a decimal offset, and has_more, which is true when a page is full, so the last page can be empty.",
    examples: ["fireflies bites list --mine", "fireflies bites list --transcript-id 01HXYZ --all"],
  },
  {
    path: ["bites", "get"],
    summary: "Get one soundbite.",
    arguments: [argument("BITE_ID", "Soundbite ID.")],
    graphql: {
      kind: "query",
      name: "Bite",
      variables: "($biteId: ID!)",
      field: "bite",
      arguments: "id: $biteId",
      selection: biteFields,
    },
    variables: (context) => ({ biteId: target(context) }),
    output: "Resource envelope. data is the soundbite object; meta is empty.",
    examples: ["fireflies bites get 01HXYZ"],
  },
  {
    path: ["bites", "create"],
    summary: "Create a soundbite from a transcript time range.",
    arguments: [TRANSCRIPT_ID],
    options: [
      integerOption("start-time", "SECONDS", "Start of the clip in whole seconds from the beginning.", { min: 0, required: true }),
      integerOption("end-time", "SECONDS", "End of the clip in whole seconds. Must be greater than --start-time.", { min: 0, required: true }),
      stringOption("name", "TEXT", "Soundbite name. Maximum 256 characters.", { check: lengthCheck("--name", 0, 256) }),
      enumOption("media-type", "TYPE", "Media type of the clip.", ["video", "audio"]),
      enumOption("privacy", "PRIVACY", "Who can see the clip.", ["public", "team", "participants"], { repeatable: true }),
      stringOption("summary", "TEXT", "Soundbite summary. Maximum 500 characters.", { check: lengthCheck("--summary", 0, 500) }),
    ],
    graphql: {
      kind: "mutation",
      name: "CreateBite",
      variables: "($transcriptId: ID!, $startTime: Float!, $endTime: Float!, $name: String, $mediaType: String, $privacies: [BitePrivacy!], $summary: String)",
      field: "createBite",
      arguments: "transcript_id: $transcriptId, start_time: $startTime, end_time: $endTime, name: $name, media_type: $mediaType, privacies: $privacies, summary: $summary",
      selection: "id transcript_id name status summary start_time end_time media_type privacies",
    },
    variables: (context) => {
      const { options } = context;
      const start = options.number("start-time") as number;
      const end = options.number("end-time") as number;
      if (end <= start) {
        throw invalidValue("--end-time", `be greater than --start-time (${start})`, String(end), "Use an --end-time after --start-time.", `>${start}`);
      }
      return {
        transcriptId: target(context),
        startTime: start,
        endTime: end,
        name: options.string("name"),
        mediaType: options.string("media-type"),
        privacies: options.strings("privacy"),
        summary: options.string("summary"),
      };
    },
    effect: "Creates a soundbite from transcript TRANSCRIPT_ID.",
    output: "Resource envelope. data is the new soundbite; meta is empty.",
    examples: ["fireflies bites create 01HXYZ --start-time 120 --end-time 180 --name 'Pricing decision' --yes"],
  },
  {
    path: ["channels", "list"],
    summary: "List channels.",
    graphql: { kind: "query", name: "Channels", variables: "", field: "channels", selection: channelFields },
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of channels; meta is empty.",
    examples: ["fireflies channels list", "fireflies channels list --format human"],
  },
  {
    path: ["channels", "get"],
    summary: "Get one channel.",
    arguments: [argument("CHANNEL_ID", "Channel ID.")],
    graphql: {
      kind: "query",
      name: "Channel",
      variables: "($channelId: ID!)",
      field: "channel",
      arguments: "id: $channelId",
      selection: channelFields,
    },
    variables: (context) => ({ channelId: target(context) }),
    output: "Resource envelope. data is the channel object with its members; meta is empty.",
    examples: ["fireflies channels get 01HXYZ"],
  },
  {
    path: ["contacts", "list"],
    summary: "List contacts.",
    graphql: { kind: "query", name: "Contacts", variables: "", field: "contacts", selection: "email name picture last_meeting_date" },
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of contacts; meta is empty.",
    examples: ["fireflies contacts list", "fireflies contacts list --format human"],
  },
  {
    path: ["meetings", "list"],
    summary: "List active or paused live meetings.",
    options: [
      stringOption("email", "EMAIL", "Only meetings for this email address.", { check: emailCheck("--email") }),
      enumOption("state", "STATE", "Only meetings in this state.", ["active", "paused"], { repeatable: true }),
    ],
    graphql: {
      kind: "query",
      name: "ActiveMeetings",
      variables: "($email: String, $states: [MeetingState!])",
      field: "active_meetings",
      arguments: "input: { email: $email, states: $states }",
      selection: "id title organizer_email meeting_link start_time end_time privacy state",
    },
    variables: (context) => ({
      email: context.options.string("email"),
      states: context.options.strings("state"),
    }),
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of live meetings; meta is empty.",
    examples: ["fireflies meetings list", "fireflies meetings list --state active --email ana@example.com"],
  },
  {
    path: ["meetings", "action-items", "list"],
    summary: "List action items of a live meeting.",
    arguments: [MEETING_ID],
    graphql: {
      kind: "query",
      name: "LiveActionItems",
      variables: "($meetingId: ID!)",
      field: "live_action_items",
      arguments: "meeting_id: $meetingId",
      selection: "name action_item",
    },
    variables: (context) => ({ meetingId: target(context) }),
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of action items; meta is empty.",
    examples: ["fireflies meetings action-items list 01HXYZ"],
  },
  {
    path: ["meetings", "action-items", "create"],
    summary: "Create an action item in a live meeting.",
    arguments: [MEETING_ID],
    options: [PROMPT_OPTION],
    graphql: {
      kind: "mutation",
      name: "CreateLiveActionItem",
      variables: "($input: CreateLiveActionItemInput!)",
      field: "createLiveActionItem",
      arguments: "input: $input",
      selection: "success",
    },
    variables: (context) => ({ input: { meeting_id: target(context), prompt: context.options.string("prompt") } }),
    effect: "Creates a live action item in meeting MEETING_ID.",
    output: "Resource envelope. data has success from Fireflies; meta is empty.",
    examples: ["fireflies meetings action-items create 01HXYZ --prompt 'Send the revised proposal' --yes"],
  },
  {
    path: ["meetings", "soundbites", "create"],
    summary: "Create a soundbite in a live meeting.",
    arguments: [MEETING_ID],
    options: [PROMPT_OPTION],
    graphql: {
      kind: "mutation",
      name: "CreateLiveSoundbite",
      variables: "($input: CreateLiveSoundbiteInput!)",
      field: "createLiveSoundbite",
      arguments: "input: $input",
      selection: "success",
    },
    variables: (context) => ({ input: { meeting_id: target(context), prompt: context.options.string("prompt") } }),
    effect: "Creates a live soundbite in meeting MEETING_ID.",
    output: "Resource envelope. data has success from Fireflies; meta is empty.",
    examples: ["fireflies meetings soundbites create 01HXYZ --prompt 'Capture the pricing discussion' --yes"],
  },
  {
    path: ["meetings", "bots", "create"],
    summary: "Add the Fireflies bot to an ongoing meeting.",
    arguments: [{ ...argument("MEETING_LINK", "Link of the ongoing meeting."), check: urlCheck("MEETING_LINK", ["https:", "http:"]) }],
    options: [
      stringOption("title", "TEXT", "Meeting title. Maximum 256 characters.", { check: lengthCheck("--title", 0, 256) }),
      { name: "meeting-password-file", placeholder: "PATH", type: "path", description: "Read the meeting password, at most 32 characters, from PATH. - reads stdin." },
      integerOption("duration", "MINUTES", "Minutes the bot stays in the meeting, from 15 to 120.", { min: 15, max: 120 }),
      stringOption("language", "LANGUAGE", "Language code of the meeting. Maximum 5 characters.", { check: lengthCheck("--language", 0, 5) }),
      attendeeOption(),
    ],
    graphql: {
      kind: "mutation",
      name: "AddToLiveMeeting",
      variables: "($meetingLink: String!, $title: String, $meetingPassword: String, $duration: Int, $language: String, $attendees: [Attendee])",
      field: "addToLiveMeeting",
      arguments: "meeting_link: $meetingLink, title: $title, meeting_password: $meetingPassword, duration: $duration, language: $language, attendees: $attendees",
      selection: "success",
    },
    variables: (context) => {
      const { options } = context;
      const passwordPath = options.string("meeting-password-file");
      const password = passwordPath === undefined ? undefined : readSecret(passwordPath, "--meeting-password-file");
      if (password !== undefined) checkMeetingPassword(password);
      return {
        meetingLink: target(context),
        title: options.string("title"),
        meetingPassword: password,
        duration: options.number("duration"),
        language: options.string("language"),
        attendees: attendees(context),
      };
    },
    effect: "Sends the Fireflies bot to the meeting at MEETING_LINK.",
    output: "Resource envelope. data has success from Fireflies; meta is empty.",
    examples: ["fireflies meetings bots create https://meet.google.com/abc-defg-hij --title 'Weekly sync' --dry-run"],
  },
  {
    path: ["meetings", "state", "update"],
    summary: "Pause or resume the recording of a live meeting.",
    arguments: [MEETING_ID],
    options: [enumOption("action", "ACTION", "Recording action.", ["pause_recording", "resume_recording"], { required: true })],
    graphql: {
      kind: "mutation",
      name: "UpdateMeetingState",
      variables: "($input: UpdateMeetingStateInput!)",
      field: "updateMeetingState",
      arguments: "input: $input",
      selection: "success action",
    },
    variables: (context) => ({ input: { meeting_id: target(context), action: context.options.string("action") } }),
    effect: "Pauses or resumes the recording of meeting MEETING_ID.",
    output: "Resource envelope. data has success and action from Fireflies; meta is empty.",
    examples: ["fireflies meetings state update 01HXYZ --action pause_recording --yes"],
  },
  {
    path: ["rules", "executions", "list"],
    summary: "List automation rule executions grouped by meeting.",
    options: [
      integerOption("logs-per-meeting", "N", "Executions returned per meeting, from 1 to 20. Default: 5.", { min: 1, max: 20 }),
      stringOption("rule-id", "ID", "Only executions of this rule."),
      stringOption("meeting-id", "ID", "Only executions for this meeting."),
      dateOption("from-date", "Only executions after", "undocumented"),
      dateOption("to-date", "Only executions before", "undocumented"),
      triStateOption("test", "Only test executions when true, only production executions when false. Omit to list both."),
    ],
    graphql: {
      kind: "query",
      name: "RuleExecutionsByMeeting",
      variables: "($limit: Int, $cursor: String, $logsPerMeeting: Int, $filters: RuleExecutionFiltersInput)",
      field: "rule_executions_by_meeting",
      arguments: "limit: $limit, cursor: $cursor, logs_per_meeting: $logsPerMeeting, filters: $filters",
      selection: `
        meetings {
          meeting_id
          meeting { id title organizer_email }
          executions {
            extension_id extension_title stopped_at user_name
            share { group_ids }
            channel { channel_id }
            meeting_privacy { privacy }
          }
        }
        has_more next_cursor
      `,
    },
    variables: (context) => ({
      logsPerMeeting: context.options.number("logs-per-meeting"),
      filters: {
        rule_id: context.options.string("rule-id"),
        meeting_id: context.options.string("meeting-id"),
        date_from: context.options.string("from-date"),
        date_to: context.options.string("to-date"),
        is_test: triState(context.options, "test"),
      },
    }),
    collectionKey: "meetings",
    pagination: { max: 50, default: 10, ordering: PROVIDER_ORDERING, style: tokenPagination },
    output: "Collection envelope. data is an array of meeting groups, each with at most --logs-per-meeting executions, so --all pages meeting groups and can omit executions. meta has next_cursor and has_more from Fireflies.",
    examples: ["fireflies rules executions list", "fireflies rules executions list --meeting-id 01HXYZ --from-date 2026-08-01"],
  },
  {
    path: ["transcripts", "list"],
    summary: "List and filter transcripts.",
    options: [
      stringOption("keyword", "TEXT", "Search titles, spoken words, or both, as set by --scope. Maximum 255 characters.", { check: lengthCheck("--keyword", 0, 255) }),
      enumOption("scope", "SCOPE", "Where --keyword searches.", ["title", "sentences", "all"], { default: "title", requires: ["keyword"] }),
      stringOption("title", "TEXT", "Only transcripts with this title. Fireflies deprecated it in favor of --keyword. Maximum 256 characters.", { conflicts: ["keyword"], check: lengthCheck("--title", 0, 256) }),
      dateOption("date", "Only transcripts created within", "undocumented"),
      dateOption("from-date", "Only transcripts created after", "undocumented"),
      dateOption("to-date", "Only transcripts created before", "undocumented"),
      stringOption("host-email", "EMAIL", "Only meetings hosted by this email address.", { check: emailCheck("--host-email") }),
      stringOption("user-id", "ID", "Only meetings where this user organized or took part.", { conflicts: ["mine"] }),
      booleanOption("mine", "Only meetings the API key owner organized."),
      stringOption("organizer", "EMAIL", "Only meetings organized by this email address.", { repeatable: true, check: emailCheck("--organizer") }),
      stringOption("participant", "EMAIL", "Only meetings with this participant email address.", { repeatable: true, check: emailCheck("--participant") }),
      stringOption("channel-id", "ID", "Only meetings in this channel. Maximum 256 characters.", { check: lengthCheck("--channel-id", 0, 256) }),
    ],
    graphql: {
      kind: "query",
      name: "Transcripts",
      variables: "($title: String, $date: Float, $keyword: String, $scope: TranscriptsQueryScope, $fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int, $hostEmail: String, $userId: String, $mine: Boolean, $organizers: [String], $participants: [String], $channelId: String)",
      field: "transcripts",
      arguments: "title: $title, date: $date, keyword: $keyword, scope: $scope, fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip, host_email: $hostEmail, user_id: $userId, mine: $mine, organizers: $organizers, participants: $participants, channel_id: $channelId",
      selection: transcriptListFields,
    },
    variables: (context) => {
      const { options } = context;
      const date = options.string("date");
      return {
        title: options.string("title"),
        date: date === undefined ? undefined : Date.parse(date),
        keyword: options.string("keyword"),
        scope: options.string("scope"),
        fromDate: options.string("from-date"),
        toDate: options.string("to-date"),
        hostEmail: options.string("host-email"),
        userId: options.string("user-id"),
        mine: options.flag("mine") ? true : undefined,
        organizers: options.strings("organizer"),
        participants: options.strings("participant"),
        channelId: options.string("channel-id"),
      };
    },
    collection: true,
    pagination: { max: 50, default: 50, ordering: PROVIDER_ORDERING },
    output: "Collection envelope. data is an array of transcripts. meta has next_cursor, a decimal offset, and has_more, which is true when a page is full, so the last page can be empty.",
    examples: [
      "fireflies transcripts list --mine --from-date 2026-08-01 --page-size 20",
      "fireflies transcripts list --keyword underwriting --scope all --participant buyer@example.com --all --max-items 100",
      "fireflies transcripts list --title 'Weekly sync' --date 2026-08-01",
    ],
  },
  {
    path: ["transcripts", "get"],
    summary: "Get one transcript with sentences, summary, and analytics.",
    arguments: [TRANSCRIPT_ID],
    graphql: {
      kind: "query",
      name: "Transcript",
      variables: "($transcriptId: String!)",
      field: "transcript",
      arguments: "id: $transcriptId",
      selection: transcriptFields,
    },
    variables: (context) => ({ transcriptId: target(context) }),
    output: "Resource envelope. data is the transcript object; meta is empty.",
    examples: ["fireflies transcripts get 01HXYZ", "fireflies transcripts get 01HXYZ --format human"],
  },
  {
    path: ["transcripts", "delete"],
    summary: "Delete a transcript.",
    arguments: [TRANSCRIPT_ID],
    graphql: {
      kind: "mutation",
      name: "DeleteTranscript",
      variables: "($transcriptId: String!)",
      field: "deleteTranscript",
      arguments: "id: $transcriptId",
      selection: "id title host_email organizer_email date transcript_url duration",
    },
    variables: (context) => ({ transcriptId: target(context) }),
    effect: "Permanently deletes transcript TRANSCRIPT_ID. Fireflies documents no way to restore the transcript.",
    output: "Resource envelope. data is the deleted transcript; meta is empty.",
    examples: ["fireflies transcripts delete 01HXYZ --dry-run", "fireflies transcripts delete 01HXYZ --yes"],
  },
  {
    path: ["transcripts", "title", "update"],
    summary: "Update the meeting title of a transcript.",
    arguments: [TRANSCRIPT_ID],
    options: [stringOption("title", "TEXT", "New title, from 5 to 256 characters.", { required: true, check: lengthCheck("--title", 5, 256) })],
    graphql: {
      kind: "mutation",
      name: "UpdateMeetingTitle",
      variables: "($input: UpdateMeetingTitleInput!)",
      field: "updateMeetingTitle",
      arguments: "input: $input",
      selection: "id title",
    },
    variables: (context) => ({ input: { id: target(context), title: context.options.string("title") } }),
    effect: "Changes the title of transcript TRANSCRIPT_ID.",
    output: "Resource envelope. data has id and title; meta is empty.",
    examples: ["fireflies transcripts title update 01HXYZ --title 'Q3 planning review' --yes"],
  },
  {
    path: ["transcripts", "privacy", "update"],
    summary: "Update the privacy of a transcript.",
    arguments: [TRANSCRIPT_ID],
    options: [
      enumOption("privacy", "PRIVACY", "New privacy level.", ["link", "owner", "participants", "teammatesandparticipants", "teammates"], { required: true }),
    ],
    graphql: {
      kind: "mutation",
      name: "UpdateMeetingPrivacy",
      variables: "($input: UpdateMeetingPrivacyInput!)",
      field: "updateMeetingPrivacy",
      arguments: "input: $input",
      selection: "id title privacy",
    },
    variables: (context) => ({ input: { id: target(context), privacy: context.options.string("privacy") } }),
    effect: "Changes the privacy of transcript TRANSCRIPT_ID.",
    output: "Resource envelope. data has id, title, and privacy; meta is empty.",
    examples: ["fireflies transcripts privacy update 01HXYZ --privacy owner --dry-run", "fireflies transcripts privacy update 01HXYZ --privacy owner --yes"],
  },
  {
    path: ["transcripts", "channel", "update"],
    summary: "Move a transcript to a channel.",
    arguments: [TRANSCRIPT_ID],
    options: [stringOption("channel-id", "ID", "Destination channel ID.", { required: true })],
    graphql: {
      kind: "mutation",
      name: "UpdateMeetingChannel",
      variables: "($input: UpdateMeetingChannelInput!)",
      field: "updateMeetingChannel",
      arguments: "input: $input",
      selection: "id title channels { id }",
    },
    variables: (context) => ({
      input: { transcript_ids: [target(context)], channel_id: context.options.string("channel-id") },
    }),
    effect: "Moves transcript TRANSCRIPT_ID to the channel.",
    output: "Resource envelope. data is the updated transcript with its channels; meta is empty.",
    examples: ["fireflies transcripts channel update 01HXYZ --channel-id 01ABCD --yes"],
  },
  {
    path: ["transcripts", "share"],
    summary: "Share a transcript by email.",
    arguments: [TRANSCRIPT_ID],
    options: [
      stringOption("email", "EMAIL", "Recipient email address. From 1 to 50 addresses.", { repeatable: true, required: true, check: emailCheck("--email") }),
      enumOption("expiry-days", "DAYS", "Days until the access expires.", ["7", "14", "30"]),
    ],
    graphql: {
      kind: "mutation",
      name: "ShareMeeting",
      variables: "($input: ShareMeetingInput!)",
      field: "shareMeeting",
      arguments: "input: $input",
      selection: "success message",
    },
    variables: (context) => {
      const emails = context.options.strings("email");
      if (emails.length > 50) {
        throw invalidValue("--email", "be repeated at most 50 times", String(emails.length), "Share with 50 addresses or fewer per command.", "1-50");
      }
      const expiry = context.options.string("expiry-days");
      return { input: { meeting_id: target(context), emails, expiry_days: expiry === undefined ? undefined : Number(expiry) } };
    },
    effect: "Gives the listed email addresses access to transcript TRANSCRIPT_ID.",
    output: "Resource envelope. data has success and message from Fireflies; meta is empty.",
    examples: ["fireflies transcripts share 01HXYZ --email ana@example.com --email ben@example.com --expiry-days 14 --yes"],
    exceptions: [{ rule: "CLI-GRAM-4", reason: "share preserves the Fireflies term shareMeeting." }],
  },
  {
    path: ["transcripts", "access", "revoke"],
    summary: "Revoke shared access to a transcript.",
    arguments: [TRANSCRIPT_ID],
    options: [stringOption("email", "EMAIL", "Email address that loses access.", { required: true, check: emailCheck("--email") })],
    graphql: {
      kind: "mutation",
      name: "RevokeSharedMeetingAccess",
      variables: "($input: RevokeSharedMeetingAccessInput!)",
      field: "revokeSharedMeetingAccess",
      arguments: "input: $input",
      selection: "success message",
    },
    variables: (context) => ({
      input: { meeting_id: target(context), email: context.options.string("email") },
    }),
    effect: "Removes the email address's shared access to transcript TRANSCRIPT_ID.",
    output: "Resource envelope. data has success and message from Fireflies; meta is empty.",
    examples: ["fireflies transcripts access revoke 01HXYZ --email ana@example.com --yes"],
    exceptions: [{ rule: "CLI-GRAM-4", reason: "revoke preserves the Fireflies term revokeSharedMeetingAccess." }],
  },
  {
    path: ["users", "list"],
    summary: "List team users.",
    graphql: { kind: "query", name: "Users", variables: "", field: "users", selection: userFields },
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of users; meta is empty.",
    examples: ["fireflies users list", "fireflies users list --format human"],
  },
  {
    path: ["users", "get"],
    summary: "Get one user.",
    arguments: [USER_ID],
    graphql: {
      kind: "query",
      name: "User",
      variables: "($userId: String!)",
      field: "user",
      arguments: "id: $userId",
      selection: userFields,
    },
    variables: (context) => ({ userId: target(context) }),
    output: "Resource envelope. data is the user object; meta is empty.",
    examples: ["fireflies users get 01HXYZ"],
  },
  {
    path: ["users", "current", "get"],
    summary: "Get the user that owns the API key.",
    graphql: { kind: "query", name: "CurrentUser", variables: "", field: "user", selection: userFields },
    output: "Resource envelope. data is the user object of the API key owner; meta is empty.",
    examples: ["fireflies users current get", "fireflies users current get --format human"],
  },
  {
    path: ["users", "groups", "list"],
    summary: "List user groups.",
    options: [booleanOption("mine", "Only groups the API key owner belongs to.")],
    graphql: {
      kind: "query",
      name: "UserGroups",
      variables: "($mine: Boolean)",
      field: "user_groups",
      arguments: "mine: $mine",
      selection: "id name handle members { user_id first_name last_name email }",
    },
    variables: (context) => ({ mine: context.options.flag("mine") ? true : undefined }),
    unpaginated: UNPAGINATED,
    output: "Collection envelope. data is an array of user groups; meta is empty.",
    examples: ["fireflies users groups list", "fireflies users groups list --mine"],
  },
  {
    path: ["users", "role", "update"],
    summary: "Update the role of a user.",
    arguments: [USER_ID],
    options: [enumOption("role", "ROLE", "New role.", ["admin", "user"], { required: true })],
    graphql: {
      kind: "mutation",
      name: "SetUserRole",
      variables: "($userId: String!, $role: Role!)",
      field: "setUserRole",
      arguments: "user_id: $userId, role: $role",
      selection: "id name email role",
    },
    variables: (context) => ({ userId: target(context), role: context.options.string("role") }),
    effect: "Changes the role of user USER_ID.",
    output: "Resource envelope. data is the updated user; meta is empty.",
    examples: ["fireflies users role update 01HXYZ --role admin --dry-run", "fireflies users role update 01HXYZ --role user --yes"],
  },
];

export const commands: ResourceCommand[] = definitions.map(toCommand);
