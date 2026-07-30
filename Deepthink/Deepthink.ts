/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink — Module logic, state management, initialization, and event coordination.
 * All rendering (JSX) lives in Deepthink.tsx. This file contains ZERO innerHTML/HTML strings.
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { AIProvider } from '../Routing/AIProvider';
import { callGemini } from "@/Routing/AIService.js";
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import { cleanupEvolvingDfsRoot } from '../Contextual/ContextualUI';
import { onHighlighterReady } from '../Styles/Shiki';
import { parseJsonSafe } from "../Core/JsonParser";
import { renderIconMarkup } from '../UI/Icons';

// React component imports
import {
    BaseModal,
    DefaultSolutionUI,
    SubStrategyComparisonUI,
    EmbeddedModalContent,
    StructuredResponseModalContent,
    StrategicSolverTab,
    HypothesisExplorerTab,
    DissectedObservationsTab,
    EvolutionFilterTab,
    FinalResultTab,
} from './Deepthink.tsx';

import { SolutionPoolTabContent } from './SolutionPool.tsx';
import { DeepthinkLiveTab } from './DeepthinkLiveTab.tsx';
import { DeepthinkFilesystemTab } from './DeepthinkFilesystemTab.tsx';

// Core Imports
import {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkPipelineState,
    DeepthinkStructuredSolutionPoolAgentData,
    getActiveDeepthinkPipeline,
    setActiveDeepthinkPipelineForImport,
    initializeDeepthinkCore,
    startDeepthinkAnalysisProcess
} from './DeepthinkCore';

// ============================================================================ 
// Types & Re-exports
// ============================================================================ 

export type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkPipelineState,
    DeepthinkStructuredSolutionPoolAgentData
};

export {
    startDeepthinkAnalysisProcess,
    getActiveDeepthinkPipeline,
    setActiveDeepthinkPipelineForImport
};

interface DeepthinkTabDefinition {
    id: string;
    label: string;
    icon: string;
    alignRight?: boolean;
    statusClass: string;
}

// ============================================================================ 
// Module State
// ============================================================================ 

interface DeepthinkModuleState {
    tabsNavContainer: HTMLElement | null;
    pipelinesContentContainer: HTMLElement | null;
    escapeHtml: (unsafe: string) => string;
}

const moduleState: DeepthinkModuleState = {
    tabsNavContainer: null,
    pipelinesContentContainer: null,
    escapeHtml: (s) => s,
};

function isEvolvingRun(process: DeepthinkPipelineState): boolean {
    return process.runConfig?.evolvingDfsEnabled
        ?? process.initialStrategies.some(strategy =>
            strategy.subStrategies.some(subStrategy => subStrategy.evolvingDfs?.enabled));
}

function isRefinementRun(process: DeepthinkPipelineState): boolean {
    return process.runConfig?.refinementEnabled
        ?? process.solutionCritiques.length > 0;
}

function hasDissectedSurface(process: DeepthinkPipelineState): boolean {
    return isRefinementRun(process)
        || isEvolvingRun(process)
        || !!process.dissectedObservationsSynthesis;
}

let activeSolutionModalSubStrategyId: string | null = null;
let activeSolutionModalBranchVersion: number | undefined;

// React roots for React-rendered content
let pipelineContentRoot: Root | null = null;
let pipelineContentContainerNode: HTMLElement | null = null;
let modalRoot: Root | null = null;
let modalContainer: HTMLElement | null = null;
let filesystemRedirectListenerRegistered = false;

// ============================================================================ 
// Initialization
// ============================================================================ 

