import { CliError } from "./errors";
import { listProfiles } from "./config";
import { commandUsage, operations, utilityCommands } from "./operations";

const builtins = utilityCommands.map((command) => command.usage);

const globalOptions = [
  "--help", "-h", "--version", "--profile", "--api-key", "--base-url", "--format", "--quiet", "-q",
  "--verbose", "-v", "--no-input", "--color", "--timeout", "--variables", "--fields", "--set",
];

export function completionScript(shell: string | undefined): string {
  const commands = [...builtins, ...operations.map(commandUsage)];
  const commandWords = [...new Set(commands.flatMap((command) => command.split(" "))
    .filter((word) => !word.startsWith("<") && !word.startsWith("[")))];
  const operationOptions = operations.flatMap((operation) =>
    operation.bindings.flatMap((binding) => binding.flag ? [`--${binding.flag}`] : []));
  const options = [...new Set([...globalOptions, ...operationOptions, "--yes", "-y", "--dry-run", "--all", "--max-items", "--cursor", "--file", "--query"])];
  const profiles = listProfiles();

  if (shell === "bash") {
    return `_fireflies_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    --format) COMPREPLY=( $(compgen -W 'json pretty human' -- "$cur") ); return ;;
    --color) COMPREPLY=( $(compgen -W 'auto always never' -- "$cur") ); return ;;
    --profile) COMPREPLY=( $(compgen -W '${profiles.join(" ")}' -- "$cur") ); return ;;
  esac
  COMPREPLY=( $(compgen -W '${[...commandWords, ...options].join(" ")}' -- "$cur") )
}
complete -F _fireflies_complete fireflies`;
  }
  if (shell === "zsh") {
    return `#compdef fireflies
_arguments \
  '--format[output format]:format:(json pretty human)' \
  '--color[color policy]:color:(auto always never)' \
  '--profile[configuration profile]:profile:(${profiles.join(" ")})' \
  '*:command:(${[...commandWords, ...options].join(" ")})'`;
  }
  if (shell === "fish") {
    const values = [...commandWords, ...options]
      .map((word) => `complete -c fireflies -a '${word}'`);
    values.push("complete -c fireflies -l format -a 'json pretty human'");
    values.push("complete -c fireflies -l color -a 'auto always never'");
    for (const profile of profiles) values.push(`complete -c fireflies -l profile -a '${profile.replaceAll("'", "\\'")}'`);
    return values.join("\n");
  }
  throw new CliError("Usage: fireflies completions <bash|zsh|fish>");
}
