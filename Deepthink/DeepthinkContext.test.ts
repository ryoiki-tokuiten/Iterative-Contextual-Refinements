import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildAttachmentSeedFiles,
    buildDeepthinkAttachments,
    buildFilesystemAttachmentFiles,
    buildProviderParts,
    buildTextAttachmentContext,
    selectRoutedHypotheses,
    validateAllowedUniqueIds,
    validateExactUniqueIdSet,
} from './DeepthinkContext.ts';
import {
    DEEPTHINK_AGENT_REGISTRY,
    deepthinkAgentModel,
} from './DeepthinkAgentRegistry.ts';
import {
    buildDeepthinkSandboxRepositoryAccess,
} from './DeepthinkSandboxAccess.ts';
import {
    buildCorrectionPrompt,
    buildCorrectionRepository,
    buildHypothesisRefreshPrompt,
    buildStrategyUpdatePrompt,
    type BranchHistoryEntry,
    type StrategySnapshot,
} from './DeepthinkIterativeHistory.ts';

const base64 = (value: string) => Buffer.from(value).toString('base64');
const image = (name: string) => ({
    name,
    mimeType: 'image/png',
    base64: base64(`${name}-pixels`),
    size: 12,
});
const textFile = (name: string, content = 'hello') => ({
    name,
    mimeType: 'text/plain',
    base64: base64(content),
    size: content.length,
});

test('attachment routing sends every direct file exactly once', () => {
    const cases = [
        {
            name: 'direct text only',
            direct: [textFile('notes.txt')],
            providerPayloads: [],
            textNames: ['notes.txt'],
            seedNames: ['notes.txt'],
        },
        {
            name: 'direct image only',
            direct: [image('diagram.png')],
            providerPayloads: [base64('diagram.png-pixels')],
            textNames: [],
            seedNames: ['diagram.png'],
        },
        {
            name: 'mixed direct files',
            direct: [textFile('notes.txt'), image('diagram.png'), textFile('data.json', '{"ok":true}')],
            providerPayloads: [base64('diagram.png-pixels')],
            textNames: ['notes.txt', 'data.json'],
            seedNames: ['notes.txt', 'diagram.png', 'data.json'],
        },
    ];

    cases.forEach(fixture => {
        const attachments = buildDeepthinkAttachments({
            directFiles: fixture.direct,
        });
        assert.deepEqual(
            buildProviderParts('prompt', attachments)
                .filter(part => 'inlineData' in part)
                .map(part => 'inlineData' in part ? part.inlineData?.data || '' : ''),
            fixture.providerPayloads,
            fixture.name,
        );
        const textContext = buildTextAttachmentContext(attachments);
        const expectedTextContext = fixture.textNames.length
            ? `\n\nDirect context files:${fixture.textNames.map(name => {
                const file = fixture.direct.find(candidate => candidate.name === name)!;
                return `\n\n--- ${name} ---\n${Buffer.from(file.base64, 'base64').toString('utf8')}\n--- end file ---`;
            }).join('')}`
            : '';
        assert.equal(textContext, expectedTextContext, fixture.name);
        assert.deepEqual(
            buildAttachmentSeedFiles(attachments).map(file => file.name),
            fixture.seedNames,
            fixture.name,
        );
    });
});

test('filesystem uploads are frozen into the manifest without becoming provider or prompt input', () => {
    const attachments = buildDeepthinkAttachments({
        directFiles: [textFile('direct.txt')],
        filesystemFiles: [textFile('nested/evidence', 'filesystem evidence')],
    });
    assert.deepEqual(
        buildProviderParts('prompt', attachments)
            .filter(part => 'inlineData' in part)
            .map(part => 'inlineData' in part ? part.inlineData?.data || '' : ''),
        [],
    );
    assert.doesNotMatch(buildTextAttachmentContext(attachments), /filesystem evidence/);
    assert.deepEqual(buildAttachmentSeedFiles(attachments).map(file => file.name), ['direct.txt']);
    assert.deepEqual(buildFilesystemAttachmentFiles(attachments), [{
        name: 'evidence.txt',
        mimeType: 'text/plain',
        base64: base64('filesystem evidence'),
        relativePath: 'user_uploaded/evidence.txt',
    }]);
});

