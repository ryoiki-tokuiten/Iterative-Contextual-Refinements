/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoutingManager } from './RoutingManager';

export { callAI } from './AIService';


// Global routing manager instance - initialized lazily
let routingManagerInstance: RoutingManager | null = null;

// Get or create the routing manager instance
export function getRoutingManager(): RoutingManager {
    if (!routingManagerInstance) {
        routingManagerInstance = new RoutingManager();
    }
    return routingManagerInstance;
}

// Initialize routing when this module is imported
export function initializeRouting(): void {
    const manager = getRoutingManager();
    manager.initialize();
}

// Export the routing manager for direct access
export const routingManager = getRoutingManager();

// Get the DeepthinkConfigController for centralized Deepthink config management
export function getDeepthinkConfigController() {
    return getRoutingManager().getDeepthinkConfigController();
}

// Convenience functions for shared routing consumers
export function getSelectedModel(): string {
    return getRoutingManager().getSelectedModel();
}

export function getSelectedThinkingLevel(): 'low' | 'medium' | 'high' | 'minimal' {
    return getRoutingManager().getThinkingLevel();
}

export function getSelectedStrategiesCount(): number {
    return getRoutingManager().getStrategiesCount();
}

export function getSelectedSubStrategiesCount(): number {
    return getRoutingManager().getSubStrategiesCount();
}

export function getStrategyProximityLoops(): number {
    return getRoutingManager().getStrategyProximityLoops();
}

export function getSelectedHypothesisCount(): number {
    return getRoutingManager().getHypothesisCount();
}

export function getHypothesisProximityLoops(): number {
    return getRoutingManager().getHypothesisProximityLoops();
}

export function getSelectedPqfAggressiveness(): string {
    return getRoutingManager().getPqfAggressiveness();
}

export function getRefinementEnabled(): boolean {
    return getRoutingManager().isRefinementEnabled();
}

export function getSkipSubStrategies(): boolean {
    return getRoutingManager().isSkipSubStrategies();
}

export function getDissectedObservationsEnabled(): boolean {
    return getRoutingManager().isDissectedObservationsEnabled();
}

export function getShareHypothesesToDissected(): boolean {
    return getRoutingManager().isShareHypothesesToDissected();
}

export function getEvolvingDfsEnabled(): boolean {
    return getRoutingManager().isEvolvingDfsEnabled();
}

export function getEvolvingDfsDepth(): number {
    return getRoutingManager().getEvolvingDfsDepth();
}

export function getIsolateBranchesEnabled(): boolean {
    return getRoutingManager().isIsolateBranchesEnabled();
}

export function getSolutionPoolDisabled(): boolean {
    return getRoutingManager().isSolutionPoolDisabled();
}

export function getProvideAllSolutionsToCorrectors(): boolean {
    return getRoutingManager().isProvideAllSolutionsToCorrectors();
}

export function getPostQualityFilterEnabled(): boolean {
    return getRoutingManager().isPostQualityFilterEnabled();
}

export function getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
    return getRoutingManager().getHypothesisInjectionMode();
}

export function hasValidApiKey(): boolean {
    return getRoutingManager().hasValidApiKey();
}

export function getProviderForCurrentModel(): string {
    const manager = getRoutingManager();
    const modelConfigManager = manager.getModelConfigManager();
    const selectedModel = modelConfigManager.getSelectedModel();

    const configuredProviderType = manager
        .getApiKeyManager()
        .getProviderManager()
        .getProviderTypeForModel(selectedModel);
    if (configuredProviderType) return configuredProviderType;

    // Get provider from the model's configuration
    // getModelProvider returns the provider string (e.g., 'gemini', 'openai', 'anthropic')
    const provider = modelConfigManager.getModelProvider(selectedModel);

    // Normalize 'google' to 'gemini' for consistency
    return provider === 'google' ? 'gemini' : provider;
}
