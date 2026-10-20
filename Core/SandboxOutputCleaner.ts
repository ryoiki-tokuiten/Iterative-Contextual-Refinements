/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native Sandbox Output Cleaner & Trajectory Formatter:
 * 1. `rtk-ai/rtk` (Rust Token Killer) AST-aware command prefixing & deterministic terminal output scrubbing
 * 2. `just-bash` Bash AST parsing & Pass-2 read-only command classification
 * 3. `@letta-ai/trajectory` unified `.jsonl` trajectory normalization with `ok: boolean` tool flags
 */

import {
    AST,
    parse as parseBashAst,
    serialize as serializeBashAst,
    type CommandNode,
    type PipelineNode,
    type RedirectionNode,
    type ScriptNode,
    type SimpleCommandNode,
    type StatementNode,
    type WordNode,
    type WordPart,
} from 'just-bash';
import {
    normalizeTranscript,
    type NormalizedRecord,
} from '@letta-ai/trajectory';
import type { BaseMessage } from '@langchain/core/messages';

// ============================================================================
// 1. Constants & Allowlists
// ============================================================================

export const READ_ONLY_MASKED_OUTPUT_PLACEHOLDER = '[exit_code=0 | read-only command output masked]';

/**
 * Commands whose sole effect (when no output file redirection is present)
 * is reading/inspecting filesystem or environment state.
 */
const READ_ONLY_COMMANDS = new Set([
    'ls',
    'dir',
    'cat',
    'rg',
    'grep',
    'egrep',
    'fgrep',
    'zgrep',
    'find',
    'fd',
    'head',
    'tail',
    'wc',
    'pwd',
    'stat',
    'file',
    'tree',
    'which',
    'whereis',
    'type',
    'whoami',
    'id',
    'uname',
    'hostname',
    'realpath',
    'readlink',
    'dirname',
    'basename',
    'du',
    'df',
    'free',
    'uptime',
    'ps',
    'env',
    'printenv',
    'diff',
    'cmp',
    'comm',
    'sort',
    'uniq',
    'cut',
    'tr',
    'awk',
    'gawk',
    'jq',
    'yq',
    'less',
    'more',
    'nl',
    'od',
    'xxd',
    'hexdump',
    'strings',
    'md5sum',
    'sha1sum',
    'sha256sum',
    'shasum',
    'b2sum',
    'cksum',
    'view',
    'open',
    'true',
    'false',
    'test',
    '[',
    '[[',
]);

/** Git subcommands that only inspect repository state without mutating it. */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
    'status',
    'diff',
    'log',
    'show',
    'rev-parse',
    'ls-files',
    'ls-tree',
    'cat-file',
    'describe',
    'shortlog',
    'grep',
    'blame',
    'reflog',
    'name-rev',
    'for-each-ref',
    ' rev-list',
    'rev-list',
    'status',
]);

/** Transparent wrapper commands that delegate to the next positional argument. */
const TRANSPARENT_COMMAND_WRAPPERS = new Set([
    'rtk',
    'command',
    'builtin',
    'time',
    'nice',
    'nohup',
    'stdbuf',
]);

/**
 * CLI tools supported by `rtk` (Rust Token Killer) where prefixing `<cmd>` -> `rtk <cmd>`
 * compresses verbose test, build, git, search, and directory outputs by 60%-90%.
 */
const RTK_SUPPORTED_COMMANDS = new Set([
    'pytest',
    'git',
    'ls',
    'tree',
    'find',
    'grep',
    'rg',
    'ast-grep',
    'cargo',
    'npm',
    'npx',
    'pnpm',
    'bun',
    'bunx',
    'tsc',
    'jest',
    'vitest',
    'playwright',
    'prettier',
    'ruff',
    'mypy',
    'pip',
    'uv',
    'go',
    'dotnet',
    'docker',
    'kubectl',
    'oc',
    'gh',
    'glab',
    'aws',
    'psql',
    'wget',
    'wc',
    'diff',
    'ctest',
    'prisma',
    'next',
    'golangci-lint',
    'gradlew',
    'mvn',
    'mvnd',
    'rake',
    'rubocop',
    'rspec',
    'php',
    'phpunit',
    'phpstan',
    'pest',
    'paratest',
    'ecs',
    'pint',
    'phpt',
    'sqlfluff',
    'deno',
    'sbt',
    'gt',
]);

