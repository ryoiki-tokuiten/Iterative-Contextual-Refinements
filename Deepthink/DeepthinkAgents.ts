/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Exported Deepthink Agents for reuse in other modes
 * These agents are independent API calls without conversation history
 */

import { Part, GenerateContentResponse } from "@google/genai";
import { describeProviderError } from '../Core/ProviderError';

// Agent response interface
export interface AgentResponse {
    success: boolean;
    data?: any;
    error?: string;
    rawResponse?: string;
}

// Agent execution context
export interface AgentExecutionContext {
    callAI: (parts: Part[], temperature: number, modelToUse: string, systemInstruction?: string, isJson?: boolean, topP?: number) => Promise<GenerateContentResponse>;
    cleanOutputByType: (rawOutput: string, type?: string) => string;
    parseJsonSafe: (raw: string, context: string) => any;
    getSelectedTemperature: () => number;
    getSelectedModel: () => string;
    getSelectedTopP: () => number;
    /**
     * Optional transport used by modes that run these shared roles inside the
     * Deepthink sandbox. Keeping the agent contracts here lets Adaptive
     * Deepthink reuse the exact same prompts/parsers without duplicating a
     * second set of agents.
     */
    runPrompt?: (args: {
        promptText: string;
        systemPrompt: string;
        isJson: boolean;
        images: ImageInput;
    }) => Promise<string>;
}

// ========== SHARED HELPERS ==========

type ImageInput = Array<{ base64: string; mimeType: string }>;

/** Builds prompt parts array: images (in order) followed by text. */
function buildPromptParts(text: string, images: ImageInput): Part[] {
    return [
        ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        { text }
    ];
}

/** Appends optional special context XML block to a prompt string. */
function appendContext(prompt: string, specialContext: string): string {
    return specialContext
        ? `${prompt}\n\n<Special Context>\n${specialContext}\n</Special Context>`
        : prompt;
}

function buildStrategyPrompt(question: string, numStrategies: number): string {
    return `Core Challenge: ${question}

Generate exactly ${numStrategies} distinct high-level strategic interpretations. Return JSON with a "strategies" array. Do not solve the challenge.`;
}

function buildHypothesisGenerationPrompt(question: string, numHypotheses: number, allowFewer = false): string {
    return `Core Challenge: ${question}

Generate ${allowFewer ? `up to ${numHypotheses}` : `exactly ${numHypotheses}`} hypotheses worth testing. Return JSON with a "hypotheses" array. Do not solve the challenge.`;
}

function buildHypothesisTestingPrompt(question: string, hypothesis: string): string {
    return `Core Challenge: ${question}

<Hypothesis To Test>
${hypothesis}
</Hypothesis To Test>

Test only this hypothesis. Return the full investigation and final classification.`;
}

function buildExecutionPrompt(question: string, strategy: string, informationPacket: string): string {
    return `Core Challenge: ${question}

<Assigned Strategy>
${strategy}
</Assigned Strategy>

<Information Packet>
${informationPacket}
</Information Packet>

Execute the assigned strategy faithfully and completely.`;
}

function buildCritiquePrompt(question: string, strategy: string, execution: string): string {
    return `Core Challenge: ${question}

<Assigned Strategy>
${strategy}
</Assigned Strategy>

<Solution Attempt>
${execution}
</Solution Attempt>

Critique the solution attempt. Identify errors, gaps, unjustified claims, and strategy-fidelity issues. Do not fix the solution.`;
}

function buildCorrectionPrompt(question: string, strategy: string, execution: string, critique: string): string {
    return `Core Challenge: ${question}

<Assigned Strategy>
${strategy}
</Assigned Strategy>

<Previous Solution Attempt>
${execution}
</Previous Solution Attempt>

<Critique>
${critique}
</Critique>

Produce a corrected solution that addresses the critique while remaining faithful to the assigned strategy.`;
}

function buildFinalJudgePrompt(question: string, allSolutions: string): string {
    return `Core Challenge: ${question}

<Candidate Solutions>
${allSolutions}
</Candidate Solutions>

Select the best solution and return it clearly.`;
}

/** Executes a single AI call: builds parts, calls the model, cleans output. */
async function callAgent(
    promptText: string,
    images: ImageInput,
    context: AgentExecutionContext,
    systemPrompt: string,
    isJson: boolean
): Promise<string> {
    if (context.runPrompt) {
        return context.runPrompt({
            promptText,
            systemPrompt,
            isJson,
            images,
        });
    }

    const response = await context.callAI(
        buildPromptParts(promptText, images),
        context.getSelectedTemperature(),
        context.getSelectedModel(),
        systemPrompt,
        isJson,
        context.getSelectedTopP()
    );
    return context.cleanOutputByType(response.text || '', isJson ? 'json' : undefined);
}