test('invalid text data produces a stable placeholder without removing other transports', () => {
    const attachments = buildDeepthinkAttachments({
        directFiles: [{
            name: 'broken.txt',
            mimeType: 'text/plain',
            base64: Buffer.from([0xff, 0xfe]).toString('base64'),
            size: 16,
        }],
    });
    assert.match(buildTextAttachmentContext(attachments), /\[Unable to decode file\]/);
    assert.equal(buildProviderParts('prompt', attachments).length, 1);
    assert.equal(buildAttachmentSeedFiles(attachments)[0]?.name, 'broken.txt');
});

test('ID validation rejects duplicates, missing IDs, extras, and unknown routes', () => {
    assert.doesNotThrow(() => validateExactUniqueIdSet(['main1', 'main3'], ['main1', 'main3'], 'updates'));
    assert.throws(() => validateExactUniqueIdSet(['main1', 'main1'], ['main1', 'main3'], 'updates'), /duplicate/);
    assert.throws(() => validateExactUniqueIdSet(['main1'], ['main1', 'main3'], 'updates'), /exactly/);
    assert.throws(() => validateExactUniqueIdSet(['main1', 'main2'], ['main1', 'main3'], 'updates'), /exactly/);
    assert.doesNotThrow(() => validateAllowedUniqueIds([], ['main1'], 'targets', { allowEmpty: true }));
    assert.throws(() => validateAllowedUniqueIds(['main2'], ['main1'], 'targets', { allowEmpty: true }), /unknown/);
});

test('freshness and selective routing use one selector for packets and mounts', () => {
    const hypotheses = [
        { id: 'global', targetStrategyIds: [] },
        { id: 'main1', targetStrategyIds: ['main1'] },
        { id: 'main2', targetStrategyIds: ['main2'] },
    ];
    assert.deepEqual(
        selectRoutedHypotheses(hypotheses, 'main1').map(hypothesis => hypothesis.id),
        ['global', 'main1'],
    );
    assert.deepEqual(selectRoutedHypotheses(hypotheses, 'main1', true), []);
});

test('the typed registry selects models independently of display labels', () => {
    const prompts = {
        model_selfImprovement: 'correction-model',
    } as never;
    assert.equal(
        deepthinkAgentModel('solutionCorrection', prompts, 'fallback-model'),
        'correction-model',
    );
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCorrection.sandboxRole, 'Solution Correction');
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCorrection.systemPromptKey, 'sys_deepthink_selfImprovement');
    Object.values(DEEPTHINK_AGENT_REGISTRY).forEach(metadata => {
        assert.match(metadata.systemPromptKey, /^sys_deepthink_/);
        assert.match(metadata.modelKey, /^model_/);
    });
});

test('repository policy applies feature flags and preserves the pinned revision', () => {
    const revision = '1234567890abcdef1234567890abcdef12345678';
    const hypothesisTester = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Hypothesis Testing',
        hypothesisLabel: '1',
        hypothesisRoundNumber: 2,
        repositoryRevision: revision,
    });
    assert.deepEqual(hypothesisTester.readableDirectories, []);

    const selfWithoutPeers = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Self-Improvement',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [],
        repositoryRevision: revision,
    });
    assert.deepEqual(selfWithoutPeers.readableDirectories, ['Strategy-1/Critique']);

    const selfWithPeers = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Self-Improvement',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [1, 2],
        repositoryRevision: revision,
    });
    assert.deepEqual(selfWithPeers.readableDirectories, [
        'Strategy-2',
        'Strategy-3',
        'Strategy-1/Critique',
    ]);

    const isolatedCorrection = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Solution Correction',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [],
        repositoryRevision: revision,
    });
    assert.equal(isolatedCorrection.readableDirectories?.includes('Strategy-2'), false);

    const crossContextPool = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Structured Solution Pool',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [1],
        repositoryRevision: revision,
    });
    assert.equal(crossContextPool.readableDirectories?.includes('Strategy-2'), true);
    assert.equal(crossContextPool.revision, revision);
});

