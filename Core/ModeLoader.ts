/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ModeLoader - Centralized lazy-loading and one-time initialization for heavy modes.
 */

import {
    routingManager,
    getSelectedModel,
    getSelectedTemperature,
    getSelectedTopP,
    getSelectedStrategiesCount,
    getSelectedSubStrategiesCount,
    getStrategyProximityLoops,
    getSelectedHypothesisCount,
    getHypothesisProximityLoops,
    getSelectedPqfAggressiveness,
    getRefinementEnabled,
    getSkipSubStrategies,
    getDissectedObservationsEnabled,
    getShareHypothesesToDissected,
    getEvolvingDfsEnabled,
    getEvolvingDfsDepth,
    getIsolateBranchesEnabled,
    getSolutionPoolDisabled,
    getProvideAllSolutionsToCorrectors,
    getPostQualityFilterEnabled,
    callAI,
    getHypothesisInjectionMode,
    getSelectedThinkingLevel
} from '../Routing';
import { parseJsonSafe } from './JsonParser';
import { globalState } from './State';
import { updateControlsState } from '../UI/Controls';
import { setupCodeExecutionToggle } from '../UI/setupCodeExecutionToggle';

type DeepthinkModule = typeof import('../Deepthink/Deepthink');
type SolutionPoolModule = typeof import('../Deepthink/SolutionPool');
type ContextualModule = typeof import('../Contextual/Contextual');
type AdaptiveDeepthinkModule = typeof import('../AdaptiveDeepthink/AdaptiveDeepthinkMode');

let deepthinkModule: DeepthinkModule | null = null;
let deepthinkModulePromise: Promise<DeepthinkModule> | null = null;
let deepthinkInitialized = false;

let solutionPoolModule: SolutionPoolModule | null = null;
let solutionPoolModulePromise: Promise<SolutionPoolModule> | null = null;

let contextualModule: ContextualModule | null = null;
let contextualModulePromise: Promise<ContextualModule> | null = null;
let contextualInitialized = false;

let adaptiveDeepthinkModule: AdaptiveDeepthinkModule | null = null;
let adaptiveDeepthinkModulePromise: Promise<AdaptiveDeepthinkModule> | null = null;

async function loadDeepthinkModule(): Promise<DeepthinkModule> {
    if (!deepthinkModulePromise) {
        deepthinkModulePromise = import('../Deepthink/Deepthink').then((mod) => {
            deepthinkModule = mod;
            return mod;
        });
    }
    return deepthinkModulePromise;
}

async function loadSolutionPoolModule(): Promise<SolutionPoolModule> {
    if (!solutionPoolModulePromise) {
        solutionPoolModulePromise = import('../Deepthink/SolutionPool').then((mod) => {
            solutionPoolModule = mod;
            return mod;
        });
    }
    return solutionPoolModulePromise;
}

async function loadContextualModule(): Promise<ContextualModule> {
    if (!contextualModulePromise) {
        contextualModulePromise = import('../Contextual/Contextual').then((mod) => {
            contextualModule = mod;
            return mod;
        });
    }
    return contextualModulePromise;
}

async function loadAdaptiveDeepthinkModule(): Promise<AdaptiveDeepthinkModule> {
    if (!adaptiveDeepthinkModulePromise) {
        adaptiveDeepthinkModulePromise = import('../AdaptiveDeepthink/AdaptiveDeepthinkMode').then((mod) => {
            adaptiveDeepthinkModule = mod;
            return mod;
        });
    }
    return adaptiveDeepthinkModulePromise;
}

export async function ensureDeepthinkInitialized(): Promise<DeepthinkModule> {
    const mod = await loadDeepthinkModule();
    if (!deepthinkInitialized) {
        mod.initializeDeepthinkModule({
            getAIProvider: () => routingManager.getAIProvider(),
            callGemini: callAI,
            parseJsonSafe,
            updateControlsState,
            escapeHtml: (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
            getSelectedTemperature,
            getSelectedModel,
            getSelectedTopP,
            getSelectedStrategiesCount,
            getSelectedSubStrategiesCount,
            getStrategyProximityLoops,
            getSelectedHypothesisCount,
            getHypothesisProximityLoops,
            getSelectedPqfAggressiveness,
            getRefinementEnabled,
            getSkipSubStrategies,
            getDissectedObservationsEnabled,
            getShareHypothesesToDissected,
            getEvolvingDfsEnabled,
            getEvolvingDfsDepth,
            getIsolateBranchesEnabled,
            getSolutionPoolDisabled,
            getProvideAllSolutionsToCorrectors,
            getPostQualityFilterEnabled,
            getDeepthinkCodeExecutionEnabled: () => routingManager.getDeepthinkConfigController().isCodeExecutionEnabled(),
            getHypothesisInjectionMode,
            getSelectedThinkingLevel,
            getCustomPromptsDeepthinkState: () =>
                routingManager.getPromptsManager()?.getDeepthinkPrompts()
                || globalState.customPromptsDeepthinkState,
            tabsNavContainer: document.getElementById('tabs-nav-container'),
            pipelinesContentContainer: document.getElementById('pipelines-content-container'),
            setActiveDeepthinkPipeline: (pipeline: any) => {
                globalState.activeDeepthinkPipeline = pipeline as any;
            }
        });
        deepthinkInitialized = true;
    }
    await loadSolutionPoolModule();
    return mod;
}

export async function ensureContextualInitialized(): Promise<ContextualModule> {
    const mod = await loadContextualModule();
    if (!contextualInitialized) {
        setupCodeExecutionToggle();
        contextualInitialized = true;
    }
    return mod;
}

export async function ensureAdaptiveDeepthinkInitialized(): Promise<AdaptiveDeepthinkModule> {
    return loadAdaptiveDeepthinkModule();
}

export function getLoadedDeepthinkModule(): DeepthinkModule | null {
    return deepthinkModule;
}

export function getLoadedSolutionPoolModule(): SolutionPoolModule | null {
    return solutionPoolModule;
}

export function getLoadedContextualModule(): ContextualModule | null {
    return contextualModule;
}

export function getLoadedAdaptiveDeepthinkModule(): AdaptiveDeepthinkModule | null {
    return adaptiveDeepthinkModule;
}