function buildProximityPrompt(
    kind: 'strategies' | 'hypotheses',
    question: string,
    candidates: string[],
    conversationHistory: string
): string {
    const label = kind === 'strategies' ? 'Strategy' : 'Hypothesis';
    return `Core Challenge: ${question}

<Current ${label} Candidates>
${candidates.map((candidate, index) => `<${label} ${index + 1}>\n${candidate}\n</${label} ${index + 1}>`).join('\n\n')}
</Current ${label} Candidates>

<Generator Proximity History>
${conversationHistory || 'This is the first proximity review.'}
</Generator Proximity History>

Act as the ${kind === 'strategies' ? 'Strategies' : 'Hypothesis'} Proximity Agent. Audit the candidate set for convergence, duplication, missing orthogonal domains, structural blind spots, untested assumptions, and local-minimum behavior. Be demanding and specific. Do not solve the core challenge and do not rewrite the candidates. Return a concise critique that a generator can use for its next revision.`;
}

/** Wraps an async agent body with standard error handling. */
async function wrapAgent(fn: () => Promise<AgentResponse>): Promise<AgentResponse> {
    try {
        return await fn();
    } catch (error) {
        return { success: false, error: describeProviderError(error) };
    }
}

// ========== AGENT IMPLEMENTATIONS ==========

/**
 * Generate Strategies Agent
 * Generates N high-level strategic interpretations for a problem
 */
export async function generateStrategiesAgent(
    question: string,
    numStrategies: number,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const prompt = appendContext(buildStrategyPrompt(question, numStrategies), specialContext);
        const rawText = await callAgent(prompt, images, context, systemPrompt, true);
        const parsed = context.parseJsonSafe(rawText, 'GenerateStrategies');

        if (!parsed || !Array.isArray(parsed.strategies)) {
            return { success: false, error: 'Failed to parse strategies from response', rawResponse: rawText };
        }
        return { success: true, data: { strategies: parsed.strategies }, rawResponse: rawText };
    });
}

/**
 * Generate Hypotheses Agent
 * Generates N hypotheses for testing
 */
export async function generateHypothesesAgent(
    question: string,
    numHypotheses: number,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = [],
    allowFewer = false
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const prompt = appendContext(buildHypothesisGenerationPrompt(question, numHypotheses, allowFewer), specialContext);
        const rawText = await callAgent(prompt, images, context, systemPrompt, true);
        const parsed = context.parseJsonSafe(rawText, 'GenerateHypotheses');

        if (!parsed || !Array.isArray(parsed.hypotheses)) {
            return { success: false, error: 'Failed to parse hypotheses from response', rawResponse: rawText };
        }
        return { success: true, data: { hypotheses: parsed.hypotheses }, rawResponse: rawText };
    });
}

/**
 * Independent adversarial proximity review for a strategy batch. The
 * generator owns revisions; this role only diagnoses weak diversity and
 * structural coverage so the two cannot silently agree with themselves.
 */
export async function strategiesProximityAgent(
    question: string,
    strategies: string[],
    conversationHistory: string,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const prompt = appendContext(
            buildProximityPrompt('strategies', question, strategies, conversationHistory),
            specialContext
        );
        const review = await callAgent(prompt, images, context, systemPrompt, false);
        return { success: true, data: { review }, rawResponse: review };
    });
}

/** See strategiesProximityAgent; hypotheses use the same independent review contract. */
export async function hypothesesProximityAgent(
    question: string,
    hypotheses: string[],
    conversationHistory: string,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const prompt = appendContext(
            buildProximityPrompt('hypotheses', question, hypotheses, conversationHistory),
            specialContext
        );
        const review = await callAgent(prompt, images, context, systemPrompt, false);
        return { success: true, data: { review }, rawResponse: review };
    });
}

/**
 * Test Hypotheses Agent
 * Tests multiple hypotheses in parallel
 */
export async function testHypothesesAgent(
    question: string,
    hypothesisIds: string[],
    hypothesesData: Map<string, { text: string }>,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const results = await Promise.all(
            hypothesisIds.map(async (id) => {
                const hypothesis = hypothesesData.get(id);
                if (!hypothesis) return { id, success: false, error: 'Hypothesis not found' };

                const prompt = appendContext(buildHypothesisTestingPrompt(question, hypothesis.text), specialContext);
                const testing = await callAgent(prompt, images, context, systemPrompt, false);
                return { id, success: true, hypothesis: hypothesis.text, testing };
            })
        );
        return { success: true, data: { results } };
    });
}