test('typed correction context cannot be split by generated marker text and does not duplicate the latest pair', () => {
    const markerText = '__DEEPTHINK_CURRENT_STRATEGY_CONTEXT__';
    const history: BranchHistoryEntry[] = Array.from({ length: 6 }, (_, index) => ({
        globalIteration: index + 1,
        branchIteration: index + 1,
        branchVersion: 1,
        label: `Iteration ${index + 1}`,
        solution: index === 5 ? 'LATEST-SOLUTION' : `solution-${index + 1}`,
        critique: index === 5 ? 'LATEST-CRITIQUE' : `critique-${index + 1}`,
    }));
    const current: StrategySnapshot = {
        id: 'main1',
        strategyText: `Current strategy containing ${markerText}`,
        branchVersion: 1,
        latestCorrection: 'LATEST-SOLUTION',
        latestCritique: 'LATEST-CRITIQUE',
    };
    const context = buildCorrectionRepository({
        current,
        currentHistory: history,
        currentPoolHistory: [],
        allStrategies: [current],
        maxHistoryEntries: 5,
    });
    const prompt = buildCorrectionPrompt({
        challenge: 'challenge',
        current,
        context,
        globalIteration: 7,
        branchIteration: 7,
    })[0].content;

    assert.match(prompt, new RegExp(markerText));
    assert.equal(prompt.match(/LATEST-SOLUTION/g)?.length, 1);
    assert.equal(prompt.match(/LATEST-CRITIQUE/g)?.length, 1);
    assert.doesNotMatch(prompt, /solution-1/);
    assert.match(prompt, /solution-2/);
    assert.match(prompt, /solution-5/);
});

test('heartbeat and strategy-update prompts include the exact new evidence blocks', () => {
    const strategy: StrategySnapshot = {
        id: 'main1',
        strategyText: 'Current strategy',
        branchVersion: 2,
    };
    const heartbeat = buildHypothesisRefreshPrompt({
        challenge: 'challenge',
        hypothesisCount: 1,
        completedGlobalIteration: 6,
        currentStrategies: [strategy],
        recentHistoryByStrategy: { main1: [] },
        updatedStrategyIds: ['main1'],
        previousTestingOutputs: [{
            hypothesisId: 'hyp2-1',
            hypothesisText: 'Full previous hypothesis',
            targetStrategyIds: ['main1'],
            testerOutput: 'Complete tester evidence without summarization.',
            testerStatus: 'completed',
        }],
    })[0].content;
    assert.match(heartbeat, /Complete tester evidence without summarization\./);
    assert.match(heartbeat, /Full previous hypothesis/);

    const update = buildStrategyUpdatePrompt({
        challenge: 'challenge',
        decisionVector: [{ strategyId: 'main1', decision: 'update', reasoning: 'failed' }],
        updateRequests: [{
            strategyId: 'main1',
            oldStrategyText: 'Failed current branch',
            latestSolution: 'solution',
            latestCritique: 'critique',
            pqfReasoning: 'failed',
        }],
        currentStrategies: [{ id: 'main1', strategyText: 'Current strategy' }],
        previouslyUsedStrategies: [{ id: 'main1', strategyText: 'Older replaced strategy' }],
    })[0].content;
    assert.match(update, /<Current Active Strategies>\nmain1: Current strategy/);
    assert.match(update, /<Old Strategy Text>\nFailed current branch/);
    assert.match(update, /Older replaced strategy/);
});