/** Redirection operators that write or truncate files on disk. */
const FILE_WRITE_REDIRECTION_OPERATORS = new Set([
    '>',
    '>>',
    '>|',
    '&>',
    '&>>',
    '<>',
]);

// ============================================================================
// 2. `just-bash` AST Helpers: Word Extraction, Classification & RTK Rewriting
// ============================================================================

function wordToStaticString(word: WordNode | null | undefined): string | null {
    if (!word || !Array.isArray(word.parts) || word.parts.length === 0) return null;
    let out = '';
    for (const part of word.parts) {
        const text = wordPartToStaticString(part);
        if (text === null) return null;
        out += text;
    }
    return out;
}

function wordPartToStaticString(part: WordPart): string | null {
    switch (part.type) {
        case 'Literal':
        case 'SingleQuoted':
        case 'Escaped':
            return part.value;
        case 'DoubleQuoted': {
            let acc = '';
            for (const inner of part.parts) {
                const s = wordPartToStaticString(inner);
                if (s === null) return null;
                acc += s;
            }
            return acc;
        }
        default:
            return null;
    }
}

function isFileWriteRedirection(redirection: RedirectionNode): boolean {
    if (!FILE_WRITE_REDIRECTION_OPERATORS.has(redirection.operator)) {
        return false;
    }
    if (redirection.target.type === 'Word') {
        const targetText = wordToStaticString(redirection.target)?.trim();
        if (targetText === '/dev/null') {
            return false;
        }
    }
    return true;
}

function unwrapCommandWords(cmd: SimpleCommandNode): string[] | null {
    const allWords: WordNode[] = [];
    if (cmd.name) allWords.push(cmd.name);
    if (Array.isArray(cmd.args)) allWords.push(...cmd.args);
    if (allWords.length === 0) return [];

    const staticTokens: string[] = [];
    for (const w of allWords) {
        const s = wordToStaticString(w);
        if (s === null) {
            // Dynamic expansion in argument; keep sentinel so command name can still be checked
            staticTokens.push('\0DYNAMIC\0');
        } else {
            staticTokens.push(s);
        }
    }

    let idx = 0;
    while (idx < staticTokens.length) {
        const token = staticTokens[idx];
        if (token === 'env') {
            idx++;
            while (idx < staticTokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(staticTokens[idx]) || staticTokens[idx].startsWith('-'))) {
                idx++;
            }
            continue;
        }
        if (token === 'timeout') {
            idx++;
            while (idx < staticTokens.length && staticTokens[idx].startsWith('-')) {
                idx++;
            }
            if (idx < staticTokens.length) idx++; // skip duration
            continue;
        }
        if (TRANSPARENT_COMMAND_WRAPPERS.has(token)) {
            idx++;
            while (idx < staticTokens.length && staticTokens[idx].startsWith('-')) {
                idx++;
            }
            continue;
        }
        break;
    }

    return staticTokens.slice(idx);
}

