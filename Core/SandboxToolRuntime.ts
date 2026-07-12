/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDefinition } from '@langchain/core/language_models/base';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { globalState } from './State';
import {
    createToolCallingAgentModel,
    invokeGeminiToolAgentTurn,
    messageContentToText,
    resolveProviderForModel,
    type ResolvedProvider
} from './LangGraphToolRuntime';

export interface SandboxToolAgentOptions {
    agentName: string;
    sessionId?: string;
    messages: BaseMessage[];
    systemPrompt: string;
    modelName: string;
    temperature: number;
    topP?: number;
    seedFiles?: SeedFile[];
    filesystemFiles?: SeedFile[];
    runScopeDescription?: string;
    agentFilesystemRules?: string[];
    repositoryAccess?: SandboxRepositoryAccess;
    /**
     * Optional role-specific contract for a structured final_output payload.
     * The sandbox loop validates this while the model is still in its tool
     * conversation, so an invalid payload becomes a recoverable tool error
     * rather than discarding the agent's completed sandbox work.
     */
    finalOutputContract?: SandboxFinalOutputContract;
}

export type ContextualSandboxToolAgentOptions = SandboxToolAgentOptions;

export interface SandboxRepositoryAccess {
    repositoryId: string;
    /**
     * The only repository directory this agent may write. Omit this for a
     * completely read-only repository view; agents still have private /tmp
     * scratch space for research and temporary files.
     */
    agentDirectory?: string;
    readableDirectories?: string[];
    /**
     * Descendant repository directories removed from otherwise readable parent
     * mounts. This preserves branch-local permissions when a child directory
     * belongs to a different role (for example Strategy-N/SolutionPool).
     */
    hiddenDirectories?: string[];
    /** Mount the complete repository read-only instead of selected peers. */
    fullRepositoryRead?: boolean;
    /** Reserved for the Adaptive Deepthink orchestrator's global workspace. */
    fullRepositoryWrite?: boolean;
}

export interface SandboxFinalOutputContract {
    /** Human-readable role/mode name used in tool descriptions and errors. */
    name: string;
    /** JSON Schema used for final_output.response when this role is structured. */
    responseSchema: Record<string, unknown>;
    /**
     * Validate the parsed JSON payload. Throw an Error with a correction
     * message when the payload does not match the role's accepted scheme.
     */
    validate: (payload: unknown) => void;
}

/** Creates one repository-level checkpoint. Call this only at a meaningful
 * orchestration boundary, never once per individual tool-using agent. */
export async function snapshotSandboxRepository(sessionId: string, commitMessage: string): Promise<void> {
    const response = await fetch(`${getSandboxApiBasePath()}/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, commitMessage }),
    });
    if (!response.ok) throw new Error(`Sandbox snapshot failed (${response.status}).`);
}

export async function snapshotSandboxRepositoryById(repositoryId: string, commitMessage: string): Promise<string | undefined> {
    const response = await fetch(`${getSandboxApiBasePath()}/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryId, commitMessage }),
    });
    if (!response.ok) throw new Error(`Sandbox snapshot failed (${response.status}).`);
    const payload = await response.json().catch(() => ({}));
    return payload?.commit as string | undefined;
}

/** Restore only one strategy branch to a pre-correction repository checkpoint. */
export async function restoreSandboxRepositoryStrategy(
    repositoryId: string,
    strategyDirectory: string,
    commit: string
): Promise<void> {
    const response = await fetch(`${getSandboxApiBasePath()}/repository/restore-strategy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryId, strategyDirectory, commit }),
    });
    if (!response.ok) {
        let message = `Sandbox strategy restore failed (${response.status}).`;
        try {
            const payload = await response.json();
            message = payload?.error || message;
        } catch {
            // Keep the useful HTTP-level error when the response is not JSON.
        }
        throw new Error(message);
    }
}

/** A file rendered from orchestration state into the durable Deepthink Results
 * repository. These files never enter the permission-scoped agent cache. */
export interface DeepthinkResultsContextFile {
    path: string;
    content: string;
}

/**
 * Persist a pruned full-repository mirror under Results/deepthink_timestamp
 * and commit it as one atomic Deepthink iteration. The backend owns the
 * filesystem copy so agents retain their existing cache and permissions.
 */
export async function snapshotDeepthinkResultsRepository(
    repositoryId: string,
    commitMessage: string,
    contextFiles: DeepthinkResultsContextFile[]
): Promise<void> {
    const response = await fetch(`${getSandboxApiBasePath()}/repository/results-snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryId, commitMessage, contextFiles }),
    });
    if (!response.ok) {
        let message = `Deepthink Results snapshot failed (${response.status}).`;
        try {
            const payload = await response.json();
            message = payload?.error || message;
        } catch {
            // Keep the useful HTTP-level error when the response is not JSON.
        }
        throw new Error(message);
    }
    // The Results explorer is a projection of this repository, so refresh it
    // precisely when a new Git snapshot lands—never on a polling timer.
    window.dispatchEvent(new CustomEvent('deepthinkResultsSnapshot', {
        detail: { repositoryId },
    }));
}

/** Pre-create the durable Results Git repository at the start of a sandboxed
 * Deepthink run. This does not seed or expose any agent workspace files. */
export async function ensureDeepthinkResultsRepository(repositoryId: string): Promise<void> {
    const response = await fetch(`${getSandboxApiBasePath()}/repository/ensure-deepthink`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryId }),
    });
    if (!response.ok) throw new Error(`Could not initialize Deepthink Results (${response.status}).`);
}

export interface SandboxArchivedStrategy {
    archivedDirectory?: string;
    activeDirectory: string;
}

/**
 * Archive one active Deepthink strategy directory before a PQF replacement.
 * The backend performs this repository mutation atomically so a new branch can
 * safely reuse the stable Strategy-N directory name.
 */