export function initializeDeepthinkModule(dependencies: {
    getAIProvider: () => AIProvider | null;
    callGemini: typeof callGemini;
    parseJsonSafe: typeof parseJsonSafe;
    updateControlsState: (newState: any) => void;
    escapeHtml: (unsafe: string) => string;
    getSelectedTemperature: () => number;
    getSelectedModel: () => string;
    getSelectedTopP: () => number;
    getSelectedStrategiesCount: () => number;
    getSelectedSubStrategiesCount: () => number;
    getStrategyProximityLoops: () => number;
    getRefinementEnabled: () => boolean;
    getSelectedHypothesisCount: () => number;
    getHypothesisProximityLoops: () => number;
    getSelectedPqfAggressiveness: () => string;
    getSkipSubStrategies: () => boolean;
    getDissectedObservationsEnabled: () => boolean;
    getShareHypothesesToDissected: () => boolean;
    getEvolvingDfsEnabled: () => boolean;
    getEvolvingDfsDepth: () => number;
    getIsolateBranchesEnabled: () => boolean;
    getSolutionPoolDisabled: () => boolean;
    getProvideAllSolutionsToCorrectors: () => boolean;
    getPostQualityFilterEnabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    getHypothesisInjectionMode: () => 'parallel' | 'strategy_aware' | 'selective_injection';
    getSelectedThinkingLevel?: () => 'low' | 'medium' | 'high' | 'minimal';
    getCustomPromptsDeepthinkState: () => CustomizablePromptsDeepthink;
    tabsNavContainer: HTMLElement | null;
    pipelinesContentContainer: HTMLElement | null;
    setActiveDeepthinkPipeline: (pipeline: DeepthinkPipelineState | null) => void;
}) {
    Object.assign(moduleState, {
        tabsNavContainer: dependencies.tabsNavContainer,
        pipelinesContentContainer: dependencies.pipelinesContentContainer,
        escapeHtml: dependencies.escapeHtml,
    });

    onHighlighterReady(() => {
        if (getActiveDeepthinkPipeline()) {
            renderActiveDeepthinkPipeline();
        }
    });

    if (!filesystemRedirectListenerRegistered) {
        filesystemRedirectListenerRegistered = true;
        window.addEventListener('openDeepthinkFilesystem', () => {
            const process = getActiveDeepthinkPipeline();
            if (!process) return;
            process.activeTabId = 'filesystem';
            renderActiveDeepthinkPipeline();
        });
    }

    initializeDeepthinkCore({
        ...dependencies,
        renderActiveDeepthinkPipeline
    });

    window.addEventListener('deepthinkPipelineUpdated', () => {
        if (getActiveDeepthinkPipeline()) {
            renderActiveDeepthinkPipeline();
        }
    });
}

// ============================================================================ 
// Modal Logic (React-rendered)
// ============================================================================ 

function ensureModalContainer(): HTMLElement {
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'deepthink-modal-portal';
        document.body.appendChild(modalContainer);
    }
    return modalContainer;
}

function ensureModalRoot(): Root {
    const container = ensureModalContainer();
    if (!modalRoot) {
        modalRoot = createRoot(container);
    }
    return modalRoot;
}

function mountModal(element: React.ReactElement): void {
    ensureModalRoot().render(element);
}

function unmountModal(): void {
    if (modalRoot) {
        modalRoot.render(null);
    }
    activeSolutionModalSubStrategyId = null;
    if (cleanupEvolvingDfsRoot) cleanupEvolvingDfsRoot();
}

function removeEvolvingDfsSolutionOverlay(immediate = true): void {
    const overlay = document.getElementById('solution-modal-overlay') as (HTMLElement & {
        cleanup?: () => void;
    }) | null;

    if (!overlay) {
        return;
    }

    overlay.cleanup?.();

    if (immediate) {
        overlay.remove();
    } else {
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (overlay.isConnected) {
                overlay.remove();
            }
        }, 200);
    }

    activeSolutionModalSubStrategyId = null;
    activeSolutionModalBranchVersion = undefined;
    cleanupEvolvingDfsRoot();
}

