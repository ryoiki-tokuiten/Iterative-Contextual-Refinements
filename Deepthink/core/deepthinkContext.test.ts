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
} from './deepthinkContext.ts';
import {
    DEEPTHINK_AGENT_REGISTRY,
    deepthinkAgentModel,
} from './agentRegistry.ts';
import {
    buildDeepthinkSandboxRepositoryAccess,
} from './sandboxAccess.ts';

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

test('freshness and branch routing use one selector for packets and mounts', () => {
    const hypotheses = [
        { id: 'global', targetBranchIds: [] },
        { id: 'main1', targetBranchIds: ['main1'] },
        { id: 'main2', targetBranchIds: ['main2'] },
    ];
    assert.deepEqual(
        selectRoutedHypotheses(hypotheses, 'main1').map(hypothesis => hypothesis.id),
        ['global', 'main1'],
    );
    assert.deepEqual(selectRoutedHypotheses(hypotheses, 'main1', true), []);
});

test('the typed registry selects models independently of display labels', () => {
    const prompts = {
        model_solutionCorrection: 'correction-model',
    } as never;
    assert.equal(
        deepthinkAgentModel('solutionCorrection', prompts, 'configured-model'),
        'correction-model',
    );
    assert.equal(
        deepthinkAgentModel('solutionCorrection', undefined, 'configured-model'),
        'configured-model',
    );
    assert.throws(() => deepthinkAgentModel('solutionCorrection', undefined, undefined));
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCorrection.sandboxRole, 'Solution Correction');
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCorrection.systemPromptKey, 'sys_deepthink_solutionCorrection');
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
    assert.equal(hypothesisTester.fullRepositoryRead, true);
    assert.equal(hypothesisTester.agentDirectory, 'Hypothesis-v2/Hypothesis-1');

    const isolatedCorrection = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Solution Correction',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [],
        repositoryRevision: revision,
    });
    assert.equal(isolatedCorrection.readableDirectories?.includes('Strategy-2'), false);

    const crossContextCorrection = buildDeepthinkSandboxRepositoryAccess({
        repositoryId: 'deepthink-test',
        role: 'Solution Correction',
        strategySlotIndex: 0,
        peerStrategySlotIndexes: [1],
        repositoryRevision: revision,
    });
    assert.equal(crossContextCorrection.readableDirectories?.includes('Strategy-2'), true);
    assert.equal(crossContextCorrection.revision, revision);
});

test('the typed registry enforces per-agent maxOutputTokens limits (5000 default, 10000 for correction and memoryBank)', () => {
    assert.equal(DEEPTHINK_AGENT_REGISTRY.initialStrategy.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.strategyGeneratorGlobalUpdate.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.strategyProximity.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.hypothesisGeneration.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.hypothesisProximity.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.dos.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.bsr.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionAttempt.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCritique.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.hypothesisTester.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.finalJudge.maxOutputTokens, 5000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.solutionCorrection.maxOutputTokens, 10000);
    assert.equal(DEEPTHINK_AGENT_REGISTRY.memoryBank.maxOutputTokens, 10000);
});

