/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoutingManager } from './RoutingManager';

// Export all routing-related functionality
export { ApiKeyManager, type ApiKeyStatus } from './ApiConfig';
export { ModelConfigManager, type ModelParameters, type ModelOption, AVAILABLE_MODELS, DEFAULT_TEMPERATURES, DEFAULT_MODEL_PARAMETERS } from './ModelConfig';
export { DeepthinkConfigController, type DeepthinkConfigState, type DeepthinkConfigChangeEvent } from './DeepthinkConfigController';
export { ApiKeyUI } from './ApiKeyUI';
export { ModelSelectionUI } from './ModelSelectionUI';
export { PromptsManager } from './PromptsManager';
export { PromptsModal } from './PromptsModal';
export { RoutingManager } from './RoutingManager';
export { type AIProvider, createAIProvider } from './AIProvider';
export { ProviderManager, type ProviderConfig, type ModelInfo } from './ProviderManager';
export { ProviderManagementUI } from './ProviderManagementUI';
export { callAI, callGemini } from './AIService';


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

// Convenience functions for backward compatibility
export function getSelectedModel(): string {
    return getRoutingManager().getSelectedModel();
}

export function getSelectedThinkingLevel(): 'low' | 'medium' | 'high' | 'minimal' {
    return getRoutingManager().getThinkingLevel();
}

export function getSelectedTemperature(): number {
    return getRoutingManager().getTemperature();
}

export function getSelectedTopP(): number {
    return getRoutingManager().getTopP();
}

export function getSelectedStrategiesCount(): number {
    return getRoutingManager().getStrategiesCount();
}

export function getSelectedSubStrategiesCount(): number {
    return getRoutingManager().getSubStrategiesCount();
}

export function getSelectedHypothesisCount(): number {
    return getRoutingManager().getHypothesisCount();
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

export function getProvideAllSolutionsToCorrectors(): boolean {
    return getRoutingManager().isProvideAllSolutionsToCorrectors();
}

export function getPostQualityFilterEnabled(): boolean {
    return getRoutingManager().isPostQualityFilterEnabled();
}

export function getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
    return getRoutingManager().getHypothesisInjectionMode();
}

export function getAIProvider() {
    return getRoutingManager().getAIProvider();
}

export function hasValidApiKey(): boolean {
    return getRoutingManager().hasValidApiKey();
}

export function getDeepthinkPrompts() {
    return getRoutingManager().getDeepthinkPrompts();
}

export function updateCustomPromptTextareasFromState() {
    // No-op: React-controlled components auto-sync from their managers.
    // Kept for backward compatibility with ConfigManager.ts imports.
}

export function getProviderForCurrentModel(): string {
    const manager = getRoutingManager();
    const modelConfigManager = manager.getModelConfigManager();
    const selectedModel = modelConfigManager.getSelectedModel();

    // Get provider from the model's configuration
    // getModelProvider returns the provider string (e.g., 'gemini', 'openai', 'anthropic')
    const provider = modelConfigManager.getModelProvider(selectedModel);

    // Normalize 'google' to 'gemini' for consistency
    return provider === 'google' ? 'gemini' : provider;
}