export async function openDeepthinkSolutionModal(subStrategyId: string, branchVersion?: number) {
    const pipeline = getActiveDeepthinkPipeline();
    const subStrategy = pipeline?.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId);
    if (!subStrategy) return;

    const evolvingDfsEnabled = pipeline ? isEvolvingRun(pipeline) : false;

    if (evolvingDfsEnabled) {
        removeEvolvingDfsSolutionOverlay(true);
        unmountModal();
        activeSolutionModalSubStrategyId = subStrategyId;
        activeSolutionModalBranchVersion = branchVersion;

        // For Evolving DFS corrections, we keep the imperative approach because it uses
        // the external ContextualUI component which has its own rendering lifecycle
        const overlay = document.createElement('div') as HTMLElement & { cleanup?: () => void };
        overlay.className = 'modal-overlay';
        overlay.id = 'solution-modal-overlay';
        overlay.style.display = 'flex';

        const content = document.createElement('div');
        content.className = 'modal-content';
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = branchVersion
            ? `Evolving Depth First Search - Branch v${branchVersion}`
            : 'Evolving Depth First Search';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-button';
        closeBtn.innerHTML = renderIconMarkup('close');
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';
        body.style.padding = '0';
        body.style.height = 'calc(100vh - 80px)';
        body.style.overflow = 'hidden';
        body.classList.add('contextual-mode-container');

        content.appendChild(header);
        content.appendChild(body);
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        const close = () => removeEvolvingDfsSolutionOverlay(false);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey);
        overlay.cleanup = () => document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.classList.add('is-visible'), 10);

        await updateSolutionModalContent(body, subStrategyId, branchVersion);
    } else {
        // Non-iterative: mount React components
        const close = () => unmountModal();
        mountModal(
            React.createElement(BaseModal, {
                title: 'Solution Details',
                onClose: close,
                children: React.createElement(DefaultSolutionUI, {
                    subStrategy,
                    refinementEnabled: pipeline ? isRefinementRun(pipeline) : false,
                })
            })
        );
    }
}

export function closeSolutionModal() {
    removeEvolvingDfsSolutionOverlay(false);
    unmountModal();
}

async function openSubStrategySolutionModal(subStrategyId: string, branchVersion?: number) {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;

    if (isEvolvingRun(pipeline)) {
        await openDeepthinkSolutionModal(subStrategyId, branchVersion);
        return;
    }

    const subStrategy = pipeline.initialStrategies.flatMap(s => s.subStrategies).find(sub => sub.id === subStrategyId);
    if (!subStrategy) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: 'Sub-Strategy Solution',
            className: 'fullscreen-modal',
            onClose: close,
            children: React.createElement(SubStrategyComparisonUI, {
                subStrategy,
                refinementEnabled: isRefinementRun(pipeline),
            })
        })
    );
}

function openCritiqueModal(critiqueId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    const critique = pipeline?.solutionCritiques.find(c => c.id === critiqueId);
    if (!critique || document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: 'Solution Critique',
            isEmbedded: true,
            onClose: close,
            children: React.createElement(EmbeddedModalContent, {
                content: critique.critiqueResponseDisplay || critique.critiqueResponse || 'No critique available',
                interactionTraceText: critique.interactionTraceText,
            })
        })
    );
}

function openSubStrategyCritiqueModal(subStrategyId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    if (document.querySelector('.embedded-modal-overlay')) return;

    let subStrategy: any = null;
    let mainStrategyId = '';
    for (const strategy of pipeline?.initialStrategies ?? []) {
        subStrategy = strategy.subStrategies.find(sub => sub.id === subStrategyId);
        if (subStrategy) { mainStrategyId = strategy.id; break; }
    }
    if (!subStrategy?.solutionCritique) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: `Solution Critique - ${mainStrategyId}`,
            isEmbedded: true,
            onClose: close,
            children: React.createElement(EmbeddedModalContent, {
                content: subStrategy.solutionCritiqueDisplay || subStrategy.solutionCritique,
                interactionTraceText: subStrategy.solutionCritiqueTraceText,
            })
        })
    );
}

function openHypothesisArgumentModal(hypothesisId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    const allHypotheses = [
        ...((pipeline?.hypothesisHistory || []).flat()),
        ...(pipeline?.hypotheses || []),
    ];
    const hypothesis = allHypotheses.find(h => h.id === hypothesisId);
    if (!hypothesis || document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: 'Hypothesis Argument',
            isEmbedded: true,
            onClose: close,
            children: React.createElement(EmbeddedModalContent, {
                content: hypothesis.testerAttemptDisplay || hypothesis.testerAttempt || 'No argument available',
                contentClass: 'hypothesis-argument-content',
                interactionTraceText: hypothesis.testerAttemptTraceText,
            })
        })
    );
}

