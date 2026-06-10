/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDefinition } from '@langchain/core/language_models/base';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { globalState } from '../Core/State';
import {
    createToolCallingAgentModel,
    invokeGeminiToolAgentTurn,
    messageContentToText,
    resolveProviderForModel,
    type ResolvedProvider
} from '../Core/LangGraphToolRuntime';

export interface PythonToolAgentOptions {
    agentName: string;
    sessionId?: string;
    messages: BaseMessage[];
    systemPrompt: string;
    modelName: string;
    temperature: number;
    topP?: number;
    seedImages?: SeedImage[];
    runScopeDescription?: string;
    agentFilesystemRules?: string[];
}

export type ContextualPythonToolAgentOptions = PythonToolAgentOptions;

export interface PythonToolAgentResult {
    text: string;
    promptText: string;
    finalText: string;
    executionTrace?: PythonToolExecutionTrace;
    executionTraceText?: string;
    geminiContent?: {
        parts: any[];
    };
    /** Raw BaseMessage[] from the tool loop. When stored in history and replayed
     *  in the next iteration, the model sees its own native tool calls/responses
     *  exactly as they happened — so it naturally continues making tool calls. */
    loopMessages?: BaseMessage[];
}

export type ContextualPythonToolAgentResult = PythonToolAgentResult;

export interface PythonToolExecutionTrace {
    schema: 'python_tool_execution_trace.v1';
    python_tool_name: typeof PYTHON_TOOL_NAME;
    agent: {
        name: string;
        provider: ResolvedProvider['providerName'];
        model: string;
        session_id: string;
    };
    final_text: string;
    messages: PythonToolExecutionTraceMessage[];
}

export interface PythonToolExecutionTraceMessage {
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

export interface SeedImage {
    name: string;
    mimeType: string;
    base64: string;
}

interface PythonToolImage {
    filename: string;
    mimeType: string;
    base64?: string;
    url: string;
    size: number;
}

interface PythonToolResponse {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string | null;
    durationMs: number;
    timedOut?: boolean;
    images?: PythonToolImage[];
    viewedImages?: PythonToolImage[];
    visibleFiles?: PythonToolImage[];
}

const pythonToolSchema = z.object({
    code: z.string().trim().min(1)
});

const PYTHON_TOOL_NAME = 'python_virtual_filesystem';
const MAX_TOOL_TURNS = 32;
const OMIT_TRACE_VALUE = Symbol('omitTraceValue');
const REDACTED_THOUGHT_TRACE = '[thought content omitted from shared execution trace]';

const pythonToolDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: PYTHON_TOOL_NAME,
        description: [
            'Execute Python code inside the agent virtual filesystem.',
            'Use this for calculations, simulations, algorithm tests, image inspection, image manipulation, plots, and charts.',
            'Uploaded images and generated image files are available by filename in the current working directory.',
            'Return final prose normally after tool work is complete.'
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Python code to execute. Use relative paths for virtual filesystem image files.'
                }
            },
            required: ['code'],
            additionalProperties: false
        }
    }
};

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
        case 'image/png':
        default:
            return '.png';
    }
}

function getDefaultSeedImages(): SeedImage[] {
    return globalState.currentProblemImages
        .filter(isImageUpload)
        .map((file, index) => {
            const fileWithName = file as typeof file & { name?: string };
            const fallbackName = `uploaded-image-${index + 1}${extensionForMimeType(file.mimeType)}`;
            return {
                name: fileWithName.name || fallbackName,
                mimeType: file.mimeType,
                base64: file.base64
            };
        });
}