function isSingleSimpleCommandReadOnly(cmd: SimpleCommandNode): { readOnly: boolean; commandLabel: string } {
    if (cmd.redirections?.some(isFileWriteRedirection)) {
        return { readOnly: false, commandLabel: 'redirect' };
    }

    const tokens = unwrapCommandWords(cmd);
    if (!tokens || tokens.length === 0) {
        // Pure variable assignment `FOO=bar` has no external side effect by itself
        return { readOnly: false, commandLabel: 'assignment' };
    }

    const rawProg = tokens[0];
    if (!rawProg || rawProg === '\0DYNAMIC\0') {
        return { readOnly: false, commandLabel: 'dynamic' };
    }

    const prog = rawProg.split('/').pop() || rawProg;
    const restArgs = tokens.slice(1);

    if (prog === 'git') {
        // Find the git subcommand (skip global git flags like -C <dir>, --no-pager, -c k=v)
        let i = 0;
        while (i < restArgs.length) {
            const arg = restArgs[i];
            if (arg === '-C' || arg === '-c' || arg === '--git-dir' || arg === '--work-tree') {
                i += 2;
                continue;
            }
            if (arg.startsWith('-')) {
                i++;
                continue;
            }
            break;
        }
        const sub = restArgs[i] || '';
        if (!READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
            return { readOnly: false, commandLabel: sub ? `git ${sub}` : 'git' };
        }
        // Check git diff / show / log for --output=<file> or -o <file>
        if (restArgs.some(a => a === '-o' || a === '--output' || a.startsWith('--output='))) {
            return { readOnly: false, commandLabel: `git ${sub}` };
        }
        return { readOnly: true, commandLabel: `git ${sub}` };
    }

    if (prog === 'sed') {
        const hasInPlace = restArgs.some(a => a === '-i' || a.startsWith('-i') || a === '--in-place' || a.startsWith('--in-place='));
        return { readOnly: !hasInPlace, commandLabel: 'sed' };
    }

    if (prog === 'find') {
        const mutatingFindFlags = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
        const hasMutating = restArgs.some(a => mutatingFindFlags.has(a));
        return { readOnly: !hasMutating, commandLabel: 'find' };
    }

    if (prog === 'sort' || prog === 'uniq') {
        // sort -o <output-file> writes to a file
        const hasOutputFlag = restArgs.some(a => a === '-o' || a === '--output' || a.startsWith('--output='));
        if (hasOutputFlag) return { readOnly: false, commandLabel: prog };
    }

    if (READ_ONLY_COMMANDS.has(prog)) {
        return { readOnly: true, commandLabel: prog };
    }

    return { readOnly: false, commandLabel: prog };
}

export interface BashCommandClassification {
    isReadOnly: boolean;
    hasFileRedirection: boolean;
    commands: string[];
    parseError?: boolean;
}

/**
 * Pass 2 Command Classifier using `just-bash` AST parser.
 * Walks the full Bash AST (statements, pipelines, compound commands, command substitutions,
 * process substitutions, and redirections). Returns `isReadOnly: true` if and only if:
 * 1. The AST parses cleanly with no deferred syntax errors,
 * 2. The tree contains no file-writing redirection nodes (`>`, `>>`, `>|`, `&>`, `&>>`, `<>` to files),
 * 3. Every executed command node sits in the read-only allowlist (`ls`, `cat`, `rg`, `grep`, `find`, `git status`, etc.).
 */
