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
import { cleanupIterativeCorrectionsRoot } from '../Contextual/ContextualUI';
import { onHighlighterReady } from '../Styles/Shiki';
import {
    openSolutionPoolEvolution,
    downloadSolutionPoolAsJSON
} from './SolutionPool';
import {
    openSolutionPoolModal,
    openCurrentSolutionPool,
} from './SolutionPool.tsx';
import { parseJsonSafe } from "../Core/JsonParser";
import { renderIconMarkup } from '../UI/Icons';

// React component imports
import {
    BaseModal,
    DefaultSolutionUI,
    SubStrategyComparisonUI,
    EmbeddedModalContent,
    RedTeamReasoningContent,
    StructuredReasoningContent,
    StrategicSolverTab,
    HypothesisExplorerTab,
    DissectedObservationsTab,
    RedTeamTab,
    FinalResultTab,
} from './Deepthink.tsx';

import { SolutionPoolTabContent } from './SolutionPool.tsx';
import { DeepthinkLiveTab } from './DeepthinkLiveTab.tsx';

// Core Imports
import {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkRedTeamData,
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
    DeepthinkRedTeamData,
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

export interface DeepthinkTabDefinition {
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
    cleanTextOutput: (text: string) => string;
    getSelectedStrategiesCount: () => number;
    getSelectedSubStrategiesCount: () => number;
    getSelectedHypothesisCount: () => number;
    getSelectedRedTeamAggressiveness: () => string;
    getRefinementEnabled: () => boolean;
    getIterativeCorrectionsEnabled: () => boolean;
    getDissectedObservationsEnabled: () => boolean;
}

const moduleState: DeepthinkModuleState = {
    tabsNavContainer: null,
    pipelinesContentContainer: null,
    escapeHtml: (s) => s,
    cleanTextOutput: (s) => s,
    getSelectedStrategiesCount: () => 0,
    getSelectedSubStrategiesCount: () => 0,
    getSelectedHypothesisCount: () => 0,
    getSelectedRedTeamAggressiveness: () => 'off',
    getRefinementEnabled: () => false,
    getIterativeCorrectionsEnabled: () => false,
    getDissectedObservationsEnabled: () => false,
};

let activeSolutionModalSubStrategyId: string | null = null;

// React roots for React-rendered content
let pipelineContentRoot: Root | null = null;
let pipelineContentContainerNode: HTMLElement | null = null;
let modalRoot: Root | null = null;
let modalContainer: HTMLElement | null = null;
let deepthinkEventHandlerContainer: HTMLElement | null = null;

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
    getRefinementEnabled: () => boolean;
    getSelectedHypothesisCount: () => number;
    getSelectedRedTeamAggressiveness: () => string;
    getSkipSubStrategies: () => boolean;
    getDissectedObservationsEnabled: () => boolean;
    getShareHypothesesToDissected: () => boolean;
    getIterativeCorrectionsEnabled: () => boolean;
    getIterativeDepth: () => number;
    getProvideAllSolutionsToCorrectors: () => boolean;
    getPostQualityFilterEnabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    getModelProvider: () => string;
    getHypothesisInjectionMode: () => 'parallel' | 'strategy_aware' | 'selective_injection';
    getSelectedThinkingLevel?: () => 'low' | 'medium' | 'high' | 'minimal';
    cleanTextOutput: (text: string) => string;
    customPromptsDeepthinkState: CustomizablePromptsDeepthink;
    tabsNavContainer: HTMLElement | null;
    pipelinesContentContainer: HTMLElement | null;
    setActiveDeepthinkPipeline: (pipeline: DeepthinkPipelineState | null) => void;
}) {
    Object.assign(moduleState, {
        tabsNavContainer: dependencies.tabsNavContainer,
        pipelinesContentContainer: dependencies.pipelinesContentContainer,
        escapeHtml: dependencies.escapeHtml,
        cleanTextOutput: dependencies.cleanTextOutput,
        getSelectedStrategiesCount: dependencies.getSelectedStrategiesCount,
        getSelectedSubStrategiesCount: dependencies.getSelectedSubStrategiesCount,
        getSelectedHypothesisCount: dependencies.getSelectedHypothesisCount,
        getSelectedRedTeamAggressiveness: dependencies.getSelectedRedTeamAggressiveness,
        getRefinementEnabled: dependencies.getRefinementEnabled,
        getIterativeCorrectionsEnabled: dependencies.getIterativeCorrectionsEnabled,
        getDissectedObservationsEnabled: dependencies.getDissectedObservationsEnabled,
    });

    onHighlighterReady(() => {
        if (getActiveDeepthinkPipeline()) {
            renderActiveDeepthinkPipeline();
        }
    });

    initializeDeepthinkCore({
        ...dependencies,
        renderActiveDeepthinkPipeline
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
    if (cleanupIterativeCorrectionsRoot) cleanupIterativeCorrectionsRoot();
}

function removeIterativeSolutionOverlay(immediate = true): void {
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
    cleanupIterativeCorrectionsRoot();
}

export async function openDeepthinkSolutionModal(subStrategyId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    const subStrategy = pipeline?.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId);
    if (!subStrategy) return;

    const iterativeCorrectionsEnabled = moduleState.getIterativeCorrectionsEnabled();

    if (iterativeCorrectionsEnabled) {
        removeIterativeSolutionOverlay(true);
        unmountModal();
        activeSolutionModalSubStrategyId = subStrategyId;

        // For iterative corrections, we keep the imperative approach because it uses
        // the external ContextualUI component which has its own rendering lifecycle
        const overlay = document.createElement('div');
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
        title.textContent = 'Iterative Corrections';
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

        const close = () => removeIterativeSolutionOverlay(false);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey);
        (overlay as any).cleanup = () => document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.classList.add('is-visible'), 10);

        await updateSolutionModalContent(body, subStrategyId);
    } else {
        // Non-iterative: mount React components
        const close = () => unmountModal();
        mountModal(
            React.createElement(BaseModal, {
                title: 'Solution Details',
                onClose: close,
                children: React.createElement(DefaultSolutionUI, {
                    subStrategy,
                    refinementEnabled: moduleState.getRefinementEnabled(),
                })
            })
        );
    }
}

