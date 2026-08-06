/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic prompt and repository builders for Deepthink Evolving DFS.
 * These helpers intentionally avoid external conversation-history managers.
 */

type PromptMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export interface StrategySnapshot {
    id: string;
    strategyText: string;
    branchVersion: number;
    latestSolution?: string;
    latestCorrection?: string;
    latestCritique?: string;
    latestPool?: string;
    memoryBank?: string;
}

export interface BranchHistoryEntry {
    globalIteration: number;
    branchIteration: number;
    branchVersion?: number;
    label: string;
    solution: string;
    solutionDisplay?: string;
    solutionExecutionTraceText?: string;
    critique: string;
    critiqueDisplay?: string;
    critiqueExecutionTraceText?: string;
}

export interface PoolHistoryEntry {
    globalIteration: number;
    branchIteration: number;
    poolResponse: string;
}

export interface PqfDecision {
    strategyId: string;
    decision: 'keep' | 'update';
    reasoning: string;
}

export interface StrategyUpdateRequest {
    strategyId: string;
    oldStrategyText: string;
    latestSolution: string;
    latestSolutionDisplay?: string;
    latestCritique: string;
    latestCritiqueDisplay?: string;
    memoryBank?: string;
    pqfReasoning: string;
}

export interface HypothesisRoundSnapshot {
    roundNumber: number;
    packet: string;
}

interface StrategyPromptContext {
    peerContext: string;
    currentContext: string;
}

interface PreviousHypothesisTestResult {
    hypothesisId: string;
    hypothesisText: string;
    targetStrategyIds: string[];
    testerOutput: string;
    testerStatus: string;
}

function fence(label: string, content: string | undefined): string {
    return `<${label}>\n${content || 'Not available.'}\n</${label}>`;
}

const SECTION_SEPARATOR = '-------------------------------------------------------------------------------';

function takeLast<T>(items: T[], count: number): T[] {
    return items.slice(Math.max(0, items.length - count));
}

function formatHistoryEntries(entries: BranchHistoryEntry[]): string {
    if (entries.length === 0) return 'No branch correction/critique history is available yet.';

    return entries.map(entry => [
        `<Iteration global="${entry.globalIteration}" branch="${entry.branchIteration}"${entry.branchVersion ? ` branchVersion="${entry.branchVersion}"` : ''} label="${entry.label}">`,
        fence('SolutionOrCorrection', entry.solution),
        fence('Critique', entry.critique),
        '</Iteration>',
    ].join('\n')).join('\n\n');
}

function formatPoolEntries(entries: PoolHistoryEntry[]): string {
    if (entries.length === 0) return 'No previous solution pool output is available for this strategy yet.';

    return entries.map(entry => [
        `<SolutionPoolOutput global="${entry.globalIteration}" branch="${entry.branchIteration}">`,
        entry.poolResponse?.trim() || 'No pool output available.',
        '</SolutionPoolOutput>',
    ].join('\n')).join('\n\n');
}

function latestSolutionOf(snapshot: StrategySnapshot): string {
    return snapshot.latestCorrection || snapshot.latestSolution || 'No solution or correction is available.';
}

export function buildCritiquePrompt(args: {
    challenge: string;
    strategy: StrategySnapshot;
    solutionToCritique: string;
    globalIteration: number;
    branchIteration: number;
    previousHistory: BranchHistoryEntry[];
}): PromptMessage[] {
    const recentHistory = takeLast(args.previousHistory, 5);
    const content = `Core Challenge:
${args.challenge}

<Assigned Strategy id="${args.strategy.id}" branchVersion="${args.strategy.branchVersion}">
${args.strategy.strategyText}
</Assigned Strategy>

<Critique Target globalIteration="${args.globalIteration}" branchIteration="${args.branchIteration}">
${args.solutionToCritique}
</Critique Target>

<Recent Branch History>
${formatHistoryEntries(recentHistory)}
</Recent Branch History>

Your task is to critique the target solution only. Verify strategy fidelity first, then execution quality. Do not suggest fixes.`;

    return [{ role: 'user', content }];
}

