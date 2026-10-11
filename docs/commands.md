# Fireflies CLI command specifications

The conventions behind these specifications are in [`cli-conventions.md`](cli-conventions.md).

`src/operations.ts` contains every first-class provider command and exposes `operationSpecification()`. The generated specification supplies every `CLI-SPEC-1` field: command, summary, arguments, options, validation, authentication, effects, output, pagination, failures, retry behavior, examples, compatibility, and exceptions.

Shared contracts:

- Authentication uses `--api-key`, `FIREFLIES_API_KEY`, or the explicitly selected or active protected profile, in that order. An explicitly selected missing profile fails.
- Reads make one provider request unless `--all` is supplied for a registered paginated operation. Safe reads retry at most twice with bounded backoff.
- Remote mutations require interactive confirmation or `--yes`. `--dry-run` validates locally and emits a redacted plan without a provider request. Mutations use one provider request and are never retried automatically.
- First-class output uses `{"data":...,"meta":...}`. A collection always places an array in `data`. Cursor pagination places `next_cursor` and `has_more` in `meta`.
- Raw access uses `api request POST /graphql --file REQUEST.json`. Its response preserves the provider shape. Every raw POST requires confirmation, including GraphQL queries.
- All provider date filters accept `YYYY-MM-DD` as UTC or an ISO 8601 date-time with an explicit offset. Date-only values mean midnight UTC. `from` is inclusive, and `to` is exclusive; this CLI sends both boundaries unchanged.
- A GraphQL response containing both `data` and `errors` exits 8 and reports provider error paths. It does not imply rollback.

Provider limitation: `audio-files upload` records a `CLI-SAFE-8` exception because Fireflies returns `success`, `title`, and `message`, but no job identifier or waitable status. The command does not offer `--wait`.