function getProviderImageContent(
    providerName: ResolvedProvider['providerName'],
    text: string,
    images: Array<{ mimeType: string; base64: string }>
): any[] {
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
            ...images.map(image => ({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64
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
    images: Array<{ mimeType: string; base64: string }>
): HumanMessage {
    return new HumanMessage({
        content: getProviderImageContent(providerName, text, images)
    });
}

function buildUploadedImageMessage(providerName: ResolvedProvider['providerName'], images: SeedImage[]): HumanMessage | null {
    if (images.length === 0) return null;

    const text = [
        'Uploaded image files are available in the Python virtual filesystem with these filenames:',
        ...images.map(image => `- ${image.name} (${image.mimeType})`),
        '',
        'The same uploaded images are attached to this message as native vision inputs.'
    ].join('\n');

    return createImageMessage(providerName, text, images);
}

function buildGeneratedImageMessage(providerName: ResolvedProvider['providerName'], images: PythonToolImage[]): HumanMessage | null {
    const attachable = images.filter(image => !!image.base64);
    if (attachable.length === 0) return null;

    const text = [
        'Python generated or updated these image files. They are attached as native vision inputs:',
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

function buildViewedImageMessage(providerName: ResolvedProvider['providerName'], images: PythonToolImage[]): HumanMessage | null {
    const attachable = images.filter(image => !!image.base64);
    if (attachable.length === 0) return null;

    const text = [
        'Python opened or viewed these existing image files. They are attached as native vision inputs:',
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

function buildGeminiHistoryContent(displayText: string, images: PythonToolImage[]): { parts: any[] } | undefined {
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

function buildSystemPrompt(systemPrompt: string, seedImages: SeedImage[], options: PythonToolAgentOptions): string {
    const seedFileText = seedImages.length > 0
        ? seedImages.map(image => `- ${image.name} (${image.mimeType})`).join('\n')
        : 'No uploaded image files are currently mounted.';
    const runScopeDescription = options.runScopeDescription || 'same contextual run';
    const agentFilesystemRules = options.agentFilesystemRules || [
        '- Main Generator keeps its own Python memory and virtual filesystem across iterations.',
        '- Solution Critique / Iterative Agent keeps its own Python memory and virtual filesystem across iterations.',
        '- Strategic Pool Agent keeps its own Python memory and virtual filesystem across iterations.',
        '- Memory Agent keeps its own Python memory and virtual filesystem across iterations.',
    ];

    return [
        systemPrompt,
        '',
        '<Python Virtual Filesystem Tool>',
        `You have exactly one executable tool: ${PYTHON_TOOL_NAME}.`,
        'Use it whenever computation, verification, algorithm testing, data analysis, image inspection, image manipulation, plots, or charts would materially improve your answer.',
        'If you would write Python code to compute, verify, inspect, or generate an artifact, call the Python tool with that code instead of presenting it as a markdown code block.',
        'When the task explicitly asks for code execution, plots, charts, image generation, or image editing, at least one real Python tool call is mandatory before your final response.',
        'Do not claim that plots, charts, or files were generated unless the Python tool actually created them and returned their filenames.',
        'You may call the tool repeatedly. The application will not advance to the next agent while you are still calling tools; only your final no-tool model turn completes this agent.',
        `Your Python session is persistent for this agent: variables, imports, functions, classes, and generated image files remain available across your own tool calls and future iterations in the ${runScopeDescription}.`,
        'Each agent gets an isolated Python session, so do not assume variables from other agents exist. If a timeout or backend restart occurs, Python variables/imports may be cleared, but virtual filesystem image files can still remain.',
        '',
        'Agent-scoped virtual filesystem rules:',
        ...agentFilesystemRules,
        '- These agent filesystems do not share generated files with each other. A file created by another agent is not available in your current working directory unless it is also an original uploaded file listed below.',
        '- You may load files from your own previous tool calls by filename when they appeared in your own visible_image_files or generated image outputs.',
        '- Do not try to open filenames merely because they appeared in another agent output, UI transcript, markdown image link, or critique text. If you need a similar artifact, reproduce it in your own session by rerunning equivalent code from the original uploaded image/data, then save your own copy with a clear filename.',
        '',
        'Soft-clearing Python memory:',
        '- To clear stale Python memory, call exactly reset_python_session() inside a Python tool call. clear_python_memory() is an equivalent alias.',
        '- Soft clearing removes user-defined names from this agent session: variables such as df or summary, imported module bindings such as pd/np/plt/sns, helper functions, classes, and cached objects.',
        '- Soft clearing preserves the virtual filesystem: image files, uploaded files, generated plots, CSVs, and other files remain in the same working directory. It does not delete, rename, or modify files. It also returns the current working directory to the virtual filesystem root.',
        '- After soft clearing, immediately reimport libraries and reload/recreate every variable you still need. Do not call reset_python_session() and then expect earlier imports or variables to remain available.',
        '- Use soft clearing when prior state may be stale, partially failed, shadowed, based on an old dataset/image, or when you want future code to be clean and self-contained. Do not use it when you intentionally need variables from earlier successful tool calls.',
        'Before a tool call, include a concise visible note about what you are testing or producing. After tool output returns, inspect it and decide whether another tool call is needed.',
        '',
        'Virtual filesystem rules:',
        '- Use relative filenames only.',
        '- Each Python tool call starts in this agent session\'s virtual filesystem root. os.chdir(...) is allowed only within that workspace; changing to /tmp, /mnt/data, or other external directories is blocked.',
        '- Uploaded image files are mounted in the current working directory.',
        '- Generated or modified image files with png, jpg, jpeg, gif, webp, bmp, tif, or tiff extensions are returned to you as native image inputs.',
        '- Do not print or paste base64. Refer to image files by filename.',
        '- The current contract is image-focused; do not rely on creating markdown, shell scripts, or other non-image files as durable artifacts.',
        '',
        'Output visibility rules:',
        '- Print concise text results, progress notes, important numbers, and saved filenames with print() so both you and the user can see what happened in Code Output.',
        '- For plots, charts, or image manipulations, save actual image files such as output.png, step_01.png, or comparison.jpg. Saved image files are displayed to the user and attached back to you as native image inputs in the next loop.',
        '- When you open/read an existing image with common image APIs such as PIL.Image.open(...) or cv2.imread(...), that viewed image is also displayed to the user and attached back to you as a native image input, even if you did not modify it.',
        '- Do not print raw image bytes or base64. That is noisy and prevents useful visual inspection.',
        '- When creating multiple image iterations, save each meaningful step with a clear filename and print a short line describing that file.',
        '- Never invent, copy, or edit markdown links to /api/python/files/... or /api/python/artifacts/... URLs. Those are UI display URLs, not Python files. Refer to images by filename only.',
        '- Never manually write or imitate "Tool Execution Code", "Code Output", "visible_image_files", "Generated or updated images", or similar execution transcript sections. The application inserts those sections only from real Python tool calls. If you need code, output, or generated images, call the Python tool.',
        '',
        'Mounted image files:',
        seedFileText,
        '',
        'Configured Python libraries include the standard library plus the scientific/image stack from Backend/Python_Environment/requirements.txt: numpy, scipy, pandas, matplotlib, sympy, pillow/PIL, scikit-image, opencv-python/cv2, seaborn, networkx, statsmodels, scikit-learn, plotly, imageio, beautifulsoup4, lxml, pyyaml, and requests. If an import is unavailable in the active local interpreter, report that directly and continue with available tools.',
        '</Python Virtual Filesystem Tool>'
    ].join('\n');
}

async function invokeAgentTurn(
    provider: ResolvedProvider,
    messages: BaseMessage[],
    systemPrompt: string,
    options: PythonToolAgentOptions
): Promise<AIMessage> {
    if (provider.providerName === 'gemini') {
        return invokeGeminiToolAgentTurn(
            provider.providerConfig,
            messages,
            systemPrompt,
            [pythonToolDefinition],
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
    ).bindTools([pythonToolDefinition]);

    return model.invoke([
        new SystemMessage(systemPrompt),
        ...messages
    ]);
}

async function executePythonTool(
    sessionId: string,
    code: string,
    seedImages: SeedImage[] | null
): Promise<PythonToolResponse> {
    const response = await fetch(`${getPythonApiBasePath()}/execute`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sessionId,
            code,
            files: seedImages ?? undefined
        })
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload?.error || 'Python backend request failed.');
    }
    return normalizePythonToolResponseUrls(payload as PythonToolResponse);
}

function getPythonApiBasePath(): string {
    const baseUrl = import.meta.env.BASE_URL || '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}/api/python`;
}

function withAppBasePath(url: string): string {
    if (!url.startsWith('/api/python/')) return url;
    const baseUrl = import.meta.env.BASE_URL || '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}${url}`;
}

function normalizePythonToolImageUrls(images?: PythonToolImage[]): PythonToolImage[] | undefined {
    return images?.map(image => {
        return { ...image, url: withAppBasePath(image.url) };
    });
}

function normalizePythonToolResponseUrls(response: PythonToolResponse): PythonToolResponse {
    return {
        ...response,
        images: normalizePythonToolImageUrls(response.images),
        viewedImages: normalizePythonToolImageUrls(response.viewedImages),
        visibleFiles: response.visibleFiles?.map(image => ({ ...image, url: withAppBasePath(image.url) }))
    };
}

function formatCodeBlock(code: string): string {
    return [
        '<!-- CODE_EXECUTION_START -->',
        '<!-- LANGUAGE: python -->',
        '```python',
        code.trimEnd(),
        '```',
        '<!-- CODE_EXECUTION_END -->'
    ].join('\n');
}

function formatOutputBlock(response: PythonToolResponse): string {
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

function formatImageLinks(images: PythonToolImage[]): string {
    if (images.length === 0) return '';

    return [
        'Generated or updated images:',
        ...images.map(image => `![${image.filename}](${image.url})`)
    ].join('\n');
}

function formatViewedImageLinks(response: PythonToolResponse): string {
    const generated = new Set((response.images ?? []).map(image => image.filename));
    const viewedOnly = (response.viewedImages ?? []).filter(image => !generated.has(image.filename));
    if (viewedOnly.length === 0) return '';

    return [
        'Viewed images:',
        ...viewedOnly.map(image => `![${image.filename}](${image.url})`)
    ].join('\n');
}

function formatToolTranscript(code: string, response: PythonToolResponse): string {
    return [
        '### Tool Execution Code (Python)',
        formatCodeBlock(code),
        '',
        '### Code Output',
        formatOutputBlock(response),
        '',
        formatImageLinks(response.images ?? []),
        '',
        formatViewedImageLinks(response)
    ].filter(Boolean).join('\n');
}

function formatIntermediateModelOutput(text: string): string {
    return `### Intermediate Model Output\n${text}`;
}

function getFinalText(message: AIMessage): string {
    return messageContentToText(message.content).trim();
}

function getToolCalls(message: AIMessage) {
    return (message.tool_calls ?? []).filter(toolCall => toolCall.name === PYTHON_TOOL_NAME);
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

function messageRoleForTrace(messageType: string): PythonToolExecutionTraceMessage['role'] {
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

function buildTraceMessage(message: BaseMessage): PythonToolExecutionTraceMessage {
    const raw = message as any;
    const messageType = messageTypeForTrace(message);
    const traced: PythonToolExecutionTraceMessage = {
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
    options: PythonToolAgentOptions;
    provider: ResolvedProvider;
    sessionId: string;
    finalText: string;
    loopMessages: BaseMessage[];
}): PythonToolExecutionTrace {
    return {
        schema: 'python_tool_execution_trace.v1',
        python_tool_name: PYTHON_TOOL_NAME,
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

export function isContextualPythonToolEnabled(): boolean {
    return globalState.geminiCodeExecutionEnabled;
}

export async function runPythonToolAgent(
    options: PythonToolAgentOptions
): Promise<PythonToolAgentResult> {
    const provider = resolveProviderForModel(options.modelName);
    if (!provider.providerConfig?.isConfigured || !provider.providerConfig.apiKey) {
        throw new Error(`No configured provider found for model: ${options.modelName}`);
    }

    const seedImages = options.seedImages ?? getDefaultSeedImages();
    const sessionId = options.sessionId ?? `ctx-${options.agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nanoid(12)}`;
    const systemPrompt = buildSystemPrompt(options.systemPrompt, seedImages, options);
    const messages = [...options.messages];
    const transcriptParts: string[] = [];
    const historyImages = new Map<string, PythonToolImage>();
    let finalText = '';
    let shouldSeedBackend = true;

    const uploadedImageMessage = buildUploadedImageMessage(provider.providerName, seedImages);
    if (uploadedImageMessage) {
        messages.push(uploadedImageMessage);
    }

    // Mark where the tool loop starts so we can capture the raw messages afterwards
    const loopStartIndex = messages.length;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await invokeAgentTurn(provider, messages, systemPrompt, options);
        messages.push(response);

        const modelText = getFinalText(response);
        const toolCalls = getToolCalls(response);

        if (modelText) {
            transcriptParts.push(
                toolCalls.length > 0
                    ? (transcriptParts.length === 0 ? modelText : formatIntermediateModelOutput(modelText))
                    : modelText
            );
        }

        if (toolCalls.length === 0) {
            finalText = modelText;
            break;
        }

        for (const toolCall of toolCalls) {
            let parsedCode = '';
            let toolResponse: PythonToolResponse;

            try {
                parsedCode = pythonToolSchema.parse(toolCall.args ?? {}).code;
                toolResponse = await executePythonTool(
                    sessionId,
                    parsedCode,
                    shouldSeedBackend ? seedImages : null
                );
                shouldSeedBackend = false;
            } catch (error) {
                toolResponse = {
                    ok: false,
                    exitCode: 1,
                    stdout: '',
                    stderr: '',
                    error: error instanceof Error ? error.message : 'Python tool call failed.',
                    durationMs: 0,
                    images: [],
                    viewedImages: [],
                    visibleFiles: []
                };
            }

            transcriptParts.push(formatToolTranscript(parsedCode || '[Invalid or missing Python code]', toolResponse));
            const generatedImageNames = new Set((toolResponse.images ?? []).map(image => image.filename));
            const viewedOnlyImages = (toolResponse.viewedImages ?? []).filter(image => !generatedImageNames.has(image.filename));
            [...(toolResponse.images ?? []), ...viewedOnlyImages].forEach(image => {
                if (image.base64) {
                    historyImages.set(image.filename, image);
                }
            });

            const toolContent = [
                `Python execution ${toolResponse.ok ? 'completed' : 'failed'}.`,
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
                    : '',
                viewedOnlyImages.length
                    ? 'Opened/viewed existing images are attached as native vision inputs in the following user message.'
                    : ''
            ].filter(Boolean).join('\n\n');

            messages.push(new ToolMessage({
                name: PYTHON_TOOL_NAME,
                content: toolContent,
                tool_call_id: toolCall.id ?? nanoid(8),
                status: toolResponse.ok ? 'success' : 'error'
            }));

            const generatedImageMessage = buildGeneratedImageMessage(provider.providerName, toolResponse.images ?? []);
            if (generatedImageMessage) {
                messages.push(generatedImageMessage);
            }

            const viewedImageMessage = buildViewedImageMessage(provider.providerName, viewedOnlyImages);
            if (viewedImageMessage) {
                messages.push(viewedImageMessage);
            }
        }
    }

    if (!finalText) {
        throw new Error(`${options.agentName} exceeded ${MAX_TOOL_TURNS} Python tool turns without producing a final no-tool response.`);
    }

    const displayText = transcriptParts.join('\n\n').trim();

    // Capture the raw messages from this iteration's tool loop.
    // These are replayed verbatim in the next iteration so the model
    // sees its own native tool calls/responses — not a text approximation.
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
        promptText: finalText,
        finalText,
        executionTrace,
        executionTraceText: JSON.stringify(executionTrace, null, 2),
        geminiContent: provider.providerName === 'gemini'
            ? buildGeminiHistoryContent(displayText, [...historyImages.values()])
            : undefined,
        loopMessages
    };
}

export async function runContextualPythonToolAgent(
    options: ContextualPythonToolAgentOptions
): Promise<ContextualPythonToolAgentResult> {
    return runPythonToolAgent(options);
}
