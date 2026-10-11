import type { Operation, OperationMatch, ValueKind } from "./types";
import { CliError } from "./errors";

const docsRoot = "https://docs.fireflies.ai";

const userFields = `
  user_id
  email
  name
  is_admin
  num_transcripts
  recent_transcript
  recent_meeting
  minutes_consumed
  integrations
  is_calendar_in_sync
  user_groups {
    id
    name
    handle
  }
`;

const channelFields = `
  id
  title
  is_private
  created_by
  created_at
  updated_at
  members {
    user_id
    email
    name
  }
`;

const transcriptListFields = `
  id
  title
  date
  dateString
  duration
  host_email
  organizer_email
  participants
  transcript_url
  privacy
  meeting_link
  is_live
  channels { id }
  summary {
    gist
    short_summary
    action_items
    keywords
    topics_discussed
  }
`;

const transcriptFields = `
  ${transcriptListFields}
  speakers { id name }
  sentences {
    index
    speaker_name
    speaker_id
    text
    raw_text
    start_time
    end_time
    ai_filters {
      task
      pricing
      metric
      question
      date_and_time
      text_cleanup
      sentiment
    }
  }
  analytics {
    sentiments { negative_pct neutral_pct positive_pct }
    categories { questions date_times metrics tasks }
    speakers {
      speaker_id
      name
      duration
      word_count
      longest_monologue
      monologues_count
      filler_words
      questions
      duration_pct
      words_per_minute
    }
  }
  meeting_attendees { displayName email phoneNumber name location }
  meeting_attendance { name join_time leave_time }
  meeting_info { fred_joined silent_meeting summary_status }
  summary {
    keywords
    action_items
    outline
    shorthand_bullet
    overview
    bullet_gist
    gist
    short_summary
    short_overview
    meeting_type
    topics_discussed
    transcript_chapters
  }
`;

const biteFields = `
  id
  transcript_id
  name
  status
  summary
  summary_status
  user_id
  start_time
  end_time
  media_type
  thumbnail
  preview
  created_at
  privacies
  captions { index speaker_id speaker_name text start_time end_time }
  sources { src type }
`;

const askFredThreadFields = `
  id
  title
  transcript_id
  user_id
  created_at
`;

const askFredMessageFields = `
  message {
    id
    thread_id
    query
    answer
    suggested_queries
    status
    error
    created_at
    updated_at
  }
`;