export function buildCorrectionRepository(args: {
    current: StrategySnapshot;
    currentHistory: BranchHistoryEntry[];
    currentPoolHistory: PoolHistoryEntry[];
    allStrategies: StrategySnapshot[];
    maxHistoryEntries: number;
}): StrategyPromptContext {
    const previousHistory = takeLast(
        args.currentHistory.slice(0, -1),
        Math.max(0, args.maxHistoryEntries - 1),
    );
    const latestCurrentPool = takeLast(args.currentPoolHistory, 1)[0]?.poolResponse;

    const otherSections = args.allStrategies
        .filter(strategy => strategy.id !== args.current.id)
        .map(strategy => {
            const header = `<Strategy-${strategy.id} branchVersion="${strategy.branchVersion}">`;
            const lines = [
                header,
                fence('StrategyText', strategy.strategyText),
                fence('LatestCorrectionOrExecution', latestSolutionOf(strategy)),
                fence('LatestCritique', strategy.latestCritique),
            ];

            lines.push(`</Strategy-${strategy.id}>`);
            return lines.join('\n');
        });

    const currentLines = [
        `<Strategy-${args.current.id} branchVersion="${args.current.branchVersion}" assigned="true">`,
        fence('StrategyText', args.current.strategyText),
    ];
    if (args.current.memoryBank) currentLines.push(fence(`MemoryBank For Strategy ${args.current.id}`, args.current.memoryBank));
    currentLines.push(fence('LatestCorrectionOrExecution', latestSolutionOf(args.current)));
    currentLines.push(fence('LatestCritique', args.current.latestCritique));
    currentLines.push(`<BranchHistory previous="${previousHistory.length}" last="${args.maxHistoryEntries}">\n${formatHistoryEntries(previousHistory)}\n</BranchHistory>`);
    currentLines.push(fence('LatestStrategySolutionPool', latestCurrentPool));
    currentLines.push(`</Strategy-${args.current.id}>`);

    return {
        peerContext: otherSections.length
            ? [
                '<Context From Other Strategies For Cross-Learning, Synthesis, Gap Anticipation, Critique Anticipation, And Orthogonality>',
                otherSections.join('\n\n'),
                '</Context From Other Strategies For Cross-Learning, Synthesis, Gap Anticipation, Critique Anticipation, And Orthogonality>',
            ].join('\n')
            : '',
        currentContext: [
        '<Relevant Context For Your Current Strategy>',
        'This is all the relevant context related to your current strategy. Treat this as your primary identity, branch memory, and correction anchor.',
        SECTION_SEPARATOR,
        currentLines.join('\n'),
        '</Relevant Context For Your Current Strategy>',
        ].join('\n'),
    };
}

export function buildCorrectionPrompt(args: {
    challenge: string;
    current: StrategySnapshot;
    context: StrategyPromptContext;
    hypothesisPacket?: string;
    globalIteration: number;
    branchIteration: number;
}): PromptMessage[] {
    const content = `Core Challenge:
${args.challenge}

<Assigned Strategy Text>
${args.current.strategyText}
</Assigned Strategy Text>

<EvolvingDepthFirstSearchCorrectionContext>
Global iteration: ${args.globalIteration}
Assigned strategy: ${args.current.id}
Assigned branch version: ${args.current.branchVersion}
Assigned branch-local iteration to produce: ${args.branchIteration}
</EvolvingDepthFirstSearchCorrectionContext>

<Correction Request>
Produce the next corrected solution for the assigned strategy. Work inside the assigned strategy only. Use the current strategy's memory bank, branch history, latest critique, and latest solution pool when available. Other strategies are included only as latest correction plus latest critique for situational awareness.
</Correction Request>

${args.context.peerContext}

${SECTION_SEPARATOR}
${fence('Strategy-Aware Selective Knowledge Packet', args.hypothesisPacket)}

${SECTION_SEPARATOR}
${args.context.currentContext}`;

    return [{ role: 'user', content }];
}