export function closeSolutionModal() {
    removeIterativeSolutionOverlay(false);
    unmountModal();
}

export async function openSubStrategySolutionModal(subStrategyId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;

    if (moduleState.getIterativeCorrectionsEnabled()) {
        await openDeepthinkSolutionModal(subStrategyId);
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
                refinementEnabled: moduleState.getRefinementEnabled(),
                escapeHtml: moduleState.escapeHtml,
            })
        })
    );
}

export function openCritiqueModal(critiqueId: string) {
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
                content: critique.critiqueResponse || 'No critique available',
            })
        })
    );
}

export function openSubStrategyCritiqueModal(subStrategyId: string) {
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
                content: subStrategy.solutionCritique,
            })
        })
    );
}

export function openHypothesisArgumentModal(hypothesisId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    const hypothesis = pipeline?.hypotheses.find(h => h.id === hypothesisId);
    if (!hypothesis || document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: 'Hypothesis Argument',
            isEmbedded: true,
            onClose: close,
            children: React.createElement(EmbeddedModalContent, {
                content: hypothesis.testerAttempt || 'No argument available',
                contentClass: 'hypothesis-argument-content',
            })
        })
    );
}

export function openRedTeamReasoningModal(agent: any) {
    if (document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: `Red Team Agent ${agent.id} - Evaluation`,
            isEmbedded: true,
            onClose: close,
            children: React.createElement(RedTeamReasoningContent, { agent, reasoningData: agent.reasoning })
        })
    );
}

export function openPostQualityFilterModal(agent: any) {
    if (document.querySelector('.embedded-modal-overlay')) return;

    const close = () => unmountModal();
    mountModal(
        React.createElement(BaseModal, {
            title: `PostQualityFilter Iteration ${agent.iterationNumber} - Analysis`,
            isEmbedded: true,
            onClose: close,
            children: React.createElement(StructuredReasoningContent, {
                reasoning: agent.reasoning,
                resultsClassName: 'post-quality-filter-results',
                emptyMessage: 'No analysis available',
            })
        })
    );
}