export const operations: readonly Operation[] = [
  {
    name: "meetings list",
    pattern: ["meetings", "list"],
    kind: "query",
    operationName: "ActiveMeetings",
    variableDefinitions: "($email: String, $states: [MeetingState!])",
    invocation: "active_meetings(input: { email: $email, states: $states })",
    selection: "id title organizer_email meeting_link start_time end_time privacy state",
    bindings: [
      { flag: "email", path: "email", kind: "string" },
      { flag: "states", path: "states", kind: "csv", choices: ["active", "paused"] },
    ],
    description: "List active or paused meetings.",
    docs: `${docsRoot}/graphql-api/query/active-meetings`,
  },
  {
    name: "analytics get",
    pattern: ["analytics", "get"],
    kind: "query",
    operationName: "Analytics",
    variableDefinitions: "($startTime: String, $endTime: String)",
    invocation: "analytics(start_time: $startTime, end_time: $endTime)",
    selection: `
      team {
        conversation {
          average_filler_words
          average_monologues_count
          average_questions
          average_sentiments { negative_pct neutral_pct positive_pct }
          average_silence_duration
          average_talk_listen_ratio
          average_words_per_minute
          total_meeting_notes_count
          total_meetings_count
          teammates_count
        }
        meeting { count duration average_count average_duration }
      }
      users {
        user_id
        user_name
        user_email
        conversation {
          talk_listen_pct
          total_silence_duration
          total_speak_duration
          total_word_count
          user_filler_words
          user_longest_monologue_sec
          user_questions
          user_words_per_minute
        }
        meeting { count duration }
      }
    `,
    bindings: [
      { flag: "start-time", path: "startTime", kind: "string" },
      { flag: "end-time", path: "endTime", kind: "string" },
    ],
    description: "Get team and user conversation analytics.",
    docs: `${docsRoot}/graphql-api/query/analytics`,
  },
  {
    name: "apps list",
    pattern: ["apps", "list"],
    kind: "query",
    operationName: "AIAppOutputs",
    variableDefinitions: "($appId: String, $transcriptId: String, $skip: Float, $limit: Float)",
    invocation: "apps(app_id: $appId, transcript_id: $transcriptId, skip: $skip, limit: $limit)",
    selection: "outputs { transcript_id user_id app_id created_at title prompt response }",
    bindings: [
      { flag: "app-id", path: "appId", kind: "string" },
      { flag: "transcript-id", path: "transcriptId", kind: "string" },
      { flag: "cursor", path: "skip", kind: "integer", minimum: 0 },
      { flag: "page-size", path: "limit", kind: "number", minimum: 1, maximum: 10 },
    ],
    description: "List AI App outputs.",
    docs: `${docsRoot}/graphql-api/query/apps`,
  },
  {
    name: "askfred threads list",
    pattern: ["askfred", "threads", "list"],
    kind: "query",
    operationName: "AskFredThreads",
    variableDefinitions: "($transcriptId: String)",
    invocation: "askfred_threads(transcript_id: $transcriptId)",
    selection: askFredThreadFields,
    bindings: [{ flag: "transcript-id", path: "transcriptId", kind: "string" }],
    description: "List AskFred threads.",
    docs: `${docsRoot}/graphql-api/query/askfred-threads`,
  },
  {
    name: "askfred threads get",
    pattern: ["askfred", "threads", "get", ":threadId"],
    kind: "query",
    operationName: "AskFredThread",
    variableDefinitions: "($threadId: String!)",
    invocation: "askfred_thread(id: $threadId)",
    selection: `${askFredThreadFields} messages { id thread_id query answer suggested_queries status error created_at updated_at }`,
    bindings: [{ parameter: "threadId", path: "threadId", kind: "string", required: true }],
    description: "Get one AskFred thread and its messages.",
    docs: `${docsRoot}/graphql-api/query/askfred-thread`,
  },
  {
    name: "askfred threads create",
    pattern: ["askfred", "threads", "create"],
    kind: "mutation",
    operationName: "CreateAskFredThread",
    variableDefinitions: "($input: CreateAskFredThreadInput!)",
    invocation: "createAskFredThread(input: $input)",
    selection: askFredMessageFields,
    bindings: [
      { flag: "query", path: "input.query", kind: "string", required: true, maxLength: 2000 },
      { flag: "transcript-id", path: "input.transcript_id", kind: "string" },
      { flag: "start-time", path: "input.filters.start_time", kind: "string" },
      { flag: "end-time", path: "input.filters.end_time", kind: "string" },
      { flag: "channel-ids", path: "input.filters.channel_ids", kind: "csv" },
      { flag: "organizers", path: "input.filters.organizers", kind: "csv" },
      { flag: "participants", path: "input.filters.participants", kind: "csv" },
      { flag: "transcript-ids", path: "input.filters.transcript_ids", kind: "csv" },
      { flag: "response-language", path: "input.response_language", kind: "string" },
      { flag: "response-format", path: "input.format_mode", kind: "string", choices: ["markdown", "plaintext"] },
    ],
    validate: (variables) => {
      const input = variables.input;
      if (typeof input !== "object" || input === null || Array.isArray(input)) return;
      const record = input as Record<string, unknown>;
      const filters = record.filters;
      if (record.transcript_id !== undefined && typeof filters === "object" && filters !== null) {
        throw new CliError("--transcript-id cannot be combined with meeting filter options");
      }
    },
    description: "Create an AskFred thread.",
    docs: `${docsRoot}/graphql-api/mutation/create-askfred-thread`,
  },
  {
    name: "askfred threads update",
    pattern: ["askfred", "threads", "update", ":threadId"],
    kind: "mutation",
    operationName: "ContinueAskFredThread",
    variableDefinitions: "($input: ContinueAskFredThreadInput!)",
    invocation: "continueAskFredThread(input: $input)",
    selection: askFredMessageFields,
    bindings: [
      { parameter: "threadId", path: "input.thread_id", kind: "string", required: true },
      { flag: "query", path: "input.query", kind: "string", required: true, maxLength: 2000 },
      { flag: "response-language", path: "input.response_language", kind: "string" },
      { flag: "response-format", path: "input.format_mode", kind: "string", choices: ["markdown", "plaintext"] },
    ],
    description: "Continue an AskFred thread.",
    docs: `${docsRoot}/graphql-api/mutation/continue-askfred-thread`,
  },
  {
    name: "askfred threads delete",
    pattern: ["askfred", "threads", "delete", ":threadId"],
    kind: "mutation",
    operationName: "DeleteAskFredThread",
    variableDefinitions: "($threadId: String!)",
    invocation: "deleteAskFredThread(id: $threadId)",
    selection: askFredThreadFields,
    bindings: [{ parameter: "threadId", path: "threadId", kind: "string", required: true }],
    description: "Delete an AskFred thread.",
    docs: `${docsRoot}/graphql-api/mutation/delete-askfred-thread`,
  },
  {
    name: "channels list",
    pattern: ["channels", "list"],
    kind: "query",
    operationName: "Channels",
    variableDefinitions: "",
    invocation: "channels",
    selection: channelFields,
    bindings: [],
    description: "List channels.",
    docs: `${docsRoot}/graphql-api/query/channels`,
  },
  {
    name: "channels get",
    pattern: ["channels", "get", ":channelId"],
    kind: "query",
    operationName: "Channel",
    variableDefinitions: "($channelId: ID!)",
    invocation: "channel(id: $channelId)",
    selection: channelFields,
    bindings: [{ parameter: "channelId", path: "channelId", kind: "string", required: true }],
    description: "Get one channel.",
    docs: `${docsRoot}/graphql-api/query/channel`,
  },
  {
    name: "users list",
    pattern: ["users", "list"],
    kind: "query",
    operationName: "Users",
    variableDefinitions: "",
    invocation: "users",
    selection: userFields,
    bindings: [],
    description: "List team users.",
    docs: `${docsRoot}/graphql-api/query/users`,
  },
  {
    name: "users get",
    pattern: ["users", "get", ":userId?"],
    kind: "query",
    operationName: "User",
    variableDefinitions: "($userId: String)",
    invocation: "user(id: $userId)",
    selection: userFields,
    bindings: [{ parameter: "userId", path: "userId", kind: "string" }],
    description: "Get one user or the API-key owner.",
    docs: `${docsRoot}/graphql-api/query/user`,
  },
  {
    name: "users groups list",
    pattern: ["users", "groups", "list"],
    kind: "query",
    operationName: "UserGroups",
    variableDefinitions: "($mine: Boolean)",
    invocation: "user_groups(mine: $mine)",
    selection: "id name handle members { user_id first_name last_name email }",
    bindings: [{ flag: "mine", path: "mine", kind: "boolean" }],
    description: "List user groups.",
    docs: `${docsRoot}/graphql-api/query/user-groups`,
  },
  {
    name: "users role update",
    pattern: ["users", "role", "update", ":userId"],
    kind: "mutation",
    operationName: "SetUserRole",
    variableDefinitions: "($userId: String!, $role: Role!)",
    invocation: "setUserRole(user_id: $userId, role: $role)",
    selection: "id name email role",
    bindings: [
      { parameter: "userId", path: "userId", kind: "string", required: true },
      { flag: "role", path: "role", kind: "string", required: true, choices: ["admin", "user"] },
    ],
    description: "Set a user's role.",
    docs: `${docsRoot}/graphql-api/mutation/set-user-role`,
  },
  {
    name: "transcripts list",
    pattern: ["transcripts", "list"],
    kind: "query",
    operationName: "Transcripts",
    variableDefinitions: "($title: String, $date: Float, $organizerEmail: String, $participantEmail: String, $keyword: String, $scope: TranscriptsQueryScope, $fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int, $hostEmail: String, $userId: String, $mine: Boolean, $organizers: [String], $participants: [String], $channelId: String)",
    invocation: "transcripts(title: $title, date: $date, organizer_email: $organizerEmail, participant_email: $participantEmail, keyword: $keyword, scope: $scope, fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip, host_email: $hostEmail, user_id: $userId, mine: $mine, organizers: $organizers, participants: $participants, channel_id: $channelId)",
    selection: transcriptListFields,
    bindings: [
      { flag: "title", path: "title", kind: "string", maxLength: 256 },
      { flag: "date", path: "date", kind: "number" },
      { flag: "organizer-email", path: "organizerEmail", kind: "string" },
      { flag: "participant-email", path: "participantEmail", kind: "string" },
      { flag: "keyword", path: "keyword", kind: "string", maxLength: 255 },
      { flag: "scope", path: "scope", kind: "string", choices: ["title", "sentences", "all"] },
      { flag: "from-date", path: "fromDate", kind: "string" },
      { flag: "to-date", path: "toDate", kind: "string" },
      { flag: "page-size", path: "limit", kind: "integer", minimum: 1, maximum: 50 },
      { flag: "cursor", path: "skip", kind: "integer", minimum: 0 },
      { flag: "host-email", path: "hostEmail", kind: "string" },
      { flag: "user-id", path: "userId", kind: "string" },
      { flag: "mine", path: "mine", kind: "boolean" },
      { flag: "organizers", path: "organizers", kind: "csv" },
      { flag: "participants", path: "participants", kind: "csv" },
      { flag: "channel-id", path: "channelId", kind: "string" },
    ],
    validate: (variables) => {
      if (variables.scope !== undefined && variables.keyword === undefined) {
        throw new CliError("--scope requires --keyword");
      }
      if (variables.title !== undefined && variables.keyword !== undefined) {
        throw new CliError("--title cannot be combined with --keyword");
      }
      const identityFilters = [
        ["--organizer-email", variables.organizerEmail],
        ["--participant-email", variables.participantEmail],
        ["--user-id", variables.userId],
        ["--mine", variables.mine],
      ].filter(([, value]) => value !== undefined);
      if (identityFilters.length > 1) {
        throw new CliError(`${identityFilters.map(([flag]) => flag).join(", ")} cannot be combined; provide only one identity filter`);
      }
      const usesLegacyEmail = variables.organizerEmail !== undefined || variables.participantEmail !== undefined;
      const usesEmailLists = variables.organizers !== undefined || variables.participants !== undefined;
      if (usesLegacyEmail && usesEmailLists) {
        throw new CliError("--organizers and --participants cannot be combined with --organizer-email or --participant-email");
      }
    },
    description: "List and filter transcripts.",
    docs: `${docsRoot}/graphql-api/query/transcripts`,
  },
  {
    name: "transcripts get",
    pattern: ["transcripts", "get", ":transcriptId"],
    kind: "query",
    operationName: "Transcript",
    variableDefinitions: "($transcriptId: String!)",
    invocation: "transcript(id: $transcriptId)",
    selection: transcriptFields,
    bindings: [{ parameter: "transcriptId", path: "transcriptId", kind: "string", required: true }],
    description: "Get transcript details, sentences, summary, and analytics.",
    docs: `${docsRoot}/graphql-api/query/transcript`,
  },
  {
    name: "transcripts delete",
    pattern: ["transcripts", "delete", ":transcriptId"],
    kind: "mutation",
    operationName: "DeleteTranscript",
    variableDefinitions: "($transcriptId: String!)",
    invocation: "deleteTranscript(id: $transcriptId)",
    selection: "id title host_email organizer_email date transcript_url duration",
    bindings: [{ parameter: "transcriptId", path: "transcriptId", kind: "string", required: true }],
    description: "Delete a transcript.",
    docs: `${docsRoot}/graphql-api/mutation/delete-transcript`,
  },
  {
    name: "transcripts title update",
    pattern: ["transcripts", "title", "update", ":transcriptId"],
    kind: "mutation",
    operationName: "UpdateMeetingTitle",
    variableDefinitions: "($input: UpdateMeetingTitleInput!)",
    invocation: "updateMeetingTitle(input: $input)",
    selection: "id title",
    bindings: [
      { parameter: "transcriptId", path: "input.id", kind: "string", required: true },
      { flag: "title", path: "input.title", kind: "string", required: true, minLength: 5, maxLength: 256 },
    ],
    description: "Update a transcript's meeting title.",
    docs: `${docsRoot}/graphql-api/mutation/update-meeting-title`,
  },
  {
    name: "transcripts privacy update",
    pattern: ["transcripts", "privacy", "update", ":transcriptId"],
    kind: "mutation",
    operationName: "UpdateMeetingPrivacy",
    variableDefinitions: "($input: UpdateMeetingPrivacyInput!)",
    invocation: "updateMeetingPrivacy(input: $input)",
    selection: "id title privacy",
    bindings: [
      { parameter: "transcriptId", path: "input.id", kind: "string", required: true },
      { flag: "privacy", path: "input.privacy", kind: "string", required: true, choices: ["link", "owner", "participants", "teammatesandparticipants", "teammates"] },
    ],
    description: "Update a transcript's privacy.",
    docs: `${docsRoot}/graphql-api/mutation/update-meeting-privacy`,
  },
  {
    name: "transcripts channel update",
    pattern: ["transcripts", "channel", "update", ":transcriptId"],
    kind: "mutation",
    operationName: "UpdateMeetingChannel",
    variableDefinitions: "($input: UpdateMeetingChannelInput!)",
    invocation: "updateMeetingChannel(input: $input)",
    selection: "id title channels { id }",
    bindings: [
      { parameter: "transcriptId", path: "input.transcript_ids", kind: "single-list", required: true },
      { flag: "channel-id", path: "input.channel_id", kind: "string", required: true },
    ],
    description: "Assign one transcript to a channel.",
    docs: `${docsRoot}/graphql-api/mutation/update-meeting-channel`,
  },
  {
    name: "transcripts share",
    pattern: ["transcripts", "share", ":transcriptId"],
    kind: "mutation",
    operationName: "ShareMeeting",
    variableDefinitions: "($input: ShareMeetingInput!)",
    invocation: "shareMeeting(input: $input)",
    selection: "success message",
    bindings: [
      { parameter: "transcriptId", path: "input.meeting_id", kind: "string", required: true },
      { flag: "emails", path: "input.emails", kind: "csv", required: true, minItems: 1, maxItems: 50 },
      { flag: "expiry-days", path: "input.expiry_days", kind: "integer", choices: [7, 14, 30] },
    ],
    description: "Share a transcript by email.",
    docs: `${docsRoot}/graphql-api/mutation/share-meeting`,
  },
  {
    name: "transcripts revoke-access",
    pattern: ["transcripts", "revoke-access", ":transcriptId"],
    kind: "mutation",
    operationName: "RevokeSharedMeetingAccess",
    variableDefinitions: "($input: RevokeSharedMeetingAccessInput!)",
    invocation: "revokeSharedMeetingAccess(input: $input)",
    selection: "success message",
    bindings: [
      { parameter: "transcriptId", path: "input.meeting_id", kind: "string", required: true },
      { flag: "email", path: "input.email", kind: "string", required: true },
    ],
    description: "Revoke one email address's shared transcript access.",
    docs: `${docsRoot}/graphql-api/mutation/revoke-shared-meeting-access`,
  },
  {
    name: "bites list",
    pattern: ["bites", "list"],
    kind: "query",
    operationName: "Bites",
    variableDefinitions: "($mine: Boolean!, $transcriptId: ID, $myTeam: Boolean, $limit: Int, $skip: Int)",
    invocation: "bites(mine: $mine, transcript_id: $transcriptId, my_team: $myTeam, limit: $limit, skip: $skip)",
    selection: biteFields,
    bindings: [
      { flag: "mine", path: "mine", kind: "boolean", required: true },
      { flag: "transcript-id", path: "transcriptId", kind: "string" },
      { flag: "my-team", path: "myTeam", kind: "boolean" },
      { flag: "page-size", path: "limit", kind: "integer", minimum: 1, maximum: 50 },
      { flag: "cursor", path: "skip", kind: "integer", minimum: 0 },
    ],
    description: "List soundbites.",
    docs: `${docsRoot}/graphql-api/query/bites`,
  },
  {
    name: "bites get",
    pattern: ["bites", "get", ":biteId"],
    kind: "query",
    operationName: "Bite",
    variableDefinitions: "($biteId: ID!)",
    invocation: "bite(id: $biteId)",
    selection: biteFields,
    bindings: [{ parameter: "biteId", path: "biteId", kind: "string", required: true }],
    description: "Get one soundbite.",
    docs: `${docsRoot}/graphql-api/query/bite`,
  },
  {
    name: "bites create",
    pattern: ["bites", "create", ":transcriptId"],
    kind: "mutation",
    operationName: "CreateBite",
    variableDefinitions: "($transcriptId: ID!, $startTime: Float!, $endTime: Float!, $name: String, $mediaType: String, $privacies: [String], $summary: String)",
    invocation: "createBite(transcript_id: $transcriptId, start_time: $startTime, end_time: $endTime, name: $name, media_type: $mediaType, privacies: $privacies, summary: $summary)",
    selection: "id transcript_id name status summary start_time end_time media_type privacies",
    bindings: [
      { parameter: "transcriptId", path: "transcriptId", kind: "string", required: true },
      { flag: "start-time", path: "startTime", kind: "number", required: true, minimum: 0 },
      { flag: "end-time", path: "endTime", kind: "number", required: true, minimum: 0 },
      { flag: "name", path: "name", kind: "string", maxLength: 256 },
      { flag: "media-type", path: "mediaType", kind: "string", choices: ["video", "audio"] },
      { flag: "privacies", path: "privacies", kind: "csv", choices: ["public", "team", "participants"] },
      { flag: "summary", path: "summary", kind: "string", maxLength: 500 },
    ],
    validate: (variables) => {
      const start = variables.startTime;
      const end = variables.endTime;
      if (typeof start === "number" && typeof end === "number" && end <= start) {
        throw new CliError("--end-time must be greater than --start-time");
      }
    },
    description: "Create a soundbite from a transcript time range.",
    docs: `${docsRoot}/graphql-api/mutation/create-bite`,
  },
  {
    name: "contacts list",
    pattern: ["contacts", "list"],
    kind: "query",
    operationName: "Contacts",
    variableDefinitions: "",
    invocation: "contacts",
    selection: "email name picture last_meeting_date",
    bindings: [],
    description: "List contacts.",
    docs: `${docsRoot}/graphql-api/query/contacts`,
  },
  {
    name: "meetings action-items list",
    pattern: ["meetings", "action-items", "list", ":meetingId"],
    kind: "query",
    operationName: "LiveActionItems",
    variableDefinitions: "($meetingId: ID!)",
    invocation: "live_action_items(meeting_id: $meetingId)",
    selection: "name action_item",
    bindings: [{ parameter: "meetingId", path: "meetingId", kind: "string", required: true }],
    description: "List action items for a live meeting.",
    docs: `${docsRoot}/graphql-api/query/live_action_items`,
  },
  {
    name: "meetings action-items create",
    pattern: ["meetings", "action-items", "create", ":meetingId"],
    kind: "mutation",
    operationName: "CreateLiveActionItem",
    variableDefinitions: "($input: CreateLiveActionItemInput!)",
    invocation: "createLiveActionItem(input: $input)",
    selection: "success",
    bindings: [
      { parameter: "meetingId", path: "input.meeting_id", kind: "string", required: true },
      { flag: "prompt", path: "input.prompt", kind: "string", required: true, minLength: 5, maxLength: 255 },
    ],
    description: "Create an action item during a live meeting.",
    docs: `${docsRoot}/graphql-api/mutation/create-live-action-item`,
  },
  {
    name: "meetings soundbites create",
    pattern: ["meetings", "soundbites", "create", ":meetingId"],
    kind: "mutation",
    operationName: "CreateLiveSoundbite",
    variableDefinitions: "($input: CreateLiveSoundbiteInput!)",
    invocation: "createLiveSoundbite(input: $input)",
    selection: "success",
    bindings: [
      { parameter: "meetingId", path: "input.meeting_id", kind: "string", required: true },
      { flag: "prompt", path: "input.prompt", kind: "string", required: true, minLength: 5, maxLength: 255 },
    ],
    description: "Create a soundbite during a live meeting.",
    docs: `${docsRoot}/graphql-api/mutation/create-live-soundbite`,
  },
  {
    name: "meetings bots create",
    pattern: ["meetings", "bots", "create", ":meetingLink"],
    kind: "mutation",
    operationName: "AddToLiveMeeting",
    variableDefinitions: "($meetingLink: String!, $title: String, $meetingPassword: String, $duration: Int, $language: String, $attendees: [Attendee])",
    invocation: "addToLiveMeeting(meeting_link: $meetingLink, title: $title, meeting_password: $meetingPassword, duration: $duration, language: $language, attendees: $attendees)",
    selection: "success",
    bindings: [
      { parameter: "meetingLink", path: "meetingLink", kind: "string", required: true },
      { flag: "title", path: "title", kind: "string", maxLength: 256 },
      { flag: "meeting-password", path: "meetingPassword", kind: "string", maxLength: 32 },
      { flag: "duration", path: "duration", kind: "integer", minimum: 15, maximum: 120 },
      { flag: "language", path: "language", kind: "string", maxLength: 5 },
      { flag: "attendees", path: "attendees", kind: "json", jsonShape: "array" },
    ],
    description: "Add the Fireflies bot to an ongoing meeting.",
    docs: `${docsRoot}/graphql-api/mutation/add-to-live`,
  },
  {
    name: "meetings state update",
    pattern: ["meetings", "state", "update", ":meetingId"],
    kind: "mutation",
    operationName: "UpdateMeetingState",
    variableDefinitions: "($input: UpdateMeetingStateInput!)",
    invocation: "updateMeetingState(input: $input)",
    selection: "success action",
    bindings: [
      { parameter: "meetingId", path: "input.meeting_id", kind: "string", required: true },
      { flag: "action", path: "input.action", kind: "string", required: true, choices: ["pause_recording", "resume_recording"] },
    ],
    description: "Pause or resume a live meeting recording.",
    docs: `${docsRoot}/graphql-api/mutation/update-meeting-state`,
  },
  {
    name: "audio-files upload",
    pattern: ["audio-files", "upload", ":url"],
    kind: "mutation",
    operationName: "UploadAudio",
    variableDefinitions: "($input: AudioUploadInput!)",
    invocation: "uploadAudio(input: $input)",
    selection: "success title message",
    bindings: [
      { parameter: "url", path: "input.url", kind: "string", required: true },
      { flag: "title", path: "input.title", kind: "string", maxLength: 256 },
      { flag: "webhook", path: "input.webhook", kind: "string" },
      { flag: "language", path: "input.custom_language", kind: "string" },
      { flag: "save-video", path: "input.save_video", kind: "boolean" },
      { flag: "attendees", path: "input.attendees", kind: "json", jsonShape: "array" },
      { flag: "client-reference-id", path: "input.client_reference_id", kind: "string", maxLength: 128 },
      { flag: "bypass-size-check", path: "input.bypass_size_check", kind: "boolean" },
      { flag: "download-auth", path: "input.download_auth", kind: "json", jsonShape: "object" },
    ],
    validate: (variables) => {
      const input = variables.input;
      const url = typeof input === "object" && input !== null && !Array.isArray(input)
        ? (input as Record<string, unknown>).url
        : undefined;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new CliError("Audio URL must use HTTPS and be directly downloadable by Fireflies");
      }
    },
    description: "Queue a public or authenticated media URL for transcription.",
    docs: `${docsRoot}/graphql-api/mutation/upload-audio`,
  },
  {
    name: "rules executions list",
    pattern: ["rules", "executions", "list"],
    kind: "query",
    operationName: "RuleExecutionsByMeeting",
    variableDefinitions: "($limit: Int, $cursor: String, $logsPerMeeting: Int, $filters: RuleExecutionFiltersInput)",
    invocation: "rule_executions_by_meeting(limit: $limit, cursor: $cursor, logs_per_meeting: $logsPerMeeting, filters: $filters)",
    selection: `
      meetings {
        meeting_id
        meeting { id title organizer_email }
        executions {
          extension_id
          extension_title
          stopped_at
          user_name
          share { group_ids }
          channel { channel_id }
          meeting_privacy { privacy }
        }
      }
      has_more
      next_cursor
    `,
    bindings: [
      { flag: "page-size", path: "limit", kind: "integer", minimum: 1, maximum: 50 },
      { flag: "cursor", path: "cursor", kind: "string" },
      { flag: "logs-per-meeting", path: "logsPerMeeting", kind: "integer", minimum: 1, maximum: 20 },
      { flag: "rule-id", path: "filters.rule_id", kind: "string" },
      { flag: "meeting-id", path: "filters.meeting_id", kind: "string" },
      { flag: "from-date", path: "filters.date_from", kind: "string" },
      { flag: "to-date", path: "filters.date_to", kind: "string" },
      { flag: "is-test", path: "filters.is_test", kind: "boolean" },
    ],
    description: "List automation rule executions grouped by meeting.",
    docs: `${docsRoot}/graphql-api/query/rule-executions-by-meeting`,
  },
  {
    name: "audit-events list",
    pattern: ["audit-events", "list"],
    kind: "query",
    operationName: "AuditEvents",
    variableDefinitions: "($limit: Int, $cursor: String, $filters: AuditEventFiltersInput!)",
    invocation: "auditEvents(limit: $limit, cursor: $cursor, filters: $filters)",
    selection: `
      events {
        id
        time
        category
        action
        severity
        status
        message
        class_uid
        activity_id
        type_uid
        actor { user_id email full_name ip_address }
        resource { type id }
        metadata
      }
      has_more
      next_cursor
    `,
    bindings: [
      { flag: "page-size", path: "limit", kind: "integer", minimum: 1, maximum: 50 },
      { flag: "cursor", path: "cursor", kind: "string" },
      { flag: "category", path: "filters.category", kind: "string", required: true, choices: ["MEETING_OPERATIONS", "TEAM_OPERATIONS", "USER_OPERATIONS", "AUTHENTICATION"] },
      { flag: "action", path: "filters.action", kind: "string" },
      { flag: "from-date", path: "filters.date_from", kind: "string" },
      { flag: "to-date", path: "filters.date_to", kind: "string" },
      { flag: "actor-user-id", path: "filters.actor_user_id", kind: "string" },
      { flag: "actor-email", path: "filters.actor_email", kind: "string" },
    ],
    description: "List Open Cybersecurity Schema Framework audit events.",
    docs: `${docsRoot}/graphql-api/query/audit-events`,
  },
];