/**
 * Execute Strategies Agent
 * Executes multiple strategies in parallel with selected hypothesis testing results
 */
export async function executeStrategiesAgent(
    question: string,
    strategyExecutions: Array<{ strategyId: string; hypothesisIds: string[] }>,
    strategiesData: Map<string, { text: string }>,
    hypothesisTestingResults: Map<string, { hypothesis: string; testing: string }>,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const results = await Promise.all(
            strategyExecutions.map(async (exec) => {
                const strategy = strategiesData.get(exec.strategyId);
                if (!strategy) return { id: exec.strategyId, success: false, error: 'Strategy not found' };

                const informationPacket = buildInformationPacket(exec.hypothesisIds, hypothesisTestingResults);
                const prompt = appendContext(buildExecutionPrompt(question, strategy.text, informationPacket), specialContext);
                const execution = await callAgent(prompt, images, context, systemPrompt, false);
                return { id: exec.strategyId, success: true, strategy: strategy.text, execution };
            })
        );
        return { success: true, data: { results } };
    });
}

/** Builds the XML information packet from hypothesis testing results. */
function buildInformationPacket(
    hypothesisIds: string[],
    results: Map<string, { hypothesis: string; testing: string }>
): string {
    const entries = hypothesisIds
        .map((id, idx) => {
            const r = results.get(id);
            return r
                ? `<Hypothesis ${idx + 1}>\nHypothesis: ${r.hypothesis}\nHypothesis Testing: ${r.testing}\n</Hypothesis ${idx + 1}>\n`
                : '';
        })
        .filter(Boolean)
        .join('\n');
    return `<Full Information Packet>\n${entries}</Full Information Packet>`;
}

/**
 * Solution Critique Agent
 * Critiques multiple executed solutions in parallel
 */
export async function solutionCritiqueAgent(
    question: string,
    executionIds: string[],
    executionsData: Map<string, { strategy: string; execution: string }>,
    specialContext: string,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const results = await Promise.all(
            executionIds.map(async (id) => {
                const execution = executionsData.get(id);
                if (!execution) return { id, success: false, error: 'Execution not found' };

                const prompt = appendContext(buildCritiquePrompt(question, execution.strategy, execution.execution), specialContext);
                const critique = await callAgent(prompt, images, context, systemPrompt, false);
                return { id, success: true, critique };
            })
        );
        return { success: true, data: { results } };
    });
}

/**
 * Corrected Solutions Agent
 * Generates corrected solutions based on critiques
 */
export async function correctedSolutionsAgent(
    question: string,
    executionIds: string[],
    executionsData: Map<string, { strategy: string; execution: string }>,
    critiquesData: Map<string, { critique: string }>,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const results = await Promise.all(
            executionIds.map(async (id) => {
                const execution = executionsData.get(id);
                const critique = critiquesData.get(id);
                if (!execution || !critique) return { id, success: false, error: 'Execution or critique not found' };

                const prompt = buildCorrectionPrompt(question, execution.strategy, execution.execution, critique.critique);
                const correctedSolution = await callAgent(prompt, images, context, systemPrompt, false);
                return { id, success: true, correctedSolution };
            })
        );
        return { success: true, data: { results } };
    });
}

/**
 * Select Best Solution Agent
 * Evaluates and selects the best solution from corrected solutions
 */
export async function selectBestSolutionAgent(
    question: string,
    solutionIds: string[],
    solutionsData: Map<string, { strategy: string; correctedSolution: string }>,
    systemPrompt: string,
    context: AgentExecutionContext,
    images: ImageInput = []
): Promise<AgentResponse> {
    return wrapAgent(async () => {
        const allSolutions = solutionIds
            .map((id, idx) => {
                const s = solutionsData.get(id);
                return s
                    ? `<Solution ${idx + 1} ID: ${id}>\nStrategy: ${s.strategy}\n\nCorrected Solution:\n${s.correctedSolution}\n</Solution ${idx + 1}>\n`
                    : '';
            })
            .filter(Boolean)
            .join('\n');

        const prompt = buildFinalJudgePrompt(question, allSolutions);
        const selection = await callAgent(prompt, images, context, systemPrompt, false);
        return { success: true, data: { selection }, rawResponse: selection };
    });
}