export async function archiveSandboxRepositoryStrategy(
    repositoryId: string,
    strategyDirectory: string
): Promise<SandboxArchivedStrategy> {
    const response = await fetch(`${getSandboxApiBasePath()}/repository/archive-strategy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryId, strategyDirectory }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Failed to archive the replaced strategy repository directory.');
    return payload as SandboxArchivedStrategy;
}

export interface SandboxFinalOutputReference {
    path: string;
    kind?: 'file' | 'image';
    label?: string;
    description?: string;
}

export interface SandboxToolAgentResult {
    text: string;
    promptText: string;
    finalText: string;
    interactionTraceText?: string;
    references?: SandboxFinalOutputReference[];
    executionTrace?: SandboxToolExecutionTrace;
    executionTraceText?: string;
    geminiContent?: {
        parts: any[];
    };
    /** Raw BaseMessage[] from this private tool loop. This is kept only for
     *  diagnostics/trace export; downstream agent histories must use promptText. */
    loopMessages?: BaseMessage[];
}

export type ContextualSandboxToolAgentResult = SandboxToolAgentResult;

export interface SandboxToolExecutionTrace {
    schema: 'sandbox_tool_execution_trace.v1';
    sandbox_tool_name: typeof SANDBOX_TOOL_NAME;
    agent: {
        name: string;
        provider: ResolvedProvider['providerName'];
        model: string;
        session_id: string;
    };
    final_text: string;
    messages: SandboxToolExecutionTraceMessage[];
}

export interface SandboxToolExecutionTraceMessage {
    role: 'assistant' | 'tool' | 'user' | 'system' | 'unknown';
    message_type: string;
    content: unknown;
    tool_calls?: unknown;
    invalid_tool_calls?: unknown;
    tool_call_id?: string;
    name?: string;
    status?: string;
    additional_kwargs?: unknown;
    response_metadata?: unknown;
    id?: string;
}

export interface SeedFile {
    name: string;
    mimeType: string;
    base64: string;
    /** Relative sandbox location, used for virtual filesystem context. */
    relativePath?: string;
}

interface SandboxToolImage {
    filename: string;
    mimeType: string;
    base64?: string;
    url: string;
    size: number;
}

interface SandboxToolResponse {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string | null;
    durationMs: number;
    timedOut?: boolean;
    images?: SandboxToolImage[];
    visibleFiles?: SandboxToolImage[];
}

interface SandboxEnvironmentProfile {
    ok?: boolean;
    agentSummary?: string;
    setupErrors?: string[];
}

const sandboxToolSchema = z.object({
    command: z.string().trim().min(1),
    timeout_ms: z.number().int().positive().max(300_000).optional()
});

const finalOutputReferenceSchema = z.object({
    path: z.string().trim().min(1),
    kind: z.enum(['file', 'image']).optional(),
    label: z.string().trim().optional(),
    description: z.string().trim().optional()
});

const finalOutputToolSchema = z.object({
    response: z.unknown(),
    references: z.array(finalOutputReferenceSchema).optional()
});

const SANDBOX_TOOL_NAME = 'sandbox_exec';
const FINAL_OUTPUT_TOOL_NAME = 'final_output';
const MAX_TOOL_TURNS = 32;
const OMIT_TRACE_VALUE = Symbol('omitTraceValue');
const REDACTED_THOUGHT_TRACE = '[thought content omitted from shared execution trace]';
let sandboxEnvironmentProfilePromise: Promise<SandboxEnvironmentProfile | null> | null = null;

const sandboxToolDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: SANDBOX_TOOL_NAME,
        description: [
            'Execute a non-interactive bash command inside the agent sandbox workspace.',
            'Use this like a real sandboxed terminal: create/read/search/edit/delete files, write and run scripts or programs, install workspace-local dependencies, run tests, use available CLI tools, and generate artifacts.',
            'Files persist in the workspace across this agent session.',
            `When the work is complete, submit the answer with ${FINAL_OUTPUT_TOOL_NAME}.`
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Bash command to run from the sandbox workspace. Use relative paths or /workspace paths for persistent files.'
                },
                timeout_ms: {
                    type: 'number',
                    description: 'Optional command timeout in milliseconds, maximum 300000.'
                }
            },
            required: ['command'],
            additionalProperties: false
        }
    }
};

function createFinalOutputToolDefinition(contract?: SandboxFinalOutputContract): ToolDefinition {
    const structuredResponse = !!contract;
    return {
        type: 'function',
        function: {
            name: FINAL_OUTPUT_TOOL_NAME,
            description: [
                'Submit the final answer or artifact for this agent call.',
                'Use this after sandbox exploration is complete. If the environment returns a validation error, correct the payload and submit it again in the same tool conversation.',
                structuredResponse
                    ? `For ${contract!.name}, response must be the role-specific JSON object described by its schema. The environment validates it and returns a tool error for correction if it is invalid.`
                    : 'The response field is the only answer that downstream agents receive.',
                'Use references to point at important generated files or images that should be rendered in the UI and made easy for later agents to locate.'
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    response: structuredResponse
                        ? contract!.responseSchema
                        : {
                            type: 'string',
                            description: 'The complete final answer, solution, critique, test result, or role-specific output to submit to the multi-agent system.'
                        },
                    references: {
                        type: 'array',
                        description: 'Optional important files or images created or used during sandbox work.',
                        items: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: 'Workspace path such as output.png, plots/result.png, /workspace/Strategy-1/result.py, or /workspace/Hypothesis-v2/Hypothesis-2/chart.png.'
                                },
                                kind: {
                                    type: 'string',
                                    enum: ['file', 'image'],
                                    description: 'Use image for renderable image files; otherwise use file.'
                                },
                                label: {
                                    type: 'string',
                                    description: 'Short display label.'
                                },
                                description: {
                                    type: 'string',
                                    description: 'Optional one-sentence description of why this artifact matters.'
                                }
                            },
                            required: ['path'],
                            additionalProperties: false
                        }
                    }
                },
                required: ['response'],
                additionalProperties: false
            }
        }
    };
}

function isImageUpload(file: { mimeType?: string }): boolean {
    return typeof file.mimeType === 'string' && file.mimeType.startsWith('image/');
}

function extensionForMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/gif':
            return '.gif';
        case 'image/webp':
            return '.webp';
        case 'image/bmp':
            return '.bmp';
        case 'image/tiff':
            return '.tiff';
        case 'text/plain':
            return '.txt';
        case 'text/csv':
            return '.csv';
        case 'application/json':
            return '.json';
        case 'application/pdf':
            return '.pdf';
        case 'image/png':
        default:
            return mimeType.startsWith('image/') ? '.png' : '.bin';
    }
}

function getDefaultSeedFiles(): SeedFile[] {
    return globalState.directContextFiles
        .map((file, index) => {
            const fileWithName = file as typeof file & { name?: string };
            const fallbackName = `uploaded-file-${index + 1}${extensionForMimeType(file.mimeType)}`;
            return {
                name: fileWithName.name || fallbackName,
                mimeType: file.mimeType,
                base64: file.base64
            };
        });
}

function getDirectContextSandboxFiles(seedFiles: SeedFile[]): SeedFile[] {
    return seedFiles.map((file, index) => {
        const fallbackName = `direct-context-file-${index + 1}${extensionForMimeType(file.mimeType)}`;
        const name = (file.name || fallbackName).replace(/[\\/]+/g, '_');
        return {
            ...file,
            name,
            relativePath: `direct_context/${name}`,
        };
    });
}

function getDefaultFilesystemFiles(): SeedFile[] {
    return globalState.filesystemContextFiles.map((file, index) => {
        const fallbackName = `uploaded-file-${index + 1}${extensionForMimeType(file.mimeType)}`;
        const name = (file.name || fallbackName).replace(/[\\/]+/g, '_');
        return {
            name,
            mimeType: file.mimeType,
            base64: file.base64,
            relativePath: `user_uploaded/${name}`,
        };
    });
}

function getProviderImageContent(
    providerName: ResolvedProvider['providerName'],
    text: string,
    files: Array<{ mimeType: string; base64: string }>
): any[] {
    const images = files.filter(isImageUpload);
    if (providerName === 'anthropic') {
        return [
            { type: 'text', text },
            ...images.map(image => ({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: image.mimeType,
                    data: image.base64
                }
            }))
        ];
    }

    if (providerName === 'gemini') {
        return [
            { text },
            // Gemini accepts inline binary parts for its supported document,
            // image, audio, and video inputs, so preserve direct uploads as
            // native inputs instead of turning them into rough text estimates.
            ...files.map(file => ({
                inlineData: {
                    mimeType: file.mimeType,
                    data: file.base64
                }
            }))
        ];
    }

    return [
        { type: 'text', text },
        ...images.map(image => ({
            type: 'image_url',
            image_url: {
                url: `data:${image.mimeType};base64,${image.base64}`
            }
        }))
    ];
}

function createImageMessage(
    providerName: ResolvedProvider['providerName'],
    text: string,
    files: Array<{ mimeType: string; base64: string }>
): HumanMessage {
    return new HumanMessage({
        content: getProviderImageContent(providerName, text, files)
    });
}

function buildUploadedFileMessage(providerName: ResolvedProvider['providerName'], files: SeedFile[]): HumanMessage | null {
    const images = files.filter(isImageUpload);
    const textFiles = files.filter(file => file.mimeType.startsWith('text/') || file.mimeType === 'application/json');
    const nativeFiles = providerName === 'gemini' ? files : images;
    if (nativeFiles.length === 0 && textFiles.length === 0) return null;

    const decodeTextFile = (file: SeedFile) => {
        try {
            const binary = atob(file.base64);
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        } catch {
            return '[Unable to decode uploaded text file]';
        }
    };

    const text = [
        'The following files are supplied directly with the Core Challenge:',
        ...files.map(file => `- ${file.name} (${file.mimeType})`),
        ...textFiles.flatMap(file => ['', `--- ${file.name} ---`, decodeTextFile(file), `--- end ${file.name} ---`]),
        '',
        nativeFiles.length ? 'Supported uploaded files are attached to this message as native inputs.' : ''
    ].join('\n');

    return createImageMessage(providerName, text, nativeFiles);
}

function buildGeneratedImageMessage(providerName: ResolvedProvider['providerName'], images: SandboxToolImage[]): HumanMessage | null {
    const attachable = images.filter(image => !!image.base64);
    if (attachable.length === 0) return null;

    const text = [
        'The sandbox command generated or updated these image files. They are attached as native vision inputs:',
        ...attachable.map(image => `- ${image.filename} (${image.mimeType})`)
    ].join('\n');

    return createImageMessage(
        providerName,
        text,
        attachable.map(image => ({
            mimeType: image.mimeType,
            base64: image.base64!
        }))
    );
}

function buildGeminiHistoryContent(displayText: string, images: SandboxToolImage[]): { parts: any[] } | undefined {
    const attachable = images.filter(image => !!image.base64);
    if (attachable.length === 0) return undefined;

    return {
        parts: [
            { text: displayText },
            ...attachable.map(image => ({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64!
                }
            }))
        ]
    };
}

function buildEnvironmentProfileText(environmentProfile: SandboxEnvironmentProfile | null): string {
    if (!environmentProfile?.agentSummary?.trim()) {
        return [
            '- Environment profile unavailable. Probe capabilities with command -v, --version, python -m pip list, npm list, or similar checks when a tool/runtime matters.',
        ].join('\n');
    }

    const lines = [environmentProfile.agentSummary.trim()];
    if (environmentProfile.setupErrors?.length) {
        lines.push(`- Setup notes: ${environmentProfile.setupErrors.join(' | ')}`);
    }
    return lines.join('\n');
}

function buildRepositoryFilesystemRules(access: SandboxRepositoryAccess): string[] {
    const readableDirectories = Array.from(new Set(access.readableDirectories || []))
        .filter(directory => directory && directory !== access.agentDirectory);
    const writableDirectory = access.agentDirectory;
    const fullRepositoryWrite = access.fullRepositoryWrite === true;
    const readableScope = fullRepositoryWrite
        ? '- You may read and write the complete repository. This is the orchestrator-only global workspace.'
        : access.fullRepositoryRead
        ? '- You may read every directory and file in this repository. The complete repository is mounted read-only except for your explicitly assigned writable directory, if any.'
        : readableDirectories.length
            ? `- You may read these peer directories, mounted read-only: ${readableDirectories.map(directory => `/workspace/${directory}`).join(', ')}.`
            : '- No peer agent directories are visible for this call.';
    const hiddenScope = (access.hiddenDirectories || []).length
        ? `- The following role-owned child directories are intentionally hidden: ${(access.hiddenDirectories || []).map(directory => `/workspace/${directory}`).join(', ')}.`
        : '';

    return [
        fullRepositoryWrite
            ? '- This run uses one shared repository mounted read/write at /workspace.'
            : writableDirectory
            ? `- This run uses a shared repository mounted at /workspace. Your writable working directory is /workspace/${writableDirectory}.`
            : '- This run uses a shared repository mounted read-only at /workspace. Your private scratch directory is /tmp.',
        fullRepositoryWrite
            ? '- Every sandbox command starts in the repository root.'
            : writableDirectory
            ? '- Every sandbox command starts inside your writable directory.'
            : '- Every sandbox command starts in the read-only repository root. Use /tmp for temporary scripts, caches, or experimental files.',
        fullRepositoryWrite
            ? '- /workspace is writable for this orchestrator session; preserve strategy branch boundaries.'
            : '- /workspace itself is read-only. You can list and read visible root files, but you cannot write in the repository root.',
        fullRepositoryWrite
            ? '- You may create, modify, and delete repository files anywhere under /workspace.'
            : writableDirectory
            ? `- You may create, modify, and delete repository files only under /workspace/${writableDirectory}.`
            : '- You may not create, modify, or delete repository files or directories. Do not mistake /tmp scratch files for shared repository artifacts.',
        '- Original direct-context files are mounted read-only at /workspace/direct_context; additional filesystem uploads are mounted read-only at /workspace/user_uploaded.',
        readableScope,
        hiddenScope,
        fullRepositoryWrite
            ? '- Changes are shared repository state. Do not overwrite branch artifacts unless the orchestration decision explicitly requires it.'
            : access.fullRepositoryRead
            ? '- Repository files outside the writable directory, if one exists, are mounted read-only. Treat them as shared evidence, not scratch space.'
            : '- Directories other than the locations listed above are not mounted into your sandbox view. Treat absent directories as unavailable context, not as empty evidence.',
        fullRepositoryWrite
            ? '- Keep strategy-local artifacts in their Strategy-N directory whenever possible.'
            : writableDirectory
            ? '- If you need to modify a readable peer file, copy it into your own writable directory first and edit the copy.'
            : '- If you need to experiment with a readable file, copy it into /tmp first and keep the repository unchanged.',
    ];
}

function buildSystemPrompt(
    systemPrompt: string,
    directFiles: SeedFile[],
    filesystemFiles: SeedFile[],
    options: SandboxToolAgentOptions,
    environmentProfile: SandboxEnvironmentProfile | null
): string {
    const directFileText = directFiles.length > 0
        ? directFiles.map(file => `- /workspace/direct_context/${file.name} (${file.mimeType})`).join('\n')
        : 'No direct-context files were uploaded.';
    const filesystemFileText = filesystemFiles.length > 0
        ? filesystemFiles.map(file => `- /workspace/${file.relativePath || file.name} (${file.mimeType})`).join('\n')
        : 'No additional filesystem files were uploaded.';
    const runScopeDescription = options.runScopeDescription || 'same contextual run';
    const agentFilesystemRules = options.agentFilesystemRules || [
        '- Main Generator keeps its own sandbox workspace across iterations.',
        '- Solution Critique / Iterative Agent keeps its own sandbox workspace across iterations.',
        '- Strategic Pool Agent keeps its own sandbox workspace across iterations.',
        '- Memory Agent keeps its own sandbox workspace across iterations.',
    ];
    const filesystemRules = options.repositoryAccess
        ? buildRepositoryFilesystemRules(options.repositoryAccess)
        : [
            ...agentFilesystemRules,
            '- These agent workspaces do not share generated files with each other. A file created by another agent is not available in your current working directory unless it is also an original uploaded file listed below.',
            '- You may load files from your own previous tool calls by filename when they appeared in your own visible_image_files or generated image outputs.',
            '- Do not try to open filenames merely because they appeared in another agent output, UI transcript, markdown image link, or critique text. If you need a similar artifact, reproduce it in your own session by rerunning equivalent code from the original uploaded image/data, then save your own copy with a clear filename.',
        ];
    const commandStartRule = options.repositoryAccess
        ? options.repositoryAccess.agentDirectory
            ? `Each sandbox command starts in /workspace/${options.repositoryAccess.agentDirectory}. Use /workspace to read visible root and peer directories.`
            : 'Each sandbox command starts in the read-only /workspace repository root. Use /tmp for private scratch work.'
        : 'Each sandbox command starts in /workspace.';

    return [
        systemPrompt,
        '',
        '<Virtual Sandbox Tool>',
        `You have two tools: ${SANDBOX_TOOL_NAME} for private terminal work and ${FINAL_OUTPUT_TOOL_NAME} for the submitted answer.`,
        `${SANDBOX_TOOL_NAME} runs one non-interactive bash command inside your sandboxed Linux workspace.`,
        'Treat this as a real terminal in a real but sandboxed project directory. You can create directories and files, write scripts or source code, run programs, inspect outputs, read files with cat/sed, search with grep/find, edit or delete workspace files, install dependencies into the workspace when possible, and generate data, plots, images, or other artifacts.',
        `${commandStartRule} Files and directories you create persist across your own tool calls and future iterations in the ${runScopeDescription}. Process memory, shell variables, and language REPL variables do not persist between separate commands; write durable state to files.`,
        'Use standard terminal practice: write scripts when commands become complex, check tool availability with command -v or --version when a runtime matters, and adapt if a language, package, or network access is unavailable.',
        '',
        '<Detected Sandbox Environment>',
        buildEnvironmentProfileText(environmentProfile),
        '</Detected Sandbox Environment>',
        '',
        'Use the tool whenever computation, verification, algorithm testing, data analysis, filesystem work, curl, image manipulation, plots, charts, or running scripts would materially improve your answer.',
        'If you would normally use a terminal, shell script, program, or command-line tool, call the sandbox tool instead of presenting unexecuted commands as if they ran.',
        'When the task explicitly asks for code execution, tests, plots, charts, image generation, or image editing, at least one real sandbox tool call is mandatory before your final response.',
        'Do not claim that commands, plots, charts, tests, or files were generated unless the sandbox tool actually did the work and returned the result.',
        '',
        'Final output discipline:',
        `- When your work is complete, call ${FINAL_OUTPUT_TOOL_NAME}. Do not end with ordinary prose when tool calling is available. If the tool returns a validation error, correct the payload and call it again.`,
        `- The ${FINAL_OUTPUT_TOOL_NAME} response is the only text submitted to the multi-agent system and the only text future agents receive as your answer.`,
        options.finalOutputContract
            ? `- This role has a structured final-output contract (${options.finalOutputContract.name}). Put the required JSON object directly in ${FINAL_OUTPUT_TOOL_NAME}.response; do not serialize it as prose or surround it with markdown. If the environment rejects it, fix only that payload and call ${FINAL_OUTPUT_TOOL_NAME} again—your sandbox research remains available.`
            : '- Submit the complete role-specific result in the final_output.response string.',
        '- Do not include private scratchpad, command transcripts, tool logs, or exploratory dead ends in the final output unless they are essential evidence for your role.',
        '- If generated files, plots, images, proofs, scripts, or data are useful, include them in final_output.references. You may also use inline markers like [[image:plot.png|Plot label]] or [[file:analysis.py|Analysis script]] inside the response.',
        '- References should point to real files visible from this sandbox. Use paths relative to your writable directory for your own files, or /workspace/<visible-directory>/<file> for visible repository files.',
        '',
        'Verification discipline:',
        '- A claim is externally verified only when the relevant command was actually executed in the sandbox and returned a successful exit code. Otherwise call it a sketch, estimate, conjecture, or unverified attempt.',
        '- For formal proofs, create the proof file and run the proof checker. If Lean/Lake is available, use lean, lake env lean, lean-check, or a Lake project command as appropriate. Do not call a Lean proof verified unless the checker exits successfully.',
        '- For compiled or interpreted programs, save the source file, run the compiler/interpreter/tests, inspect stdout/stderr and exit_code, and iterate when errors appear. Do not treat a version check or package availability check as execution of the requested program.',
        '- For generated files and images, verify by listing or opening the saved file when useful, and report the filename produced by the real command.',
        '- If verification fails because a package, theorem, import, runtime, network call, or command is unavailable, say that directly and continue with the strongest honestly supported result.',
        `You may call ${SANDBOX_TOOL_NAME} repeatedly. The application will not advance to the next agent while you are still calling tools; ${FINAL_OUTPUT_TOOL_NAME} completes this agent.`,
        'If a timeout or backend restart occurs, files already written inside your workspace may remain.',
        '',
        'Agent-scoped workspace rules:',
        ...filesystemRules,
        'Before a tool call, include a concise visible note about what you are testing or producing. After tool output returns, inspect it and decide whether another tool call is needed.',
        '',
        'Sandbox filesystem rules:',
        `- ${commandStartRule}`,
        '- Prefer relative paths or /workspace paths for persistent files.',
        '- The host filesystem outside your sandbox workspace is not mounted. Do not rely on files outside /workspace.',
        '- /tmp is also backed by your workspace for temporary command use.',
        '- Direct-context files are supplied in the initial model message and are also mounted read-only under /workspace/direct_context for sandbox processing.',
        '- Additional user uploads are mounted read-only under /workspace/user_uploaded.',
        '- Generated or modified image files with png, jpg, jpeg, gif, webp, bmp, tif, or tiff extensions are returned to you as native image inputs.',
        '- If you need to visually inspect an existing image file (e.g. from user_uploaded or generated in a previous turn), you can run the `view <filename>` or `open <filename>` command. This attaches the image natively to your next turn.',
        '- Do not print or paste base64. Refer to image files by filename.',
        '',
        'Output visibility rules:',
        '- Print concise text results, progress notes, important numbers, command results, and saved filenames so both you and the user can see what happened in Command Output.',
        '- For plots, charts, or image manipulations, save actual image files such as output.png, step_01.png, or comparison.jpg. Saved image files are displayed to the user and attached back to you as native image inputs in the next loop.',
        '- Do not print raw image bytes or base64. That is noisy and prevents useful visual inspection.',
        '- When creating multiple image iterations, save each meaningful step with a clear filename and print a short line describing that file.',
        '- Never invent, copy, or edit markdown links to /api/sandbox/files/... or /api/sandbox/artifacts/... URLs. Those are UI display URLs, not workspace files. Refer to images by filename only.',
        '- Never manually write or imitate "Tool Execution Command", "Command Output", "visible_image_files", "Generated or updated images", or similar execution transcript sections. The application inserts those sections only from real sandbox tool calls. If you need a command, output, or generated images, call the sandbox tool.',
        '',
        'Direct-context files (native model inputs and read-only sandbox files):',
        directFileText,
        '',
        'Additional user-uploaded filesystem files:',
        filesystemFileText,
        directFiles.length ? 'Direct-context files are relevant to the current task. Inspect /workspace/direct_context as needed when terminal processing would help.' : '',
        filesystemFiles.length ? 'These additional user-uploaded files are relevant to the current task. Inspect /workspace/user_uploaded as needed before drawing conclusions.' : '',
        '',
        'The sandbox includes standard Linux shell utilities and whatever runtimes, packages, and command-line tools are available in the configured environment. If something is unavailable, report that directly and continue with available tools.',
        '</Virtual Sandbox Tool>'
    ].join('\n');
}

async function invokeAgentTurn(
    provider: ResolvedProvider,
    messages: BaseMessage[],
    systemPrompt: string,
    options: SandboxToolAgentOptions
): Promise<AIMessage> {
    const finalOutputToolDefinition = createFinalOutputToolDefinition(options.finalOutputContract);
    if (provider.providerName === 'gemini') {
        return invokeGeminiToolAgentTurn(
            provider.providerConfig,
            messages,
            systemPrompt,
            [sandboxToolDefinition, finalOutputToolDefinition],
            {
                modelName: options.modelName,
                temperature: options.temperature,
                topP: options.topP
            }
        );
    }

    const model = createToolCallingAgentModel(
        provider.providerName,
        provider.providerConfig,
        {
            modelName: options.modelName,
            temperature: options.temperature,
            topP: options.topP
        }
    ).bindTools([sandboxToolDefinition, finalOutputToolDefinition]);

    return model.invoke([
        new SystemMessage(systemPrompt),
        ...messages
    ]);
}

async function executeSandboxTool(
    sessionId: string,
    command: string,
    seedFiles: SeedFile[] | null,
    repositoryAccess?: SandboxRepositoryAccess,
    timeoutMs?: number
): Promise<SandboxToolResponse> {
    const response = await fetch(`${getSandboxApiBasePath()}/execute`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sessionId,
            command,
            timeoutMs,
            repositoryAccess,
            files: seedFiles ?? undefined
        })
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload?.error || 'Sandbox backend request failed.');
    }
    return normalizeSandboxToolResponseUrls(payload as SandboxToolResponse);
}

export interface VirtualEnvironmentCommandOptions {
    sessionId: string;
    command: string;
    seedFiles?: SeedFile[];
    repositoryAccess?: SandboxRepositoryAccess;
    timeoutMs?: number;
}

/**
 * Direct terminal transport for a tool-calling orchestrator. It deliberately
 * uses the same backend session and repository access contract as sandbox_exec
 * so its files appear in the Deepthink Filesystem tab.
 */
export async function runVirtualEnvironmentCommand(
    options: VirtualEnvironmentCommandOptions
): Promise<Pick<SandboxToolResponse, 'ok' | 'exitCode' | 'stdout' | 'stderr' | 'error' | 'durationMs'>> {
    const result = await executeSandboxTool(
        options.sessionId,
        options.command,
        options.seedFiles ?? null,
        options.repositoryAccess,
        options.timeoutMs,
    );
    return {
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
        durationMs: result.durationMs,
    };
}

async function getSandboxEnvironmentProfile(): Promise<SandboxEnvironmentProfile | null> {
    if (!sandboxEnvironmentProfilePromise) {
        sandboxEnvironmentProfilePromise = fetch(`${getSandboxApiBasePath()}/environment`, {
            method: 'GET',
            headers: {
                'accept': 'application/json'
            }
        })
            .then(async response => {
                if (!response.ok) return null;
                return await response.json() as SandboxEnvironmentProfile;
            })
            .catch(() => null);
    }

    return sandboxEnvironmentProfilePromise;
}

function getSandboxApiBasePath(): string {
    const baseUrl = (import.meta as any).env?.BASE_URL || '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}/api/sandbox`;
}

function withAppBasePath(url: string): string {
    if (!url.startsWith('/api/sandbox/')) return url;
    const baseUrl = (import.meta as any).env?.BASE_URL || '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}${url}`;
}

function normalizeSandboxToolImageUrls(images?: SandboxToolImage[]): SandboxToolImage[] | undefined {
    return images?.map(image => {
        return { ...image, url: withAppBasePath(image.url) };
    });
}

function normalizeSandboxToolResponseUrls(response: SandboxToolResponse): SandboxToolResponse {
    return {
        ...response,
        images: normalizeSandboxToolImageUrls(response.images),
        visibleFiles: response.visibleFiles?.map(image => ({ ...image, url: withAppBasePath(image.url) }))
    };
}

function formatCommandBlock(command: string): string {
    return [
        '<!-- CODE_EXECUTION_START -->',
        '<!-- LANGUAGE: bash -->',
        '```bash',
        command.trimEnd(),
        '```',
        '<!-- CODE_EXECUTION_END -->'
    ].join('\n');
}

function formatOutputBlock(response: SandboxToolResponse): string {
    const lines: string[] = [];
    lines.push(`exit_code=${response.exitCode}`);
    lines.push(`duration_ms=${response.durationMs}`);

    if (response.stdout?.trim()) {
        lines.push('\nstdout:');
        lines.push(response.stdout.trimEnd());
    }

    if (response.stderr?.trim()) {
        lines.push('\nstderr:');
        lines.push(response.stderr.trimEnd());
    }

    if (response.error) {
        lines.push('\nerror:');
        lines.push(response.error.trimEnd());
    }

    if (response.visibleFiles?.length) {
        lines.push('\nvisible_image_files:');
        response.visibleFiles.forEach(file => {
            lines.push(`- ${file.filename} (${file.mimeType}, ${file.size} bytes)`);
        });
    }

    return [
        '<!-- EXECUTION_OUTPUT_START -->',
        '```',
        lines.join('\n').trimEnd(),
        '```',
        '<!-- EXECUTION_OUTPUT_END -->'
    ].join('\n');
}

function formatImageLinks(images: SandboxToolImage[]): string {
    if (images.length === 0) return '';

    return [
        'Generated or updated images:',
        ...images.map(image => `![${image.filename}](${image.url})`)
    ].join('\n');
}

function formatToolTranscript(command: string, response: SandboxToolResponse): string {
    return [
        '### Tool Execution Command',
        formatCommandBlock(command),
        '',
        '### Command Output',
        formatOutputBlock(response),
        '',
        formatImageLinks(response.images ?? [])
    ].filter(Boolean).join('\n');
}

function formatIntermediateModelOutput(text: string): string {
    return `### Intermediate Model Output\n${text}`;
}

function normalizeWorkspaceReferencePath(rawPath: string, access?: SandboxRepositoryAccess): string | null {
    const raw = rawPath.trim().replace(/\\/g, '/');
    if (!raw || raw.includes('\0')) return null;

    const fromWorkspaceRoot = raw.startsWith('/workspace/');
    const fromRelativeRoot = raw.startsWith('../');
    let normalized = raw
        .replace(/^\/workspace\/?/, '')
        .replace(/^\.\//, '');

    while (normalized.startsWith('../')) {
        normalized = normalized.slice(3);
    }

    const parts: string[] = [];
    for (const part of normalized.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') return null;
        parts.push(part);
    }

    if (parts.length === 0) return null;

    if (access && access.agentDirectory && !fromWorkspaceRoot && !fromRelativeRoot) {
        const visibleDirectories = new Set([access.agentDirectory, ...(access.readableDirectories || [])]);
        if (!access.fullRepositoryRead && !visibleDirectories.has(parts[0])) {
            parts.unshift(access.agentDirectory);
        }
    }

    return parts.join('/');
}

function encodeSandboxFileUrl(sessionId: string, relativePath: string): string {
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
    return withAppBasePath(`/api/sandbox/files/${encodeURIComponent(sessionId)}/${encodedPath}`);
}

function isImageReference(reference: SandboxFinalOutputReference): boolean {
    // Agents occasionally label an image artifact as a generic "file". The
    // actual path is authoritative here: rendering image bytes as a code file
    // both looks broken and can create an enormous text payload in the UI.
    return reference.kind === 'image' || /\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i.test(reference.path);
}

function markdownForReference(sessionId: string, reference: SandboxFinalOutputReference): string {
    const url = encodeSandboxFileUrl(sessionId, reference.path);
    const label = (reference.label || reference.path.split('/').pop() || reference.path).replace(/[\]\n\r]/g, ' ').trim();
    const description = reference.description?.trim();

    if (isImageReference(reference)) {
        return [
            `![${label}](${url})`,
            description,
        ].filter(Boolean).join('\n\n');
    }

    return description
        ? `${description}\n\n[${label}](${url})`
        : `[${label}](${url})`;
}

function normalizeFinalOutputReferences(
    references: SandboxFinalOutputReference[] | undefined,
    access?: SandboxRepositoryAccess
): SandboxFinalOutputReference[] {
    const seen = new Set<string>();
    const normalized: SandboxFinalOutputReference[] = [];

    for (const reference of references || []) {
        const path = normalizeWorkspaceReferencePath(reference.path, access);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        normalized.push({
            ...reference,
            path,
            label: reference.label?.trim() || undefined,
            description: reference.description?.trim() || undefined,
        });
    }

    return normalized;
}

function expandInlineReferenceMarkers(
    text: string,
    sessionId: string,
    access?: SandboxRepositoryAccess
): string {
    return text.replace(/\[\[(image|file):([^\]|\n\r]+)(?:\|([^\]\n\r]+))?\]\]/g, (_match, kind, rawPath, rawLabel) => {
        const path = normalizeWorkspaceReferencePath(String(rawPath), access);
        if (!path) return '';
        return markdownForReference(sessionId, {
            kind: kind === 'image' ? 'image' : 'file',
            path,
            label: rawLabel ? String(rawLabel).trim() : undefined,
        });
    });
}