export function findOperation(command: readonly string[]): OperationMatch | undefined {
  for (const operation of operations) {
    const requiredLength = operation.pattern.filter((part) => !part.endsWith("?")).length;
    if (command.length < requiredLength || command.length > operation.pattern.length) continue;
    const parameters: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < operation.pattern.length; index += 1) {
      const patternPart = operation.pattern[index];
      const commandPart = command[index];
      if (!patternPart) continue;
      if (patternPart.startsWith(":")) {
        const optional = patternPart.endsWith("?");
        const name = patternPart.slice(1, optional ? -1 : undefined);
        if (commandPart !== undefined) parameters[name] = commandPart;
        else if (!optional) matches = false;
      } else if (patternPart !== commandPart) {
        matches = false;
      }
    }
    if (matches) return { operation, parameters };
  }
  return undefined;
}

export function commandUsage(operation: Operation): string {
  return operation.pattern
    .map((part) => part.startsWith(":")
      ? part.endsWith("?") ? `[${part.slice(1, -1)}]` : `<${part.slice(1)}>`
      : part)
    .join(" ");
}

export interface OperationSpecification {
  readonly command: string;
  readonly summary: string;
  readonly arguments: readonly { name: string; required: boolean; type: "string" }[];
  readonly options: readonly { name: string; type: ValueKind; required: boolean }[];
  readonly validation: readonly string[];
  readonly authentication: { profile: "profile-or-environment"; permissions: readonly string[] };
  readonly effects: { kind: "read" | "remote-mutation"; confirmation: boolean; dryRun: boolean; atomic: boolean };
  readonly output: { schema: "data-meta-envelope"; human: string };
  readonly pagination: "not-applicable" | "provider-page";
  readonly failures: readonly string[];
  readonly retry: { automatic: boolean; reason: string };
  readonly examples: readonly string[];
  readonly compatibility: { "deprecated-aliases": readonly string[] };
  readonly exceptions: readonly string[];
}

