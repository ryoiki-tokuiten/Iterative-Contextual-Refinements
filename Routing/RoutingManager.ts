/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiKeyManager } from './ApiConfig';
import { ModelConfigManager, ModelOption } from './ModelConfig';
import { ModelSelectionUI } from './ModelSelectionUI';
import { PromptsManager } from './PromptsManager';
import { PromptsModal } from './PromptsModal';
import { ProviderManager } from './ProviderManager';
import { ProviderManagementUI } from './ProviderManagementUI';
import { setApiKeyManager } from './AIService';
import { DeepthinkConfigController } from './DeepthinkConfigController';

export class RoutingManager {
    private apiKeyManager: ApiKeyManager;
    private modelConfigManager: ModelConfigManager;
    private deepthinkConfigController: DeepthinkConfigController;
    private promptsManager: PromptsManager | null = null;
    private promptsModal: PromptsModal | null = null;
    private modelSelectionUI: ModelSelectionUI | null = null;
    private providerManager: ProviderManager;
    private providerManagementUI: ProviderManagementUI | null = null;

    constructor() {
        this.apiKeyManager = new ApiKeyManager();
        this.modelConfigManager = new ModelConfigManager();
        this.deepthinkConfigController = new DeepthinkConfigController(this.modelConfigManager);
        this.providerManager = this.apiKeyManager.getProviderManager();
        // Initialize AI service with the API key manager
        setApiKeyManager(this.apiKeyManager);
    }

    public initialize(): void {
        // Initialize prompts modal first
        if (!this.promptsModal) {
            this.promptsModal = new PromptsModal();
            this.promptsModal.setModelConfig(this.modelConfigManager);
        }

        // Initialize provider management UI with prompts modal
        if (!this.providerManagementUI) {
            this.providerManagementUI = new ProviderManagementUI(this.providerManager, this.promptsModal);
            // Set up callback to refresh models when providers change
            this.providerManagementUI.setOnModelsChangedCallback(() => {
                this.refreshProviders();
            });
        }

        // Subscribe to provider manager updates
        this.providerManager.addModelUpdateListener(() => {
            this.updateAvailableModels();
        });

        // Initialize UI components only when DOM is ready
        if (!this.modelSelectionUI) {
            this.modelSelectionUI = new ModelSelectionUI(this.modelConfigManager, this.deepthinkConfigController, this.providerManager);
        }

        // Update available models from provider manager
        this.updateAvailableModels();

        // Initialize model selection UI
        this.modelSelectionUI.initialize();
    }

    public getThinkingLevel(): 'low' | 'medium' | 'high' | 'minimal' {
        return this.modelConfigManager.getThinkingLevel();
    }



    private updateAvailableModels(): void {
        const allModels = this.providerManager.getAllModels();
        const modelOptions: ModelOption[] = allModels.map(model => ({
            value: model.id,
            label: `${model.id} (${model.provider})`,
            description: `${model.provider} model`,
            provider: model.provider
        }));

        this.modelConfigManager.setAvailableModels(modelOptions);

        // Update model selection UI if it exists
        if (this.modelSelectionUI) {
            this.modelSelectionUI.updateModelOptions();
        }
    }

    public refreshProviders(): void {
        this.updateAvailableModels();
        if (this.providerManagementUI) {
            this.providerManagementUI.updateTriggerState();
        }
    }

    public getApiKeyManager(): ApiKeyManager {
        return this.apiKeyManager;
    }

    public getModelConfigManager(): ModelConfigManager {
        return this.modelConfigManager;
    }

    public getDeepthinkConfigController(): DeepthinkConfigController {
        return this.deepthinkConfigController;
    }

    public getProviderManagementUI(): ProviderManagementUI | null {
        return this.providerManagementUI;
    }

    public getModelSelectionUI(): ModelSelectionUI | null {
        return this.modelSelectionUI;
    }

    public getPromptsManager(): PromptsManager | null {
        return this.promptsManager;
    }

    public getPromptsModal(): PromptsModal | null {
        return this.promptsModal;
    }

    public initializePromptsManager(
        deepthinkPromptsRef: { current: any },
        agenticPromptsRef?: { current: any },
        adaptiveDeepthinkPromptsRef?: { current: any },
        contextualPromptsRef?: { current: any },
        dcaPromptsRef?: { current: any }
    ): void {
        this.promptsManager = new PromptsManager(
            deepthinkPromptsRef,
            agenticPromptsRef,
            adaptiveDeepthinkPromptsRef,
            contextualPromptsRef,
            dcaPromptsRef
        );

        // Connect PromptsManager to PromptsModal for model selector state management
        if (this.promptsModal) {
            this.promptsModal.setPromptsManager(this.promptsManager);
        }
    }

    // Convenience methods for accessing common functionality
    public getSelectedModel(): string {
        return this.modelConfigManager.getSelectedModel();
    }

    public getTemperature(): number {
        return this.modelConfigManager.getTemperature();
    }

    public getTopP(): number {
        return this.modelConfigManager.getTopP();
    }

    public getStrategiesCount(): number {
        return this.modelConfigManager.getStrategiesCount();
    }

    public getSubStrategiesCount(): number {
        return this.modelConfigManager.getSubStrategiesCount();
    }

    public getHypothesisCount(): number {
        return this.modelConfigManager.getHypothesisCount();
    }

    public getPqfAggressiveness(): string {
        return this.modelConfigManager.getPqfAggressiveness();
    }

    public isRefinementEnabled(): boolean {
        return this.modelConfigManager.isRefinementEnabled();
    }

    public isSkipSubStrategies(): boolean {
        return this.modelConfigManager.isSkipSubStrategies();
    }

    public isDissectedObservationsEnabled(): boolean {
        return this.modelConfigManager.isDissectedObservationsEnabled();
    }

    public isShareHypothesesToDissected(): boolean {
        return this.modelConfigManager.isShareHypothesesToDissected();
    }

    public isEvolvingDfsEnabled(): boolean {
        return this.modelConfigManager.isEvolvingDfsEnabled();
    }

    public getEvolvingDfsDepth(): number {
        return this.modelConfigManager.getEvolvingDfsDepth();
    }

    public isProvideAllSolutionsToCorrectors(): boolean {
        return this.modelConfigManager.isProvideAllSolutionsToCorrectors();
    }

    public isPostQualityFilterEnabled(): boolean {
        return this.modelConfigManager.isPostQualityFilterEnabled();
    }

    public getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
        return this.modelConfigManager.getHypothesisInjectionMode();
    }

    public hasValidApiKey(): boolean {
        return this.apiKeyManager.hasValidApiKey();
    }

    public getAIProvider() {
        return this.apiKeyManager.getAIProvider();
    }

    // Convenience methods for accessing prompt states
    public getDeepthinkPrompts() {
        return this.promptsManager?.getDeepthinkPrompts();
    }

    public getAgenticPromptsManager() {
        return this.promptsManager?.getAgenticPromptsManager();
    }

    public getAgenticPrompts() {
        return this.promptsManager?.getAgenticPrompts();
    }

    public setCurrentMode(mode: string) {
        if (this.promptsModal) {
            this.promptsModal.setCurrentMode(mode);
        }
    }

    public updatePromptsModalState(isGenerating: boolean) {
        if (this.promptsModal) {
            this.promptsModal.updateTriggerState(isGenerating);
        }
    }
}