function buildSubmittedFinalOutput(args: {
    finalText: string;
    references: SandboxFinalOutputReference[];
    sessionId: string;
    repositoryAccess?: SandboxRepositoryAccess;
}): string {
    const body = expandInlineReferenceMarkers(args.finalText.trim(), args.sessionId, args.repositoryAccess).trim();
    if (args.references.length === 0) return body;

    const renderedReferences = args.references.map(reference => markdownForReference(args.sessionId, reference)).join('\n\n');
    return [
        body,
        '',
        '### Referenced Artifacts',
        renderedReferences,
    ].join('\n').trim();
}

function buildInteractionTraceText(args: {
    agentName: string;
    sessionId: string;
    transcriptParts: string[];
    submittedText: string;
    finalText: string;
}): string {
    const body = args.transcriptParts.join('\n\n').trim();
    return [
        `# Multi-turn Interaction Trace`,
        '',
        `Agent: ${args.agentName}`,
        `Sandbox session: ${args.sessionId}`,
        '',
        body || 'No intermediate sandbox turns were recorded before final submission.',
        '',
        '## Submitted Artifact',
        '',
        args.submittedText || args.finalText,
    ].filter(Boolean).join('\n');
}

function getFinalText(message: AIMessage): string {
    return messageContentToText(message.content).trim();
}