// Update active modal content dynamically (for iterative corrections)
async function updateSolutionModalContent(modalBody: HTMLElement, subStrategyId: string) {
    const pipeline = getActiveDeepthinkPipeline();
    const subStrategy = pipeline?.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId);
    if (!subStrategy) return;

    const iterativeCorrectionsData = (subStrategy as any).iterativeCorrections;
    const iterations = iterativeCorrectionsData?.iterations || [];
    const originalSolution = subStrategy.solutionAttempt || 'Processing...';
    const latestCorrection = iterations.length > 0 ? iterations[iterations.length - 1]?.correctedSolution : null;
    const currentBestSolution = latestCorrection || subStrategy.refinedSolution || subStrategy.solutionAttempt || 'Processing...';

    const isProcessing = subStrategy.selfImprovementStatus === 'processing' ||
        subStrategy.selfImprovementStatus === 'pending' ||
        iterativeCorrectionsData?.status === 'processing';

    const { renderIterativeCorrectionsUI } = await import('../Contextual/ContextualUI');
    await renderIterativeCorrectionsUI(modalBody, originalSolution, currentBestSolution, iterations, isProcessing);
}

export async function updateActiveSolutionModal() {
    if (activeSolutionModalSubStrategyId && document.getElementById('solution-modal-overlay')) {
        const modalBody = document.querySelector('#solution-modal-overlay .modal-body') as HTMLElement;
        if (modalBody) {
            await updateSolutionModalContent(modalBody, activeSolutionModalSubStrategyId);
        }
    }
}

// ============================================================================ 
// Event Handling
// ============================================================================ 

export function activateDeepthinkStrategyTab(strategyIndex: number) {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;
    pipeline.activeStrategyTab = strategyIndex;
    renderActiveDeepthinkPipeline();
}

function addDeepthinkEventHandlers() {
    const container = moduleState.pipelinesContentContainer;
    if (!container) return;

    if (deepthinkEventHandlerContainer === container) {
        return;
    }

    if (deepthinkEventHandlerContainer) {
        deepthinkEventHandlerContainer.removeEventListener('click', deepthinkClickHandler);
    }

    container.addEventListener('click', deepthinkClickHandler);
    deepthinkEventHandlerContainer = container;
}

function deepthinkClickHandler(event: Event) {
    const target = event.target as HTMLElement;
    if (!target || !getActiveDeepthinkPipeline()) return;

    const closest = (cls: string) => target.closest('.' + cls) as HTMLElement;

    if (closest('view-pool-button')) {
        event.preventDefault(); event.stopPropagation();
        if (document.querySelector('.embedded-modal-overlay')) return;
        const btn = closest('view-pool-button');
        const sid = btn.getAttribute('data-strategy-id');
        const iter = btn.getAttribute('data-iteration');
        if (sid && iter) openSolutionPoolModal(sid, parseInt(iter, 10));
        return;
    }

    if (closest('solution-pool-current-button')) {
        event.preventDefault(); event.stopPropagation();
        const pid = closest('solution-pool-current-button').getAttribute('data-pipeline-id');
        if (pid) openCurrentSolutionPool(pid);
        return;
    }

    if (closest('solution-pool-evolution-button')) {
        event.preventDefault(); event.stopPropagation();
        const pid = closest('solution-pool-evolution-button').getAttribute('data-pipeline-id');
        if (pid) openSolutionPoolEvolution(pid);
        return;
    }

    if (closest('solution-pool-download-button')) {
        event.preventDefault(); event.stopPropagation();
        const pid = closest('solution-pool-download-button').getAttribute('data-pipeline-id');
        if (pid) downloadSolutionPoolAsJSON(pid);
        return;
    }
}