export function classifyBashCommand(commandString: string): BashCommandClassification {
    const trimmed = (commandString || '').trim();
    if (!trimmed) {
        return { isReadOnly: false, hasFileRedirection: false, commands: [] };
    }

    let ast: ScriptNode;
    try {
        ast = parseBashAst(trimmed);
    } catch {
        return { isReadOnly: false, hasFileRedirection: false, commands: [], parseError: true };
    }

    let hasFileRedirection = false;
    let allCommandsReadOnly = true;
    const commands: string[] = [];

    const walkWord = (word: WordNode | null | undefined) => {
        if (!word || !Array.isArray(word.parts)) return;
        for (const part of word.parts) {
            walkWordPart(part);
        }
    };

    const walkWordPart = (part: WordPart) => {
        if (part.type === 'DoubleQuoted') {
            part.parts.forEach(walkWordPart);
        } else if (part.type === 'CommandSubstitution') {
            walkScript(part.body);
        } else if (part.type === 'ProcessSubstitution') {
            if (part.direction === 'output') {
                hasFileRedirection = true;
                allCommandsReadOnly = false;
            }
            walkScript(part.body);
        } else if (part.type === 'BraceExpansion') {
            for (const item of part.items) {
                if (item.type === 'Word') walkWord(item.word);
            }
        }
    };

    const walkRedirections = (redirections: RedirectionNode[] | undefined) => {
        if (!Array.isArray(redirections)) return;
        for (const redir of redirections) {
            if (isFileWriteRedirection(redir)) {
                hasFileRedirection = true;
                allCommandsReadOnly = false;
            }
            if (redir.target.type === 'Word') {
                walkWord(redir.target);
            } else if (redir.target.type === 'HereDoc') {
                walkWord(redir.target.content);
            }
        }
    };

    const walkCommand = (cmd: CommandNode) => {
        walkRedirections((cmd as any).redirections);

        switch (cmd.type) {
            case 'SimpleCommand': {
                walkWord(cmd.name);
                cmd.args.forEach(walkWord);
                cmd.assignments.forEach(assign => {
                    walkWord(assign.value);
                    assign.array?.forEach(walkWord);
                });
                const res = isSingleSimpleCommandReadOnly(cmd);
                commands.push(res.commandLabel);
                if (!res.readOnly) {
                    allCommandsReadOnly = false;
                }
                break;
            }
            case 'If': {
                for (const clause of cmd.clauses) {
                    clause.condition.forEach(walkStatement);
                    clause.body.forEach(walkStatement);
                }
                cmd.elseBody?.forEach(walkStatement);
                break;
            }
            case 'For': {
                cmd.words?.forEach(walkWord);
                cmd.body.forEach(walkStatement);
                break;
            }
            case 'CStyleFor': {
                cmd.body.forEach(walkStatement);
                break;
            }
            case 'While':
            case 'Until': {
                cmd.condition.forEach(walkStatement);
                cmd.body.forEach(walkStatement);
                break;
            }
            case 'Case': {
                walkWord(cmd.word);
                for (const item of cmd.items) {
                    item.patterns.forEach(walkWord);
                    item.body.forEach(walkStatement);
                }
                break;
            }
            case 'Subshell':
            case 'Group': {
                cmd.body.forEach(walkStatement);
                break;
            }
            case 'FunctionDef': {
                walkCommand(cmd.body);
                break;
            }
            case 'ArithmeticCommand':
            case 'ConditionalCommand': {
                // Pure arithmetic or [[ ... ]] test
                commands.push(cmd.type);
                break;
            }
        }
    };

    const walkPipeline = (pipeline: PipelineNode) => {
        for (const cmd of pipeline.commands) {
            walkCommand(cmd);
        }
    };

    const walkStatement = (stmt: StatementNode) => {
        if (stmt.deferredError) {
            allCommandsReadOnly = false;
        }
        for (const pipeline of stmt.pipelines) {
            walkPipeline(pipeline);
        }
    };

    const walkScript = (script: ScriptNode) => {
        for (const stmt of script.statements) {
            walkStatement(stmt);
        }
    };

    walkScript(ast);

    const isReadOnly =
        commands.length > 0 &&
        allCommandsReadOnly &&
        !hasFileRedirection;

    return {
        isReadOnly,
        hasFileRedirection,
        commands,
    };
}

/**
 * Returns true if the bash command is strictly read-only (via `just-bash` AST)
 * AND completed with `exit_code === 0`.
 */
export function shouldMaskReadOnlyOutput(commandString: string, exitCode: number): boolean {
    if (exitCode !== 0) return false;
    return classifyBashCommand(commandString).isReadOnly;
}

/**
 * Walks the `just-bash` AST and prefixes eligible external CLI commands
 * (`pytest`, `git`, `ls`, `rg`, `grep`, `find`, `cargo`, `npm`, `tsc`, etc.)
 * with `rtk` (Rust Token Killer) when there are no file-writing redirections on that command.
 * Preserves shell builtins (`cd`, `export`, `set`, etc.), variable assignments, and redirections untouched.
 */