function getSandboxToolCalls(message: AIMessage) {
    return (message.tool_calls ?? []).filter(toolCall => toolCall.name === SANDBOX_TOOL_NAME);
}

function getFinalOutputToolCalls(message: AIMessage) {
    return (message.tool_calls ?? []).filter(toolCall => toolCall.name === FINAL_OUTPUT_TOOL_NAME);
}

function structuredFinalOutputText(
    response: unknown,
    contract: SandboxFinalOutputContract | undefined
): string {
    if (!contract) {
        if (typeof response !== 'string' || !response.trim()) {
            throw new Error('final_output.response must be a non-empty string for this role.');
        }
        return response.trim();
    }

    let payload = response;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (error) {
            const details = error instanceof Error ? error.message : 'invalid JSON';
            throw new Error(`${contract.name} requires a JSON object in final_output.response. JSON parsing failed: ${details}`);
        }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`${contract.name} requires final_output.response to be a JSON object.`);
    }

    contract.validate(payload);
    return JSON.stringify(payload);
}

function isLikelyImageDataUri(value: string): boolean {
    return /^data:image\/[^;]+;base64,/i.test(value);
}

function redactBinaryString(value: string, label: string): string {
    return `[${label} omitted from text trace; length=${value.length}]`;
}

function normalizeTraceKey(key: string | undefined): string {
    return (key || '').replace(/[_-]+/g, '').toLowerCase();
}