export function buildSolutionPoolRepository(args: {
    current: StrategySnapshot;
    currentHistory: BranchHistoryEntry[];
    currentPoolHistory: PoolHistoryEntry[];
    allStrategies: StrategySnapshot[];
    maxPoolHistoryEntries: number;
}): StrategyPromptContext {
    const otherSections = args.allStrategies
        .filter(strategy => strategy.id !== args.current.id)
        .map(strategy => {
            const header = `<Strategy-${strategy.id} branchVersion="${strategy.branchVersion}">`;
            const lines = [
                header,
                fence('StrategyText', strategy.strategyText),
                fence('LatestSolutionPool', strategy.latestPool),
            ];

            lines.push(`</Strategy-${strategy.id}>`);
            return lines.join('\n');
        });

    const currentLines = [
        `<Strategy-${args.current.id} branchVersion="${args.current.branchVersion}" assigned="true">`,
        fence('StrategyText', args.current.strategyText),
    ];
    if (args.current.memoryBank) currentLines.push(fence(`MemoryBank For Strategy ${args.current.id}`, args.current.memoryBank));
    currentLines.push(fence('LatestCorrectionOrExecution', latestSolutionOf(args.current)));
    currentLines.push(fence('LatestCritique', args.current.latestCritique));
    currentLines.push(`<PoolHistory last="${args.maxPoolHistoryEntries}">\n${formatPoolEntries(takeLast(args.currentPoolHistory, args.maxPoolHistoryEntries))}\n</PoolHistory>`);
    if (args.currentHistory.length === 0) {
        currentLines.push('<BranchHistory>Status: this branch has no completed correction history yet.</BranchHistory>');
    }
    currentLines.push(`</Strategy-${args.current.id}>`);

    return {
        peerContext: otherSections.length
            ? [
                '<Context From Other Strategies For Cross-Learning, Synthesis, Gap Anticipation, Critique Anticipation, And Orthogonality>',
                otherSections.join('\n\n'),
                '</Context From Other Strategies For Cross-Learning, Synthesis, Gap Anticipation, Critique Anticipation, And Orthogonality>',
            ].join('\n')
            : '',
        currentContext: [
        '<Relevant Context For Your Current Strategy>',
        'This is all the relevant context related to your current strategy. Treat this as your primary identity, branch memory, and pool-generation anchor.',
        SECTION_SEPARATOR,
        currentLines.join('\n'),
        '</Relevant Context For Your Current Strategy>',
        ].join('\n'),
    };
}

export function buildSolutionPoolPrompt(args: {
    challenge: string;
    current: StrategySnapshot;
    context: StrategyPromptContext;
    hypothesisPacket?: string;
    globalIteration: number;
    branchIteration: number;
}): PromptMessage[] {
    const content = `Core Challenge:
${args.challenge}

<Assigned Strategy Text>
${args.current.strategyText}
</Assigned Strategy Text>

<EvolvingDepthFirstSearchSolutionPoolContext>
Global iteration: ${args.globalIteration}
Assigned strategy: ${args.current.id}
Assigned branch version: ${args.current.branchVersion}
Current branch-local iteration: ${args.branchIteration}
</EvolvingDepthFirstSearchSolutionPoolContext>

<Solution Pool Request>
Generate the solution pool for the assigned strategy. Use only the assigned strategy's latest correction/execution, latest critique, memory bank if present, and last solution pool outputs for the assigned strategy. Other strategies are represented only by their latest full pool outputs.
</Solution Pool Request>

${args.context.peerContext}

${SECTION_SEPARATOR}
${fence('Strategy-Aware Selective Knowledge Packet', args.hypothesisPacket)}

${SECTION_SEPARATOR}
${args.context.currentContext}`;

    return [{ role: 'user', content }];
}