export function rewriteCommandWithRtkAst(commandString: string): string {
    const trimmed = (commandString || '').trim();
    if (!trimmed) return commandString;

    let ast: ScriptNode;
    try {
        ast = parseBashAst(trimmed);
    } catch {
        return commandString;
    }

    // If any statement has a deferred parse error or heredoc (which serialize() may reformat),
    // leave the raw string untouched so heredoc bodies stay byte-exact.
    let hasHereDocOrDeferredError = false;

    const checkUnsupportedForSerialize = (script: ScriptNode) => {
        for (const stmt of script.statements) {
            if (stmt.deferredError) {
                hasHereDocOrDeferredError = true;
                return;
            }
            for (const pipeline of stmt.pipelines) {
                for (const cmd of pipeline.commands) {
                    if ((cmd as any).redirections?.some((r: RedirectionNode) => r.target.type === 'HereDoc')) {
                        hasHereDocOrDeferredError = true;
                        return;
                    }
                }
            }
        }
    };

    checkUnsupportedForSerialize(ast);
    if (hasHereDocOrDeferredError) {
        return commandString;
    }

    let mutated = false;

    const rewriteSimpleCommand = (cmd: SimpleCommandNode, inPipeline: boolean) => {
        if (!cmd.name) return;
        // Do not rewrite if the command writes to a file or reads stdin from a pipe
        if (cmd.redirections?.some(isFileWriteRedirection)) return;
        if (inPipeline) return;

        const nameStr = wordToStaticString(cmd.name);
        if (!nameStr || nameStr === 'rtk') return;

        const baseProg = nameStr.split('/').pop() || nameStr;
        if (!RTK_SUPPORTED_COMMANDS.has(baseProg)) return;

        // Prefix with `rtk`: `pytest -q` -> `rtk pytest -q`
        cmd.args = [cmd.name, ...(cmd.args || [])];
        cmd.name = AST.word([AST.literal('rtk')]);
        mutated = true;
    };

    const walkCommandForRewrite = (cmd: CommandNode, inPipeline: boolean) => {
        switch (cmd.type) {
            case 'SimpleCommand':
                rewriteSimpleCommand(cmd, inPipeline);
                break;
            case 'Subshell':
            case 'Group':
                cmd.body.forEach(walkStatementForRewrite);
                break;
            case 'If':
                cmd.clauses.forEach(c => {
                    c.condition.forEach(walkStatementForRewrite);
                    c.body.forEach(walkStatementForRewrite);
                });
                cmd.elseBody?.forEach(walkStatementForRewrite);
                break;
            case 'For':
            case 'CStyleFor':
                cmd.body.forEach(walkStatementForRewrite);
                break;
            case 'While':
            case 'Until':
                cmd.condition.forEach(walkStatementForRewrite);
                cmd.body.forEach(walkStatementForRewrite);
                break;
            default:
                break;
        }
    };

    const walkStatementForRewrite = (stmt: StatementNode) => {
        for (const pipeline of stmt.pipelines) {
            const isMultiStagePipeline = pipeline.commands.length > 1;
            for (const cmd of pipeline.commands) {
                walkCommandForRewrite(cmd, isMultiStagePipeline);
            }
        }
    };

    for (const stmt of ast.statements) {
        walkStatementForRewrite(stmt);
    }

    if (!mutated) return commandString;

    try {
        return serializeBashAst(ast);
    } catch {
        return commandString;
    }
}

// ============================================================================
// 3. Deterministic Terminal Output Scrubber (Complementing `rtk`)
// ============================================================================

// Matches ANSI CSI/OSC/SGR escape sequences
const ANSI_ESCAPE_REGEX = new RegExp(
    [
        '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
        '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
    ].join('|'),
    'g'
);

// Matches standalone Braille/ASCII spinner-only lines
const SPINNER_LINE_REGEX = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\-\\]\s*(?:Loading|Running|Building|Compiling|Installing|Fetching|Resolving|Downloading|Waiting)?\.{0,3}\s*$/i;