export function operationSpecification(operation: Operation): OperationSpecification {
  return {
    command: `fireflies ${commandUsage(operation)}`,
    summary: operation.description,
    arguments: operation.pattern
      .filter((part) => part.startsWith(":"))
      .map((part) => ({ name: part.replace(/^:/, "").replace(/\?$/, ""), required: !part.endsWith("?"), type: "string" as const })),
    options: operation.bindings
      .filter((binding) => binding.flag)
      .map((binding) => ({ name: binding.flag as string, type: binding.kind, required: binding.required === true })),
    validation: ["Reject unknown, duplicate, invalid, extra, and conflicting input before the request."],
    authentication: { profile: "profile-or-environment", permissions: [operation.kind === "mutation" ? "provider-write" : "provider-read"] },
    effects: {
      kind: operation.kind === "mutation" ? "remote-mutation" : "read",
      confirmation: operation.kind === "mutation",
      dryRun: operation.kind === "mutation",
      atomic: operation.kind !== "mutation",
    },
    output: { schema: "data-meta-envelope", human: "Table for collections; labeled fields for one resource." },
    pagination: operation.bindings.some((binding) => binding.path === "limit") ? "provider-page" : "not-applicable",
    failures: ["INVALID_ARGUMENT", "AUTHENTICATION_FAILED", "PERMISSION_DENIED", "NOT_FOUND", "CONFLICT", "TRANSIENT_FAILURE"],
    retry: {
      automatic: operation.kind === "query",
      reason: operation.kind === "query" ? "Safe reads retry at most twice with bounded backoff." : "Mutations are never retried automatically.",
    },
    examples: [`fireflies ${commandUsage(operation)} --help`],
    compatibility: { "deprecated-aliases": [] },
    exceptions: operation.name === "audio-files upload"
      ? ["CLI-SAFE-8: Fireflies returns success, title, and message but no job identifier or waitable status."]
      : [],
  };
}

