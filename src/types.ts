export interface UnknownFlag {
  readonly name: string;
  readonly value: string | boolean;
}

export interface ParsedArgs {
  readonly command: string[];
  readonly flags: Record<string, string | boolean | string[]>;
  readonly unknownFlags: UnknownFlag[];
}

export interface Profile {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

export interface GlobalOptions {
  readonly profile?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly variables?: string;
  readonly fields?: string;
  readonly set: string[];
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly format: "json" | "pretty" | "human";
  readonly color: "auto" | "always" | "never";
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly noInput: boolean;
  readonly timeoutMs?: number;
  readonly help: boolean;
  readonly version: boolean;
}

export interface RuntimeContext {
  readonly profileName?: string;
  readonly profile?: Profile;
  readonly baseUrl: string;
}

export interface ResolvedAuth {
  readonly apiKey?: string;
  readonly source?: string;
}

export type OperationKind = "query" | "mutation";
export type ValueKind = "string" | "integer" | "number" | "boolean" | "csv" | "single-list" | "json";

export interface VariableBinding {
  readonly flag?: string;
  readonly parameter?: string;
  readonly path: string;
  readonly kind: ValueKind;
  readonly required?: boolean;
  readonly choices?: readonly (string | number | boolean)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly jsonShape?: "object" | "array";
}

export interface Operation {
  readonly name: string;
  readonly pattern: readonly string[];
  readonly kind: OperationKind;
  readonly operationName: string;
  readonly variableDefinitions: string;
  readonly invocation: string;
  readonly selection: string;
  readonly bindings: readonly VariableBinding[];
  readonly description: string;
  readonly docs: string;
  readonly validate?: (variables: Record<string, unknown>) => void;
}

export interface OperationMatch {
  readonly operation: Operation;
  readonly parameters: Record<string, string>;
}

export interface GraphQLRequestBody {
  readonly query: string;
  readonly variables?: Record<string, unknown>;
  readonly operationName?: string;
}

export interface RequestPlan {
  readonly kind: OperationKind;
  readonly operation: string;
  readonly url: string;
  readonly auth: ResolvedAuth;
  readonly headers: Record<string, string>;
  readonly body: GraphQLRequestBody;
  readonly timeoutMs?: number;
  readonly requiresConfirmation?: boolean;
  readonly pagination?: { readonly all: boolean; readonly maxItems?: number; readonly offset: boolean };
}

export interface GraphQLErrorPayload {
  readonly message?: string;
  readonly path?: readonly (string | number)[];
  readonly extensions?: Record<string, unknown>;
}

export interface GraphQLResponsePayload {
  readonly data?: unknown;
  readonly errors?: readonly GraphQLErrorPayload[];
  readonly [key: string]: unknown;
}

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