function isProviderThinkingRecord(record: Record<string, unknown>): boolean {
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    return record.thought === true ||
        type === 'thinking' ||
        type === 'reasoning' ||
        type === 'redacted_thinking';
}

function hasToolPayload(record: Record<string, unknown>): boolean {
    return 'functionCall' in record ||
        'functionResponse' in record ||
        'tool_calls' in record ||
        'tool_call' in record ||
        'tool_use' in record ||
        'tool_result' in record;
}

function shouldOmitTraceField(key: string | undefined, parent?: Record<string, unknown>): boolean {
    const normalized = normalizeTraceKey(key);
    if (normalized === 'thoughtsignature' || normalized === 'thinkingsignature') return true;
    if (normalized === 'thought' && parent && isProviderThinkingRecord(parent)) return true;
    if (normalized === 'signature' && parent && isProviderThinkingRecord(parent)) return true;
    if (normalized === 'reasoningcontent' || normalized === 'thinkingcontent') return true;
    return false;
}

function scrubTraceValue(value: unknown, key?: string, parent?: Record<string, unknown>): unknown | typeof OMIT_TRACE_VALUE {
    if (shouldOmitTraceField(key, parent)) {
        return OMIT_TRACE_VALUE;
    }

    if (typeof value === 'string') {
        if (isLikelyImageDataUri(value)) {
            const mimeMatch = value.match(/^data:([^;]+);base64,/i);
            return redactBinaryString(value, `${mimeMatch?.[1] || 'image'} data URI`);
        }

        const parentMime = parent?.mimeType || parent?.mime_type || parent?.media_type;
        if (
            key === 'data' &&
            typeof parentMime === 'string' &&
            parentMime.startsWith('image/') &&
            value.length > 128
        ) {
            return redactBinaryString(value, `${parentMime} base64`);
        }

        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map(item => scrubTraceValue(item))
            .filter(item => item !== OMIT_TRACE_VALUE);
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (isProviderThinkingRecord(record) && !hasToolPayload(record)) {
            return {
                type: typeof record.type === 'string' ? record.type : 'thought',
                redacted: REDACTED_THOUGHT_TRACE,
            };
        }

        const entries: Array<[string, unknown]> = [];
        Object.entries(record).forEach(([entryKey, entryValue]) => {
            const scrubbed = scrubTraceValue(entryValue, entryKey, record);
            if (scrubbed !== OMIT_TRACE_VALUE) {
                entries.push([entryKey, scrubbed]);
            }
        });
        return Object.fromEntries(entries);
    }

    return value;
}