export interface UtilityCommand {
  readonly pattern: readonly string[];
  readonly usage: string;
  readonly description: string;
}

export const utilityCommands: readonly UtilityCommand[] = [
  { pattern: ["setup"], usage: "setup [profile]", description: "Create and activate a protected profile." },
  { pattern: ["profiles", "list"], usage: "profiles list", description: "List local profile names." },
  { pattern: ["profiles", "get"], usage: "profiles get <name>", description: "Get one redacted local profile." },
  { pattern: ["profiles", "create"], usage: "profiles create <name>", description: "Create a protected local profile." },
  { pattern: ["profiles", "update"], usage: "profiles update <name>", description: "Update a protected local profile." },
  { pattern: ["profiles", "delete"], usage: "profiles delete <name>", description: "Delete a local profile." },
  { pattern: ["profiles", "use"], usage: "profiles use <name>", description: "Select the active profile." },
  { pattern: ["config", "path"], usage: "config path", description: "Get the configuration file path." },
  { pattern: ["config", "list"], usage: "config list", description: "List redacted global configuration." },
  { pattern: ["config", "get"], usage: "config get <key>", description: "Get one configuration value." },
  { pattern: ["config", "set"], usage: "config set <key> <value>", description: "Set one configuration value." },
  { pattern: ["config", "unset"], usage: "config unset <key>", description: "Unset one configuration value." },
  { pattern: ["auth", "verify"], usage: "auth verify", description: "Verify the credential and return its Fireflies owner." },
  { pattern: ["api", "request"], usage: "api request POST /graphql --file REQUEST.json", description: "Send an exact GraphQL request body." },
  { pattern: ["completions", "bash"], usage: "completions bash", description: "Print Bash completion." },
  { pattern: ["completions", "zsh"], usage: "completions zsh", description: "Print Z shell completion." },
  { pattern: ["completions", "fish"], usage: "completions fish", description: "Print fish completion." },
];