function openPostQualityFilterModal(agent: DeepthinkPostQualityFilterData) {
    if (document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: `Evolution Filter Iteration ${agent.iterationNumber} - Analysis`,
            isEmbedded: true,
            onClose: close,
            children: React.createElement(StructuredResponseModalContent, {
                reasoning: agent.reasoning,
                interactionTraceText: agent.interactionTraceText,
                resultsClassName: 'post-quality-filter-results',
                emptyMessage: 'No analysis available',
            })
        })
    );
}

// Update active modal content dynamically (for Evolving Depth First Search)
function findStrategyForSubStrategy(pipeline: DeepthinkPipelineState | null, subStrategyId: string) {
    for (const strategy of pipeline?.initialStrategies ?? []) {
        const subStrategy = strategy.subStrategies.find(sub => sub.id === subStrategyId);
        if (subStrategy) return { strategy, subStrategy };
    }
    return null;
}

function readIterationBranchVersion(iteration: any): number | undefined {
    if (typeof iteration.branchVersion === 'number' && iteration.branchVersion > 0) return iteration.branchVersion;
    if (typeof iteration.branchVersion === 'string') {
        const parsed = parseInt(iteration.branchVersion, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    const labelMatch = String(iteration.label || '').match(/\bBranch\s+v(\d+)\b/i);
    if (labelMatch) {
        const parsed = parseInt(labelMatch[1], 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return undefined;
}

function isCurrentBranchIteration(strategy: DeepthinkMainStrategyData, iteration: any, targetBranchVersion: number): boolean {
    const iterationBranchVersion = readIterationBranchVersion(iteration);
    if (iterationBranchVersion !== undefined) return iterationBranchVersion === targetBranchVersion;

    const hasEverBeenReplaced = (strategy.replacementHistory || []).length > 0;
    return targetBranchVersion === 1 && !hasEverBeenReplaced;
}

async function updateSolutionModalContent(modalBody: HTMLElement, subStrategyId: string, branchVersion?: number) {
    const pipeline = getActiveDeepthinkPipeline();
    const found = findStrategyForSubStrategy(pipeline, subStrategyId);
    if (!found) return;
    const { strategy, subStrategy } = found;
    const targetBranchVersion = branchVersion || strategy.branchVersion || 1;
    const isCurrentBranch = targetBranchVersion === (strategy.branchVersion || 1);

    const replacementRecord = isCurrentBranch
        ? undefined
        : (strategy.replacementHistory || []).find(record => record.previousBranchVersion === targetBranchVersion);

    const evolvingDfsData = subStrategy.evolvingDfs;
    const activeIterations = isCurrentBranch
        ? (evolvingDfsData?.iterations || []).filter((iteration: any) =>
            isCurrentBranchIteration(strategy, iteration, targetBranchVersion)
        )
        : [];
    const retiredHistoryLength = replacementRecord?.branchHistory?.length || 1;
    const retiredIterations = (replacementRecord?.branchHistory || []).map(entry => ({
        iterationNumber: entry.branchIteration,
        globalIteration: entry.globalIteration,
        branchIteration: entry.branchIteration,
        branchVersion: entry.branchVersion || targetBranchVersion,
        critique: entry.critiqueDisplay || entry.critique,
        correctedSolution: entry.solutionDisplay || entry.solution,
        timestamp: Date.now() - Math.max(1, retiredHistoryLength - entry.branchIteration) * 1000,
        label: entry.label,
    }));
    const iterations = (isCurrentBranch ? activeIterations : retiredIterations).map((iteration: any) => ({
        ...iteration,
        critique: iteration.critiqueDisplay || iteration.critique,
        correctedSolution: iteration.correctedSolutionDisplay || iteration.correctedSolution,
    }));
    const originalSolution = isCurrentBranch
        ? iterations[0]?.correctedSolution || subStrategy.solutionAttemptDisplay || subStrategy.solutionAttempt || 'Processing...'
        : iterations[0]?.correctedSolution || replacementRecord?.latestSolutionDisplay || replacementRecord?.latestSolution || 'Retired branch solution not available.';
    const latestCorrection = iterations.length > 0 ? iterations[iterations.length - 1]?.correctedSolution : null;
    const currentBestSolution = latestCorrection || (isCurrentBranch
        ? subStrategy.refinedSolutionDisplay || subStrategy.refinedSolution || subStrategy.solutionAttemptDisplay || subStrategy.solutionAttempt
        : replacementRecord?.latestSolutionDisplay || replacementRecord?.latestSolution) || 'Processing...';
    const latestIteration = iterations.length > 0 ? iterations[iterations.length - 1] : undefined;
    const currentArtifactTraceText = latestIteration?.correctedSolutionTraceText
        || (isCurrentBranch ? subStrategy.refinedSolutionTraceText || subStrategy.solutionAttemptTraceText : undefined);

    const isProcessing = subStrategy.status === 'processing' ||
        subStrategy.status === 'pending' ||
        subStrategy.solutionCritiqueStatus === 'processing' ||
        subStrategy.solutionCritiqueStatus === 'pending' ||
        subStrategy.selfImprovementStatus === 'processing' ||
        subStrategy.selfImprovementStatus === 'pending' ||
        evolvingDfsData?.status === 'processing';

    const { renderEvolvingDfsUI } = await import('../Contextual/ContextualUI');
    await renderEvolvingDfsUI(
        modalBody,
        originalSolution,
        currentBestSolution,
        iterations,
        isCurrentBranch ? isProcessing : false,
        currentArtifactTraceText
    );
}

async function updateActiveSolutionModal() {
    if (activeSolutionModalSubStrategyId && document.getElementById('solution-modal-overlay')) {
        const modalBody = document.querySelector('#solution-modal-overlay .modal-body') as HTMLElement;
        if (modalBody) {
            await updateSolutionModalContent(modalBody, activeSolutionModalSubStrategyId, activeSolutionModalBranchVersion);
        }
    }
}

export function activateDeepthinkStrategyTab(strategyIndex: number) {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;
    pipeline.activeStrategyTab = strategyIndex;
    renderActiveDeepthinkPipeline();
}

function syncDeepthinkDomReferences() {
    const nextTabsNavContainer = document.getElementById('tabs-nav-container');
    const nextPipelinesContentContainer = document.getElementById('pipelines-content-container');

    moduleState.tabsNavContainer = nextTabsNavContainer;
    moduleState.pipelinesContentContainer = nextPipelinesContentContainer;
}

// ============================================================================ 
// Main Pipeline Render
// ============================================================================ 

export function renderActiveDeepthinkPipeline() {
    const deepthinkProcess = getActiveDeepthinkPipeline();
    syncDeepthinkDomReferences();
    const { tabsNavContainer, pipelinesContentContainer } = moduleState;

    if (!deepthinkProcess || !tabsNavContainer || !pipelinesContentContainer) {
        if (!moduleState.tabsNavContainer || !moduleState.pipelinesContentContainer || !deepthinkProcess) return;
    }

    // Restore UI state
    const sidebarBtn = document.getElementById('sidebar-collapse-button') as HTMLButtonElement;
    if (sidebarBtn) {
        sidebarBtn.disabled = false;
        sidebarBtn.style.opacity = '';
        sidebarBtn.style.cursor = '';
    }

    const header = document.querySelector('.main-header-content') as HTMLElement;
    if (header) header.style.display = '';
    moduleState.tabsNavContainer!.style.display = '';

    updateActiveSolutionModal().catch(() => { });

    // Clear Previous
    moduleState.tabsNavContainer!.innerHTML = '';

    // Unmount existing React content root ONLY if the container is different (which shouldn't happen)
    // We want to reuse the root for React 18 update semantics to avoid synchronous unmount errors

    const tabs = getVisibleDeepthinkTabs(deepthinkProcess);

    if (!tabs.some(t => t.id === deepthinkProcess.activeTabId) && tabs.length > 0) {
        deepthinkProcess.activeTabId = tabs[0].id;
    }

    // Render Tab buttons (imperative — lightweight DOM, React overhead not needed here)
    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.id = `deepthink-tab-${tab.id}`;
        btn.className = `tab-button deepthink-mode-tab ${deepthinkProcess.activeTabId === tab.id ? 'active' : ''} ${tab.statusClass} ${tab.alignRight ? 'align-right' : ''}`;
        btn.innerHTML = `${renderIconMarkup(tab.icon)}${tab.label}`;
        btn.addEventListener('click', () => {
            deepthinkProcess.activeTabId = tab.id;
            renderActiveDeepthinkPipeline();
        });
        moduleState.tabsNavContainer!.appendChild(btn);
    });

    // Mount or update React content root
    const contentContainer = moduleState.pipelinesContentContainer!;

    // Unmount explicitly if the DOM node was wiped by the AppRouter
    if (pipelineContentRoot && pipelineContentContainerNode && !document.contains(pipelineContentContainerNode)) {
        const oldRoot = pipelineContentRoot;
        setTimeout(() => oldRoot.unmount(), 0);
        pipelineContentRoot = null;
        pipelineContentContainerNode = null;
    }

    if (!pipelineContentRoot) {
        contentContainer.innerHTML = '';
        pipelineContentContainerNode = document.createElement('div');
        pipelineContentContainerNode.className = 'deepthink-pipeline-react-root';
        contentContainer.appendChild(pipelineContentContainerNode);

        pipelineContentRoot = createRoot(pipelineContentContainerNode);
    }

    const tabContent = createDeepthinkTabContent(deepthinkProcess);
    pipelineContentRoot.render(tabContent);

}

type DeepthinkTabContentCallbacks = {
    onStrategyTabClick?: (idx: number) => void;
    onViewSolution?: (id: string, branchVersion?: number) => void;
    onViewArgument?: (id: string) => void;
    onViewCritique?: (id: string) => void;
    onViewSubStrategyCritique?: (id: string) => void;
    onViewReasoning?: (id: string) => void;
    hideStopButton?: boolean;
};

export function getVisibleDeepthinkTabs(process: DeepthinkPipelineState): DeepthinkTabDefinition[] {
    const hasPostQualityFilter = process.postQualityFilterAgents?.length > 0;
    const isHypothesisEnabled = process.runConfig
        ? process.runConfig.hypothesisCount > 0
        : process.hypotheses.length > 0 || (process.hypothesisHistory?.length || 0) > 0;
    const isDissectedEnabled = hasDissectedSurface(process);

    return [
        { id: 'live', label: 'Live', icon: 'terminal', visible: true },
        { id: 'filesystem', label: 'Filesystem', icon: 'folder', visible: true },
        { id: 'strategic-solver', label: 'Strategic Solver', icon: 'psychology', visible: true },
        { id: 'hypothesis-explorer', label: 'Hypothesis Explorer', icon: 'science', visible: isHypothesisEnabled },
        { id: 'solution-pool', label: 'Solution Pool', icon: 'database', visible: process.structuredSolutionPoolEnabled },
        { id: 'dissected-observations', label: 'Dissected Observations', icon: 'troubleshoot', visible: isDissectedEnabled },
        { id: 'evolution-filter', label: 'Evolution Filter', icon: 'security', visible: hasPostQualityFilter },
        { id: 'final-result', label: 'Final Result', icon: 'flag', visible: true, alignRight: true }
    ]
        .filter(tab => tab.visible)
        .map(({ visible, ...tab }) => ({
            ...tab,
            statusClass: getTabStatusClass(tab.id, process)
        }));
}

export function createDeepthinkTabContent(
    process: DeepthinkPipelineState,
    callbacks: DeepthinkTabContentCallbacks = {}
): React.ReactElement {
    const onStrategyTabClick = callbacks.onStrategyTabClick ?? ((idx: number) => {
        process.activeStrategyTab = idx;
        renderActiveDeepthinkPipeline();
    });
    const onViewSolution = callbacks.onViewSolution ?? ((id: string, branchVersion?: number) => openSubStrategySolutionModal(id, branchVersion));
    const onViewArgument = callbacks.onViewArgument ?? ((id: string) => openHypothesisArgumentModal(id));
    const onViewCritique = callbacks.onViewCritique ?? ((id: string) => openCritiqueModal(id));
    const onViewSubStrategyCritique = callbacks.onViewSubStrategyCritique ?? ((id: string) => openSubStrategyCritiqueModal(id));
    const onViewReasoning = callbacks.onViewReasoning ?? ((id: string) => {
        const pqfAgent = process.postQualityFilterAgents.find(a => a.id === id);
        if (pqfAgent?.reasoning) {
            openPostQualityFilterModal(pqfAgent);
        }
    });

    switch (process.activeTabId) {
        case 'live':
            return React.createElement(DeepthinkLiveTab, { process, hideStopButton: callbacks.hideStopButton });
        case 'filesystem':
            return React.createElement(DeepthinkFilesystemTab, {
                key: process.id,
                repositoryId: process.id,
            });
        case 'strategic-solver':
            return React.createElement(StrategicSolverTab, {
                process,
                escapeHtml: moduleState.escapeHtml,
                onStrategyTabClick,
                onViewSolution,
            });
        case 'hypothesis-explorer':
            return React.createElement(HypothesisExplorerTab, {
                process,
                onViewArgument,
            });
        case 'solution-pool':
            return React.createElement(SolutionPoolTabContent, { process });
        case 'dissected-observations':
            return React.createElement(DissectedObservationsTab, {
                process,
                refinementEnabled: isRefinementRun(process),
                evolvingDfsEnabled: isEvolvingRun(process),
                onViewCritique,
                onViewSubStrategyCritique,
            });
        case 'evolution-filter':
            return React.createElement(EvolutionFilterTab, {
                process,
                onViewReasoning,
            });
        case 'final-result':
            return React.createElement(FinalResultTab, {
                process,
                escapeHtml: moduleState.escapeHtml,
            });
        default:
            return React.createElement(DeepthinkLiveTab, { process });
    }
}

// ============================================================================ 
// Tab Status Helper
// ============================================================================ 

function getTabStatusClass(tabId: string, process: DeepthinkPipelineState): string {
    switch (tabId) {
        case 'live':
            if (process.status === 'error') return 'status-deepthink-error';
            if (process.status === 'completed') return 'status-deepthink-completed';
            if (process.status === 'processing') return 'status-deepthink-processing';
            return '';
        case 'strategic-solver':
            if (process.status === 'error') return 'status-deepthink-error';
            if (process.initialStrategies?.some(s => s.status === 'completed')) return 'status-deepthink-completed';
            if (process.initialStrategies?.some(s => s.status === 'processing')) return 'status-deepthink-processing';
            return '';
        case 'hypothesis-explorer':
            return process.hypothesisExplorerComplete ? 'status-deepthink-completed' : '';
        case 'solution-pool':
            if (process.structuredSolutionPoolStatus === 'completed') return 'status-deepthink-completed';
            if (process.structuredSolutionPoolStatus === 'processing') return 'status-deepthink-processing';
            if (process.structuredSolutionPoolStatus === 'error') return 'status-deepthink-error';
            return '';
        case 'dissected-observations':
            if (process.dissectedSynthesisStatus === 'completed') return 'status-deepthink-completed';
            if (process.dissectedSynthesisStatus === 'error') return 'status-deepthink-error';
            if (process.dissectedSynthesisStatus === 'processing' || process.solutionCritiquesStatus === 'processing') return 'status-deepthink-processing';
            return '';
        case 'evolution-filter':
            if (process.postQualityFilterStatus === 'completed') return 'status-deepthink-completed';
            if (process.postQualityFilterStatus === 'processing') return 'status-deepthink-processing';
            if (process.postQualityFilterStatus === 'error') return 'status-deepthink-error';
            return '';
        case 'final-result':
            if (process.finalJudgingStatus === 'completed') return 'status-deepthink-completed';
            if (process.finalJudgingStatus === 'error') return 'status-deepthink-error';
            if (process.finalJudgingStatus === 'processing') return 'status-deepthink-processing';
            return '';
        default: return '';
    }
}