export function buildMemoryBankPrompt(args: {
    challenge: string;
    strategy: StrategySnapshot;
    previousMemoryBank?: string;
    historyWindow: BranchHistoryEntry[];
    windowStartBranchIteration: number;
    windowEndBranchIteration: number;
}): PromptMessage[] {
    const content = `Core Challenge:
${args.challenge}

<Strategy id="${args.strategy.id}" branchVersion="${args.strategy.branchVersion}">
${args.strategy.strategyText}
</Strategy>

${fence('Previous Memory Bank', args.previousMemoryBank)}

<Raw Branch History To Distill branchIterations="${args.windowStartBranchIteration}-${args.windowEndBranchIteration}">
${formatHistoryEntries(args.historyWindow)}
</Raw Branch History To Distill>

Create one unified memory bank for this strategy branch. Do not summarize the prose of solutions. Summarize the exploration space:
- Validated Invariants
- Dead Ends
- Persistent Flaws
- Useful Techniques
- Refuted Assumptions
- Open Questions
- Branch-Level Guidance For Future Corrections

If a previous memory bank is provided, recursively merge it with the new raw history so no earlier lessons are lost.`;

    return [{ role: 'user', content }];
}

export function buildPqfPrompt(args: {
    challenge: string;
    groupIndex: number;
    groupCount: number;
    strategiesInGroup: StrategySnapshot[];
    allActiveStrategies: StrategySnapshot[];
    historyByStrategy: Record<string, BranchHistoryEntry[]>;
    aggressiveness: string;
}): PromptMessage[] {
    const visibleStrategyNames = args.allActiveStrategies
        .map(strategy => `${strategy.id}: ${strategy.strategyText}`)
        .join('\n\n');

    const strategySections = args.strategiesInGroup.map(strategy => [
        `<StrategyForDecision id="${strategy.id}" branchVersion="${strategy.branchVersion}">`,
        fence('StrategyText', strategy.strategyText),
        `<FullRecentCorrectionCritiqueHistory>\n${formatHistoryEntries(args.historyByStrategy[strategy.id] || [])}\n</FullRecentCorrectionCritiqueHistory>`,
        '</StrategyForDecision>',
    ].join('\n')).join('\n\n');

    const content = `Core Challenge:
${args.challenge}

<PQFAggressiveness>${args.aggressiveness}</PQFAggressiveness>

<All Active Strategies For Awareness>
${visibleStrategyNames}
</All Active Strategies For Awareness>

<PQF Group group="${args.groupIndex + 1}" totalGroups="${args.groupCount}">
Evaluate only the strategies inside this group. You see full recent correction/critique history for these strategies only.
${strategySections}
</PQF Group>

Return only JSON:
{
  "analysis_summary": "short summary",
  "strategies": [
    {
      "strategy_id": "main1",
      "decision": "keep",
      "reasoning": "evidence-based reason"
    }
  ]
}

Decision must be exactly "keep" or "update". Mark update only when the branch's strategy should be replaced by a new branch, not when ordinary correction can fix execution errors.`;

    return [{ role: 'user', content }];
}