/**
 * Deterministically strips ANSI escape sequences, resolves carriage-return (`\r`)
 * progress-bar redraws to their final frame, removes spinner-only lines, and collapses
 * excessive blank lines.
 */
export function cleanTerminalOutput(raw: string): string {
    if (!raw || typeof raw !== 'string') return '';

    // 1. Normalize CRLF -> LF first, while preserving bare \r for progress bar overwrite resolution
    let text = raw.replace(/\r\n/g, '\n');

    // 2. Strip ANSI escape codes
    text = text.replace(ANSI_ESCAPE_REGEX, '');

    // 3. Resolve bare carriage returns (\r) on each line (e.g. tqdm / pip / cargo progress bars)
    const cleanedLines: string[] = [];
    for (const rawLine of text.split('\n')) {
        let line = rawLine;
        if (line.includes('\r')) {
            const segments = line.split('\r');
            // Take the last non-empty overwrite segment (how a real terminal renders \r)
            let resolved = '';
            for (let i = segments.length - 1; i >= 0; i--) {
                if (segments[i].length > 0) {
                    resolved = segments[i];
                    break;
                }
            }
            line = resolved;
        }

        // Remove backspaces (char + \x08)
        while (line.includes('\x08')) {
            const next = line.replace(/[^\x08]\x08/g, '');
            if (next === line) {
                line = line.replace(/\x08+/g, '');
                break;
            }
            line = next;
        }

        if (SPINNER_LINE_REGEX.test(line)) {
            continue;
        }

        cleanedLines.push(line.replace(/[ \t]+$/g, ''));
    }

    return cleanedLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

// ============================================================================
// 4. Native `sandbox_exec` ToolMessage Content Formatter
// ============================================================================

export interface FormatSandboxToolMessageArgs {
    command: string;
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string | null;
    visibleFiles?: Array<{ filename: string; mimeType: string }>;
    /** When true and command is classified as read-only with exit_code === 0, masks stdout. */
    maskReadOnlyStdout?: boolean;
}

/**
 * Formats the `sandbox_exec` tool output into a compact, zero-boilerplate payload
 * passed natively to the agent and stored in `ToolMessage.content`.
 */
export function formatNativeSandboxToolResult(args: FormatSandboxToolMessageArgs): {
    content: string;
    isReadOnly: boolean;
    ok: boolean;
} {
    const classification = classifyBashCommand(args.command);
    const cleanedStdout = cleanTerminalOutput(args.stdout || '');
    const cleanedStderr = cleanTerminalOutput(args.stderr || '');
    const cleanedError = args.error ? cleanTerminalOutput(args.error) : '';

    const shouldMask =
        args.maskReadOnlyStdout === true &&
        args.exitCode === 0 &&
        classification.isReadOnly &&
        !cleanedStderr &&
        !cleanedError;

    const lines: string[] = [`exit_code=${args.exitCode}`];

    if (shouldMask) {
        lines.push(READ_ONLY_MASKED_OUTPUT_PLACEHOLDER);
    } else if (cleanedStdout) {
        lines.push(`stdout:\n${cleanedStdout}`);
    }

    if (cleanedStderr) {
        lines.push(`stderr:\n${cleanedStderr}`);
    }

    if (cleanedError) {
        lines.push(`error:\n${cleanedError}`);
    }

    if (args.visibleFiles && args.visibleFiles.length > 0) {
        lines.push(
            `visible_image_files:\n${args.visibleFiles.map(f => `- ${f.filename} (${f.mimeType})`).join('\n')}`
        );
    }

    return {
        content: lines.join('\n\n'),
        isReadOnly: classification.isReadOnly,
        ok: args.ok && args.exitCode === 0,
    };
}

// ============================================================================
// 5. `@letta-ai/trajectory` Unified `.jsonl` Formatter
// ============================================================================

function isHarnessBoilerplateMessage(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return (
        trimmed.startsWith('[HARNESS NOTE:') ||
        trimmed.startsWith('<local-command-caveat>') ||
        trimmed.startsWith('Your previous response was ordinary prose, so it was not submitted.')
    );
}

function extractMessageTextAndThoughts(content: unknown): { text: string; thoughts: string[] } {
    if (typeof content === 'string') {
        return { text: content, thoughts: [] };
    }
    if (!Array.isArray(content)) {
        return { text: String(content ?? ''), thoughts: [] };
    }

    const textParts: string[] = [];
    const thoughts: string[] = [];

    for (const part of content) {
        if (typeof part === 'string') {
            textParts.push(part);
            continue;
        }
        if (!part || typeof part !== 'object') continue;
        const rec = part as Record<string, unknown>;

        if (rec.thought === true && typeof rec.text === 'string') {
            if (rec.text.trim()) thoughts.push(rec.text.trim());
            continue;
        }
        if ((rec.type === 'thinking' || rec.type === 'reasoning') && typeof (rec.thinking ?? rec.text) === 'string') {
            const t = String(rec.thinking ?? rec.text).trim();
            if (t) thoughts.push(t);
            continue;
        }
        if (typeof rec.text === 'string' && rec.thought !== true) {
            textParts.push(rec.text);
        }
    }

    return {
        text: textParts.join('').trim(),
        thoughts,
    };
}

/**
 * Converts a LangChain `BaseMessage[]` agent conversation into `@letta-ai/trajectory`
 * normalized `.jsonl` format (one `NormalizedRecord` JSON object per line, with
 * `ok: boolean` on tool results, stripped harness boilerplate, and Pass-2 read-only
 * output masking when `exit_code === 0`).
 */
export function formatTrajectoryToJsonl(
    messages: BaseMessage[],
    options?: {
        maskReadOnlyToolOutputs?: boolean;
        includeSystemMessages?: boolean;
    }
): string {
    const maskReadOnly = options?.maskReadOnlyToolOutputs ?? true;
    const includeSystem = options?.includeSystemMessages ?? true;

    // Collect tool results by tool_call_id so we can emit Letta Code transcript rows
    // and run them through `@letta-ai/trajectory`'s `normalizeTranscript`.
    const toolResultByCallId = new Map<string, { content: string; ok: boolean; command?: string; exitCode?: number }>();
    const commandByCallId = new Map<string, string>();

    for (const msg of messages) {
        const raw = msg as any;
        const msgType = typeof raw._getType === 'function' ? raw._getType() : '';
        if (msgType === 'ai' && Array.isArray(raw.tool_calls)) {
            for (const tc of raw.tool_calls) {
                if (tc?.id && tc?.name === 'sandbox_exec' && typeof tc?.args?.command === 'string') {
                    commandByCallId.set(String(tc.id), tc.args.command);
                }
            }
        }
    }

    for (const msg of messages) {
        const raw = msg as any;
        const msgType = typeof raw._getType === 'function' ? raw._getType() : '';
        if (msgType === 'tool' && raw.tool_call_id) {
            const callId = String(raw.tool_call_id);
            const rawText = extractMessageTextAndThoughts(raw.content).text;
            const artifactMeta = raw.artifact as {
                command?: string;
                exitCode?: number;
                ok?: boolean;
                isReadOnly?: boolean;
            } | undefined;

            const command = artifactMeta?.command ?? commandByCallId.get(callId) ?? '';
            const exitCodeMatch = rawText.match(/^exit_code=(-?\d+)/m);
            const exitCode = typeof artifactMeta?.exitCode === 'number'
                ? artifactMeta.exitCode
                : exitCodeMatch
                    ? Number(exitCodeMatch[1])
                    : (raw.status === 'error' ? 1 : 0);
            const ok = typeof artifactMeta?.ok === 'boolean'
                ? artifactMeta.ok
                : raw.status !== 'error' && exitCode === 0;

            let finalResultText = cleanTerminalOutput(rawText);
            if (maskReadOnly && command && exitCode === 0 && shouldMaskReadOnlyOutput(command, exitCode)) {
                finalResultText = `exit_code=0\n\n${READ_ONLY_MASKED_OUTPUT_PLACEHOLDER}`;
            }

            toolResultByCallId.set(callId, {
                content: finalResultText,
                ok,
                command,
                exitCode,
            });
        }
    }

    const lettaRows: string[] = [];
    const systemRecords: NormalizedRecord[] = [];
    const baseTimeMs = Date.now();
    let stepIndex = 0;

    const nextIsoTimestamp = () => new Date(baseTimeMs + stepIndex++ * 1000).toISOString();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const raw = msg as any;
        const msgType = typeof raw._getType === 'function' ? raw._getType() : '';
        const { text, thoughts } = extractMessageTextAndThoughts(raw.content);
        const msgId = typeof raw.id === 'string' && raw.id ? raw.id : `msg_${i + 1}`;

        if (msgType === 'system') {
            if (includeSystem && text) {
                systemRecords.push({
                    role: 'system',
                    content: text,
                    timestamp: nextIsoTimestamp(),
                });
            }
            continue;
        }

        if (msgType === 'human') {
            if (!text || isHarnessBoilerplateMessage(text)) {
                continue;
            }
            lettaRows.push(JSON.stringify({
                kind: 'user',
                source_message_id: msgId,
                text,
                captured_at: nextIsoTimestamp(),
            }));
            continue;
        }

        if (msgType === 'ai') {
            for (let tIdx = 0; tIdx < thoughts.length; tIdx++) {
                lettaRows.push(JSON.stringify({
                    kind: 'reasoning',
                    source_message_id: `${msgId}_thought_${tIdx + 1}`,
                    text: thoughts[tIdx],
                    captured_at: nextIsoTimestamp(),
                }));
            }

            if (text) {
                lettaRows.push(JSON.stringify({
                    kind: 'assistant',
                    source_message_id: msgId,
                    text,
                    captured_at: nextIsoTimestamp(),
                }));
            }

            const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
            for (let cIdx = 0; cIdx < toolCalls.length; cIdx++) {
                const tc = toolCalls[cIdx];
                const callId = typeof tc?.id === 'string' && tc.id ? tc.id : `${msgId}_call_${cIdx + 1}`;
                const toolName = typeof tc?.name === 'string' && tc.name ? tc.name : 'unknown_tool';
                const argsText = typeof tc?.args === 'string'
                    ? tc.args
                    : JSON.stringify(tc?.args ?? {});
                const pairedResult = toolResultByCallId.get(callId);

                lettaRows.push(JSON.stringify({
                    kind: 'tool_call',
                    source_line_id: callId,
                    name: toolName,
                    argsText,
                    ...(pairedResult
                        ? {
                            resultText: pairedResult.content,
                            resultOk: pairedResult.ok,
                        }
                        : {}),
                    captured_at: nextIsoTimestamp(),
                }));
            }
        }
    }

    if (lettaRows.length === 0) {
        return systemRecords.map(r => JSON.stringify(r)).join('\n');
    }

    try {
        const normalized = normalizeTranscript({
            source: 'letta-code',
            transcript: lettaRows.join('\n'),
            sourceContext: { partial: true },
            bounds: {
                toolArguments: { maxCharacters: null },
                toolResults: { maxCharacters: null },
            },
            filters: {
                toolResults: 'include',
                systemMessages: 'include',
            },
        });

        // Insert system records immediately after the leading `meta` record
        const records = [...normalized.records];
        if (systemRecords.length > 0) {
            if (records[0]?.role === 'meta') {
                records.splice(1, 0, ...systemRecords);
            } else {
                records.unshift(...systemRecords);
            }
        }

        return records.map(record => JSON.stringify(record)).join('\n');
    } catch {
        // Fallback if transcript had only partial fragments
        return [...systemRecords.map(r => JSON.stringify(r)), ...lettaRows].join('\n');
    }
}