function messageRoleForTrace(messageType: string): SandboxToolExecutionTraceMessage['role'] {
    switch (messageType) {
        case 'ai':
            return 'assistant';
        case 'human':
            return 'user';
        case 'system':
            return 'system';
        case 'tool':
            return 'tool';
        default:
            return 'unknown';
    }
}

function messageTypeForTrace(message: BaseMessage): string {
    const getter = (message as { _getType?: () => string })._getType;
    if (typeof getter === 'function') return getter.call(message);
    return message.constructor?.name || 'unknown';
}

function buildTraceMessage(message: BaseMessage): SandboxToolExecutionTraceMessage {
    const raw = message as any;
    const messageType = messageTypeForTrace(message);
    const traced: SandboxToolExecutionTraceMessage = {
        role: messageRoleForTrace(messageType),
        message_type: messageType,
        content: scrubTraceValue(raw.content),
    };

    if (raw.tool_calls) traced.tool_calls = scrubTraceValue(raw.tool_calls);
    if (raw.invalid_tool_calls) traced.invalid_tool_calls = scrubTraceValue(raw.invalid_tool_calls);
    if (raw.tool_call_id) traced.tool_call_id = String(raw.tool_call_id);
    if (raw.name) traced.name = String(raw.name);
    if (raw.status) traced.status = String(raw.status);
    if (raw.additional_kwargs && Object.keys(raw.additional_kwargs).length > 0) traced.additional_kwargs = scrubTraceValue(raw.additional_kwargs);
    if (raw.response_metadata && Object.keys(raw.response_metadata).length > 0) traced.response_metadata = scrubTraceValue(raw.response_metadata);
    if (raw.id) traced.id = String(raw.id);

    return traced;
}