function syncDeepthinkDomReferences() {
    const nextTabsNavContainer = document.getElementById('tabs-nav-container');
    const nextPipelinesContentContainer = document.getElementById('pipelines-content-container');

    if (deepthinkEventHandlerContainer && deepthinkEventHandlerContainer !== nextPipelinesContentContainer) {
        deepthinkEventHandlerContainer.removeEventListener('click', deepthinkClickHandler);
        deepthinkEventHandlerContainer = null;
    }

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

    addDeepthinkEventHandlers();
}

type DeepthinkTabContentCallbacks = {
    onStrategyTabClick?: (idx: number) => void;
    onViewSolution?: (id: string) => void;
    onViewArgument?: (id: string) => void;
    onViewCritique?: (id: string) => void;
    onViewSubStrategyCritique?: (id: string) => void;
    onViewReasoning?: (id: string) => void;
};

export function getVisibleDeepthinkTabs(process: DeepthinkPipelineState): DeepthinkTabDefinition[] {
    const isRedTeamEnabled = moduleState.getSelectedRedTeamAggressiveness() !== 'off';
    const hasPostQualityFilter = process.postQualityFilterAgents?.length > 0;
    const isHypothesisEnabled = moduleState.getSelectedHypothesisCount() > 0;
    const isDissectedEnabled = moduleState.getRefinementEnabled() || moduleState.getIterativeCorrectionsEnabled() || moduleState.getDissectedObservationsEnabled();

    return [
        { id: 'live', label: 'Live', icon: 'terminal', visible: true },
        { id: 'strategic-solver', label: 'Strategic Solver', icon: 'psychology', visible: true },
        { id: 'hypothesis-explorer', label: 'Hypothesis Explorer', icon: 'science', visible: isHypothesisEnabled },
        { id: 'solution-pool', label: 'Solution Pool', icon: 'database', visible: process.structuredSolutionPoolEnabled },
        { id: 'dissected-observations', label: 'Dissected Observations', icon: 'troubleshoot', visible: isDissectedEnabled },
        { id: 'red-team', label: 'Red Team', icon: 'security', visible: isRedTeamEnabled || hasPostQualityFilter },
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
    const onViewSolution = callbacks.onViewSolution ?? ((id: string) => openSubStrategySolutionModal(id));
    const onViewArgument = callbacks.onViewArgument ?? ((id: string) => openHypothesisArgumentModal(id));
    const onViewCritique = callbacks.onViewCritique ?? ((id: string) => openCritiqueModal(id));
    const onViewSubStrategyCritique = callbacks.onViewSubStrategyCritique ?? ((id: string) => openSubStrategyCritiqueModal(id));
    const onViewReasoning = callbacks.onViewReasoning ?? ((id: string) => {
        const rtAgent = process.redTeamEvaluations.find(a => a.id === id);
        if (rtAgent?.reasoning) {
            openRedTeamReasoningModal(rtAgent);
            return;
        }

        const pqfAgent = process.postQualityFilterAgents.find(a => a.id === id);
        if (pqfAgent?.reasoning) {
            openPostQualityFilterModal(pqfAgent);
        }
    });

    switch (process.activeTabId) {
        case 'live':
            return React.createElement(DeepthinkLiveTab, { process });
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
                escapeHtml: moduleState.escapeHtml,
                onViewArgument,
            });
        case 'solution-pool':
            return React.createElement(SolutionPoolTabContent, { process });
        case 'dissected-observations':
            return React.createElement(DissectedObservationsTab, {
                process,
                refinementEnabled: moduleState.getRefinementEnabled(),
                iterativeCorrectionsEnabled: moduleState.getIterativeCorrectionsEnabled(),
                onViewCritique,
                onViewSubStrategyCritique,
            });
        case 'red-team':
            return React.createElement(RedTeamTab, {
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
        case 'red-team':
            return process.redTeamComplete ? 'status-deepthink-completed' : '';
        case 'final-result':
            if (process.finalJudgingStatus === 'completed') return 'status-deepthink-completed';
            if (process.finalJudgingStatus === 'error') return 'status-deepthink-error';
            if (process.finalJudgingStatus === 'processing') return 'status-deepthink-processing';
            return '';
        default: return '';
    }
}