export function buildStrategyUpdatePrompt(args: {
    challenge: string;
    decisionVector: PqfDecision[];
    updateRequests: StrategyUpdateRequest[];
    currentStrategies: Array<{ id: string; strategyText: string }>;
    previouslyUsedStrategies: Array<{ id: string; strategyText: string }>;
}): PromptMessage[] {
    const failedContext = args.updateRequests.map(request => [
        `<UpdateRequest strategyId="${request.strategyId}">`,
        fence('Old Strategy Text', request.oldStrategyText),
        fence('PQF Reasoning', request.pqfReasoning),
        fence('Latest Correction Or Execution', request.latestSolution),
        fence('Latest Critique', request.latestCritique),
        fence('Memory Bank', request.memoryBank),
        '</UpdateRequest>',
    ].join('\n')).join('\n\n');
    const currentStrategies = args.currentStrategies
        .map(strategy => `${strategy.id}: ${strategy.strategyText}`)
        .join('\n');
    const previouslyUsedStrategies = args.previouslyUsedStrategies
        .map(strategy => `${strategy.id}: ${strategy.strategyText}`)
        .join('\n');

    const content = `Core Challenge:
${args.challenge}

<Consolidated PQF Decision Vector>
${JSON.stringify(args.decisionVector, null, 2)}
</Consolidated PQF Decision Vector>

<Current Active Strategies>
${currentStrategies}
</Current Active Strategies>

<Previously Finalized Strategies>
${previouslyUsedStrategies || 'No earlier replaced strategies.'}
</Previously Finalized Strategies>

<Failed Strategy Context For Updates>
${failedContext}
</Failed Strategy Context For Updates>

The complete prior Strategy Generator / Strategies Proximity conversation is supplied separately by the shared generation loop. Use it to avoid repeating any current or previously replaced strategy.

Generate exactly one replacement strategy for every strategy marked "update". Keep the same strategy_id slot, but the text must be a genuinely new branch that avoids the failed strategy's conceptual trap.

Return only JSON:
{
  "strategies": [
    {
      "strategy_id": "main1",
      "strategy": "Replacement strategy text"
    }
  ]
}`;

    return [{ role: 'user', content }];
}

export function buildHypothesisRefreshPrompt(args: {
    challenge: string;
    hypothesisCount: number;
    completedGlobalIteration: number;
    currentStrategies: StrategySnapshot[];
    recentHistoryByStrategy: Record<string, BranchHistoryEntry[]>;
    updatedStrategyIds: string[];
    previousTestingOutputs: PreviousHypothesisTestResult[];
}): PromptMessage[] {
    const strategies = args.currentStrategies.map(strategy => [
        `<Strategy id="${strategy.id}" branchVersion="${strategy.branchVersion}">`,
        fence('StrategyText', strategy.strategyText),
        `<LastTwoCorrectionCritiquePairs>\n${formatHistoryEntries(args.recentHistoryByStrategy[strategy.id] || [])}\n</LastTwoCorrectionCritiquePairs>`,
        '</Strategy>',
    ].join('\n')).join('\n\n');

    const updateNote = args.updatedStrategyIds.length
        ? `Strategies recently updated and needing fresh targeted hypotheses: ${args.updatedStrategyIds.join(', ')}. Flush old slot-specific assumptions for these strategies.`
        : 'No strategies were recently updated.';
    const previousTestingOutputs = args.previousTestingOutputs.length
        ? args.previousTestingOutputs.map(result => [
            `<Hypothesis id="${result.hypothesisId}" status="${result.testerStatus}">`,
            fence('Text', result.hypothesisText),
            fence('TargetStrategies', result.targetStrategyIds.join(', ') || 'All'),
            fence('TestingOutput', result.testerOutput),
            '</Hypothesis>',
        ].join('\n')).join('\n\n')
        : 'No previous hypothesis testing outputs are available for the initial round.';

    const content = `Core Challenge:
${args.challenge}

<Hypothesis Heartbeat>
Completed global iteration: ${args.completedGlobalIteration}
Generate exactly ${args.hypothesisCount} new or updated hypotheses.
Mode: selective, strategy-aware routing only.
</Hypothesis Heartbeat>

<Current Active Strategies And Last Two Histories>
${strategies}
</Current Active Strategies And Last Two Histories>

<Previous Hypothesis Round Testing Outputs>
${previousTestingOutputs}
</Previous Hypothesis Round Testing Outputs>

The complete prior Hypothesis Generator / Hypothesis Proximity conversation is supplied separately by the shared generation loop. Use that conversation to avoid repeating prior hypotheses or proximity critiques.

<Strategy Update Note>
${updateNote}
</Strategy Update Note>

Return only JSON:
{
  "hypotheses": [
    {
      "text": "Hypothesis text",
      "target_strategies": ["main1"]
    }
  ]
}

Use empty target_strategies only for globally useful hypotheses. Do not solve the original challenge or embed assumed final answers.`;

    return [{ role: 'user', content }];
}