function buildExecutionTrace(args: {
    options: SandboxToolAgentOptions;
    provider: ResolvedProvider;
    sessionId: string;
    finalText: string;
    loopMessages: BaseMessage[];
}): SandboxToolExecutionTrace {
    return {
        schema: 'sandbox_tool_execution_trace.v1',
        sandbox_tool_name: SANDBOX_TOOL_NAME,
        agent: {
            name: args.options.agentName,
            provider: args.provider.providerName,
            model: args.options.modelName,
            session_id: args.sessionId,
        },
        final_text: args.finalText,
        messages: args.loopMessages.map(buildTraceMessage),
    };
}

export function isContextualSandboxToolEnabled(): boolean {
    // Uploaded files are meaningful only when agents have a sandbox in which
    // to inspect them, so either upload bucket activates the runtime per run.
    return globalState.geminiCodeExecutionEnabled
        || globalState.directContextFiles.length > 0
        || globalState.filesystemContextFiles.length > 0;
}

export async function runSandboxToolAgent(
    options: SandboxToolAgentOptions
): Promise<SandboxToolAgentResult> {
    const provider = resolveProviderForModel(options.modelName);
    if (!provider.providerConfig?.isConfigured || !provider.providerConfig.apiKey) {
        throw new Error(`No configured provider found for model: ${options.modelName}`);
    }

    const seedFiles = options.seedFiles ?? getDefaultSeedFiles();
    const filesystemFiles = options.filesystemFiles ?? getDefaultFilesystemFiles();
    const directContextSandboxFiles = getDirectContextSandboxFiles(seedFiles);
    const sessionId = options.sessionId ?? `ctx-${options.agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nanoid(12)}`;
    const environmentProfile = await getSandboxEnvironmentProfile();
    const systemPrompt = buildSystemPrompt(options.systemPrompt, directContextSandboxFiles, filesystemFiles, options, environmentProfile);
    const messages = [...options.messages];
    const transcriptParts: string[] = [];
    const historyImages = new Map<string, SandboxToolImage>();
    let finalText = '';
    let finalReferences: SandboxFinalOutputReference[] = [];
    let shouldSeedBackend = true;

    const uploadedFileMessage = buildUploadedFileMessage(provider.providerName, seedFiles);
    if (uploadedFileMessage) {
        messages.push(uploadedFileMessage);
    }

    // Mark where the tool loop starts so we can capture the raw messages afterwards
    const loopStartIndex = messages.length;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await invokeAgentTurn(provider, messages, systemPrompt, options);
        messages.push(response);

        const modelText = getFinalText(response);
        const sandboxToolCalls = getSandboxToolCalls(response);
        const finalOutputToolCalls = getFinalOutputToolCalls(response);
        const hasToolCalls = sandboxToolCalls.length > 0 || finalOutputToolCalls.length > 0;

        if (modelText) {
            transcriptParts.push(
                hasToolCalls
                    ? (transcriptParts.length === 0 ? modelText : formatIntermediateModelOutput(modelText))
                    : modelText
            );
        }

        if (finalOutputToolCalls.length > 0) {
            const toolCall = finalOutputToolCalls[0];
            try {
                const parsed = finalOutputToolSchema.parse(toolCall.args ?? {});
                finalText = structuredFinalOutputText(parsed.response, options.finalOutputContract);
                finalReferences = normalizeFinalOutputReferences(parsed.references, options.repositoryAccess);
                break;
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Invalid final output payload.';
                messages.push(new ToolMessage({
                    name: FINAL_OUTPUT_TOOL_NAME,
                    content: [
                        `final_output was not accepted: ${reason}`,
                        options.finalOutputContract
                            ? `Correct the ${options.finalOutputContract.name} JSON object and call ${FINAL_OUTPUT_TOOL_NAME} again. Your previous sandbox work and conversation are still available.`
                            : `Correct the payload and call ${FINAL_OUTPUT_TOOL_NAME} again. Your previous sandbox work and conversation are still available.`
                    ].join('\n'),
                    tool_call_id: toolCall.id ?? nanoid(8),
                    status: 'error'
                }));
                continue;
            }
        }

        if (sandboxToolCalls.length === 0) {
            messages.push(new HumanMessage(
                modelText
                    ? `Your previous response was ordinary prose, so it was not submitted. Submit the complete role-specific answer now by calling ${FINAL_OUTPUT_TOOL_NAME}.`
                    : `Submit the complete role-specific answer now by calling ${FINAL_OUTPUT_TOOL_NAME}.`
            ));
            continue;
        }

        for (const toolCall of sandboxToolCalls) {
            let parsedCommand = '';
            let toolResponse: SandboxToolResponse;

            try {
                const parsed = sandboxToolSchema.parse(toolCall.args ?? {});
                parsedCommand = parsed.command;
                toolResponse = await executeSandboxTool(
                    sessionId,
                    parsedCommand,
                    shouldSeedBackend ? [...directContextSandboxFiles, ...filesystemFiles] : null,
                    options.repositoryAccess,
                    parsed.timeout_ms
                );
                shouldSeedBackend = false;
            } catch (error) {
                toolResponse = {
                    ok: false,
                    exitCode: 1,
                    stdout: '',
                    stderr: '',
                    error: error instanceof Error ? error.message : 'Sandbox tool call failed.',
                    durationMs: 0,
                    images: [],
                    visibleFiles: []
                };
            }

            transcriptParts.push(formatToolTranscript(parsedCommand || '[Invalid or missing sandbox command]', toolResponse));
            (toolResponse.images ?? []).forEach(image => {
                if (image.base64) {
                    historyImages.set(image.filename, image);
                }
            });

            const toolContent = [
                `Sandbox command ${toolResponse.ok ? 'completed' : 'failed'}.`,
                `exit_code=${toolResponse.exitCode}`,
                `duration_ms=${toolResponse.durationMs}`,
                toolResponse.stdout?.trim() ? `stdout:\n${toolResponse.stdout.trimEnd()}` : '',
                toolResponse.stderr?.trim() ? `stderr:\n${toolResponse.stderr.trimEnd()}` : '',
                toolResponse.error ? `error:\n${toolResponse.error.trimEnd()}` : '',
                toolResponse.visibleFiles?.length
                    ? `visible_image_files:\n${toolResponse.visibleFiles.map(file => `- ${file.filename} (${file.mimeType})`).join('\n')}`
                    : 'visible_image_files: none',
                toolResponse.images?.length
                    ? 'Generated or updated images are attached as native vision inputs in the following user message.'
                    : ''
            ].filter(Boolean).join('\n\n');

            messages.push(new ToolMessage({
                name: SANDBOX_TOOL_NAME,
                content: toolContent,
                tool_call_id: toolCall.id ?? nanoid(8),
                status: toolResponse.ok ? 'success' : 'error'
            }));

            const generatedImageMessage = buildGeneratedImageMessage(provider.providerName, toolResponse.images ?? []);
            if (generatedImageMessage) {
                messages.push(generatedImageMessage);
            }
        }
    }

    if (!finalText) {
        throw new Error(`${options.agentName} exceeded ${MAX_TOOL_TURNS} sandbox tool turns without submitting final_output.`);
    }

    const submittedText = buildSubmittedFinalOutput({
        finalText,
        references: finalReferences,
        sessionId,
        repositoryAccess: options.repositoryAccess,
    });
    const displayText = submittedText || transcriptParts.join('\n\n').trim();
    const interactionTraceText = buildInteractionTraceText({
        agentName: options.agentName,
        sessionId,
        transcriptParts,
        submittedText,
        finalText,
    });

    // Capture raw messages only for diagnostics. These must not be replayed
    // into downstream agent histories; promptText is the submitted answer.
    const loopMessages = messages.slice(loopStartIndex);
    const executionTrace = buildExecutionTrace({
        options,
        provider,
        sessionId,
        finalText,
        loopMessages,
    });

    return {
        text: displayText,
        promptText: submittedText || finalText,
        finalText,
        interactionTraceText,
        references: finalReferences,
        executionTrace,
        executionTraceText: JSON.stringify(executionTrace, null, 2),
        geminiContent: provider.providerName === 'gemini'
            ? buildGeminiHistoryContent(displayText, [...historyImages.values()])
            : undefined,
        loopMessages
    };
}

export async function runContextualSandboxToolAgent(
    options: ContextualSandboxToolAgentOptions
): Promise<ContextualSandboxToolAgentResult> {
    return runSandboxToolAgent(options);
}
