/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { nanoid } from 'nanoid';
import { AIProvider, createAIProvider, DiscoveredModel } from './AIProvider';

export type ProviderType = 'gemini' | 'openai' | 'anthropic' | 'local' | 'openai-compatible';

export interface ProviderCapabilityOverrides {
    supportsTools?: boolean;
    supportsImageInput?: boolean;
    supportsStructuredOutputs?: boolean;
}

export interface ProviderConfig {
    /** Stable registry key. Generic endpoint instances each have their own key. */
    name: string;
    displayName: string;
    providerType?: ProviderType;
    apiKey?: string;
    baseURL?: string;
    models: string[];
    capabilityOverrides?: ProviderCapabilityOverrides;
    isConfigured: boolean;
}

export interface ModelInfo {
    /** Internal selection key; generic endpoints are provider-qualified. */
    id: string;
    /** Actual model ID sent to the configured endpoint. */
    modelId?: string;
    provider: string;
    providerDisplayName?: string;
    displayName?: string;
}

const DEFAULT_MODELS: Partial<Record<ProviderType, string[]>> = {
    gemini: [],
    anthropic: [],
    openai: [],
};

const REMOTE_PROVIDER_TYPES = new Set<ProviderType>([
    'gemini',
    'openai',
    'anthropic',
    'openai-compatible',
]);

const OPENAI_COMPATIBLE_PREFIX = 'openai-compatible:';
const MODEL_SELECTION_SEPARATOR = '::';

export function isOpenAICompatibleProvider(provider: ProviderConfig | string): boolean {
    if (typeof provider === 'string') {
        return provider.toLowerCase().startsWith(OPENAI_COMPATIBLE_PREFIX);
    }
    return provider.providerType === 'openai-compatible' || provider.name.toLowerCase().startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function getProviderType(provider: ProviderConfig | string): ProviderType {
    if (typeof provider === 'string') {
        return isOpenAICompatibleProvider(provider) ? 'openai-compatible' : provider as ProviderType;
    }
    return provider.providerType ?? getProviderType(provider.name);
}

export function getModelSelectionKey(providerName: string, modelId: string): string {
    return isOpenAICompatibleProvider(providerName)
        ? `${providerName}${MODEL_SELECTION_SEPARATOR}${modelId}`
        : modelId;
}

export function getModelIdFromSelection(selectionId: string): string {
    const separatorIndex = selectionId.indexOf(MODEL_SELECTION_SEPARATOR);
    return separatorIndex === -1
        ? selectionId
        : selectionId.slice(separatorIndex + MODEL_SELECTION_SEPARATOR.length);
}

function getProviderNameFromSelection(selectionId: string): string | null {
    const separatorIndex = selectionId.indexOf(MODEL_SELECTION_SEPARATOR);
    if (separatorIndex === -1) return null;

    const providerName = selectionId.slice(0, separatorIndex);
    return isOpenAICompatibleProvider(providerName) ? providerName : null;
}

function getDefaultModels(config: ProviderConfig): string[] {
    return [...(DEFAULT_MODELS[getProviderType(config)] ?? [])];
}

function getInitializationPayload(config: ProviderConfig): string {
    if (getProviderType(config) === 'openai-compatible') {
        return JSON.stringify({
            baseURL: config.baseURL,
            apiKey: config.apiKey,
            capabilities: config.capabilityOverrides,
        });
    }

    if (getProviderType(config) === 'local') {
        return `${config.apiKey ?? ''}|${config.models.join(',')}`;
    }

    return config.apiKey ?? '';
}

function hasInitializationData(config: ProviderConfig): boolean {
    return getProviderType(config) === 'openai-compatible'
        ? !!config.baseURL
        : !!config.apiKey;
}

function uniqueModels(models: string[]): string[] {
    return [...new Set(models.map(model => model.trim()).filter(Boolean))];
}

export class ProviderManager {
    private providers: Map<string, ProviderConfig> = new Map();
    private activeProviders: Map<string, AIProvider> = new Map();
    private imageInputSupportByModel: Map<string, boolean> = new Map();
    private toolSupportByModel: Map<string, boolean> = new Map();
    private structuredOutputSupportByModel: Map<string, boolean> = new Map();
    private modelUpdateListeners: (() => void)[] = [];

    constructor() {
        this.initializeProviders();
        this.loadFromStorage();
    }

    private initializeProviders(): void {
        this.providers.set('gemini', {
            name: 'gemini',
            displayName: 'Gemini',
            models: [...(DEFAULT_MODELS.gemini ?? [])],
            isConfigured: false,
        });

        this.providers.set('anthropic', {
            name: 'anthropic',
            displayName: 'Anthropic',
            models: [...(DEFAULT_MODELS.anthropic ?? [])],
            isConfigured: false,
        });

        this.providers.set('openai', {
            name: 'openai',
            displayName: 'OpenAI',
            models: [...(DEFAULT_MODELS.openai ?? [])],
            isConfigured: false,
        });

        this.providers.set('local', {
            name: 'local',
            displayName: 'Local Models',
            models: [],
            isConfigured: false,
        });
    }

    private loadFromStorage(): void {
        const storedProviders = localStorage.getItem('ai-providers');
        if (storedProviders) {
            try {
                const parsed = JSON.parse(storedProviders);
                for (const [name, rawConfig] of Object.entries(parsed)) {
                    if (!rawConfig || typeof rawConfig !== 'object') continue;
                    const providerConfig = rawConfig as Partial<ProviderConfig>;
                    const providerType = providerConfig.providerType ?? getProviderType(name);
                    const existing = this.providers.get(name);

                    if (existing) {
                        this.providers.set(name, {
                            ...existing,
                            ...providerConfig,
                            providerType: existing.providerType ?? providerType,
                            models: uniqueModels([...(existing.models ?? []), ...(providerConfig.models ?? [])]),
                        });
                    } else if (providerType === 'openai-compatible' && providerConfig.baseURL) {
                        this.providers.set(name, {
                            name,
                            displayName: providerConfig.displayName || 'OpenAI Compatible API',
                            providerType,
                            apiKey: providerConfig.apiKey,
                            baseURL: providerConfig.baseURL,
                            models: uniqueModels(providerConfig.models ?? []),
                            capabilityOverrides: providerConfig.capabilityOverrides,
                            isConfigured: providerConfig.isConfigured !== false,
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to load provider configurations:', error);
            }
        }

        this.checkEnvironmentKeys();
        this.initializeConfiguredProviders();
    }

    private checkEnvironmentKeys(): void {
        const geminiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY;
        if (geminiKey) {
            const config = this.providers.get('gemini')!;
            config.apiKey = geminiKey;
            config.isConfigured = true;
        }

        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey) {
            const config = this.providers.get('openai')!;
            config.apiKey = openaiKey;
            config.isConfigured = true;
        }

        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
            const config = this.providers.get('anthropic')!;
            config.apiKey = anthropicKey;
            config.isConfigured = true;
        }

    }

    private initializeConfiguredProviders(): void {
        for (const [name, config] of this.providers) {
            if (!config.isConfigured || !hasInitializationData(config)) continue;

            try {
                const provider = createAIProvider(getProviderType(config));
                if (provider.initialize(getInitializationPayload(config))) {
                    this.activeProviders.set(name, provider);
                    if (REMOTE_PROVIDER_TYPES.has(getProviderType(config))) {
                        void this.fetchAndSetProviderModels(name).catch(error => {
                            console.error(`Async fetch of ${name} models failed:`, error);
                        });
                    }
                }
            } catch (error) {
                console.error(`Failed to initialize provider ${name}:`, error);
            }
        }
    }

    public saveToStorage(): void {
        const configsToSave: Record<string, Partial<ProviderConfig>> = {};
        for (const [name, config] of this.providers) {
            if (this.isEnvironmentKey(name)) continue;
            if (!config.apiKey && !config.baseURL) continue;

            configsToSave[name] = {
                name: config.name,
                displayName: config.displayName,
                ...(config.providerType ? { providerType: config.providerType } : {}),
                ...(config.apiKey ? { apiKey: config.apiKey } : {}),
                ...(config.baseURL ? { baseURL: config.baseURL } : {}),
                models: uniqueModels(config.models),
                ...(config.capabilityOverrides ? { capabilityOverrides: config.capabilityOverrides } : {}),
                isConfigured: config.isConfigured,
            };
        }
        localStorage.setItem('ai-providers', JSON.stringify(configsToSave));
    }

    private isEnvironmentKey(providerName: string): boolean {
        const config = this.providers.get(providerName);
        if (!config?.apiKey || getProviderType(config) === 'openai-compatible') return false;

        switch (providerName) {
            case 'gemini':
                return config.apiKey === (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY);
            case 'openai':
                return config.apiKey === process.env.OPENAI_API_KEY;
            case 'anthropic':
                return config.apiKey === process.env.ANTHROPIC_API_KEY;
            default:
                return false;
        }
    }

    public configureProvider(providerName: string, apiKey: string, customModels: string[] = []): boolean {
        const config = this.providers.get(providerName);
        if (!config || getProviderType(config) === 'openai-compatible') return false;

        try {
            const provider = createAIProvider(getProviderType(config));
            const nextModels = getProviderType(config) === 'local'
                ? uniqueModels(customModels)
                : uniqueModels([...getDefaultModels(config), ...customModels]);

            const nextConfig = {
                ...config,
                apiKey,
                models: nextModels,
                isConfigured: true,
            } satisfies ProviderConfig;

            if (!provider.initialize(getInitializationPayload(nextConfig))) return false;

            this.providers.set(providerName, nextConfig);
            this.activeProviders.set(providerName, provider);
            this.saveToStorage();

            if (REMOTE_PROVIDER_TYPES.has(getProviderType(nextConfig))) {
                void this.fetchAndSetProviderModels(providerName).catch(error => {
                    console.error(`Async configure fetch of ${providerName} models failed:`, error);
                });
            } else {
                this.notifyModelUpdateListeners();
            }
            return true;
        } catch (error) {
            console.error(`Failed to configure provider ${providerName}:`, error);
            return false;
        }
    }

    public configureOpenAICompatibleProvider(
        baseURL: string,
        apiKey: string,
        customModels: string[] = [],
        displayName?: string
    ): { success: boolean; providerName?: string; error?: string } {
        const endpoint = baseURL.trim();
        if (!endpoint) {
            return { success: false, error: 'Error: Endpoint URL is required.' };
        }

        try {
            const parsedEndpoint = new URL(endpoint);
            if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
                return { success: false, error: 'Error: Endpoint URL must use http:// or https://.' };
            }

            const providerName = `${OPENAI_COMPATIBLE_PREFIX}${nanoid(10)}`;
            const config: ProviderConfig = {
                name: providerName,
                displayName: displayName?.trim() || parsedEndpoint.hostname || 'OpenAI Compatible API',
                providerType: 'openai-compatible',
                apiKey: apiKey.trim() || undefined,
                baseURL: endpoint.replace(/\/+$/, ''),
                models: uniqueModels(customModels),
                isConfigured: true,
            };
            const provider = createAIProvider('openai-compatible');

            if (!provider.initialize(getInitializationPayload(config))) {
                return {
                    success: false,
                    error: 'Error: Endpoint URL or API compatibility could not be initialized.',
                };
            }

            this.providers.set(providerName, config);
            this.activeProviders.set(providerName, provider);
            this.saveToStorage();
            void this.fetchAndSetProviderModels(providerName).catch(error => {
                console.error(`Async configure fetch of ${providerName} models failed:`, error);
            });
            this.notifyModelUpdateListeners();

            return { success: true, providerName };
        } catch (error) {
            console.error('Failed to configure OpenAI-compatible provider:', error);
            return { success: false, error: 'Error: Endpoint URL or API compatibility is invalid.' };
        }
    }

    public removeProvider(providerName: string): void {
        const storedProviderName = this.resolveProviderName(providerName);
        if (!storedProviderName) return;

        const config = this.providers.get(storedProviderName);
        if (!config || this.isEnvironmentKey(storedProviderName)) return;

        this.activeProviders.delete(storedProviderName);
        this.clearModelCapabilities(storedProviderName);

        if (isOpenAICompatibleProvider(config)) {
            this.providers.delete(storedProviderName);
        } else {
            this.providers.set(storedProviderName, {
                ...config,
                apiKey: undefined,
                isConfigured: false,
                models: getDefaultModels(config),
            });
        }

        this.saveToStorage();
        this.notifyModelUpdateListeners();
    }

    public getProviderForModel(modelSelectionId: string): AIProvider | null {
        const providerName = this.getProviderNameForModel(modelSelectionId);
        return providerName ? this.activeProviders.get(providerName) ?? null : null;
    }

    public getProviderNameForModel(modelSelectionId: string): string | null {
        const explicitProviderName = getProviderNameFromSelection(modelSelectionId);
        const storedExplicitProviderName = explicitProviderName
            ? this.resolveProviderName(explicitProviderName)
            : null;
        if (storedExplicitProviderName && this.activeProviders.has(storedExplicitProviderName)) {
            return storedExplicitProviderName;
        }

        for (const [providerName, config] of this.providers) {
            if (config.models.includes(modelSelectionId) && this.activeProviders.has(providerName)) {
                return providerName;
            }
        }
        return null;
    }

    public getProviderConfig(providerName: string): ProviderConfig | null {
        const storedProviderName = this.resolveProviderName(providerName);
        return storedProviderName ? this.providers.get(storedProviderName) ?? null : null;
    }

    public getProviderConfigForModel(modelSelectionId: string): ProviderConfig | null {
        const providerName = this.getProviderNameForModel(modelSelectionId);
        return providerName ? this.getProviderConfig(providerName) : null;
    }

    public getModelIdForSelection(modelSelectionId: string): string {
        return getModelIdFromSelection(modelSelectionId);
    }

    public getProviderTypeForModel(modelSelectionId: string): ProviderType | null {
        const config = this.getProviderConfigForModel(modelSelectionId);
        return config ? getProviderType(config) : null;
    }

    public getProviderDisplayNameForModel(modelSelectionId: string): string | null {
        return this.getProviderConfigForModel(modelSelectionId)?.displayName ?? null;
    }

    /**
     * Returns a provider-published capability when available. `null` means
     * that neither the endpoint nor Models.dev exposed a reliable answer.
     */
    public getImageInputSupportForModel(modelSelectionId: string): boolean | null {
        const config = this.getProviderConfigForModel(modelSelectionId);
        if (!config) return null;
        if (typeof config.capabilityOverrides?.supportsImageInput === 'boolean') {
            return config.capabilityOverrides.supportsImageInput;
        }

        const providerName = config.name;
        const modelId = this.getModelIdForSelection(modelSelectionId);
        return this.imageInputSupportByModel.get(`${providerName}:${modelId}`) ?? null;
    }

    public getToolCallingSupportForModel(modelSelectionId: string): boolean | null {
        const config = this.getProviderConfigForModel(modelSelectionId);
        if (!config) return null;
        if (typeof config.capabilityOverrides?.supportsTools === 'boolean') {
            return config.capabilityOverrides.supportsTools;
        }

        const modelId = this.getModelIdForSelection(modelSelectionId);
        return this.toolSupportByModel.get(`${config.name}:${modelId}`) ?? null;
    }

    public getStructuredOutputSupportForModel(modelSelectionId: string): boolean | null {
        const config = this.getProviderConfigForModel(modelSelectionId);
        if (!config) return null;
        if (typeof config.capabilityOverrides?.supportsStructuredOutputs === 'boolean') {
            return config.capabilityOverrides.supportsStructuredOutputs;
        }

        const modelId = this.getModelIdForSelection(modelSelectionId);
        return this.structuredOutputSupportByModel.get(`${config.name}:${modelId}`) ?? null;
    }

    public getAllProviders(): ProviderConfig[] {
        return Array.from(this.providers.values());
    }

    public getOpenAICompatibleProviders(): ProviderConfig[] {
        return this.getAllProviders().filter(provider => isOpenAICompatibleProvider(provider));
    }

    public getAllModels(): ModelInfo[] {
        const models: ModelInfo[] = [];
        for (const config of this.providers.values()) {
            if (!config.isConfigured) continue;

            for (const modelId of config.models) {
                models.push({
                    id: getModelSelectionKey(config.name, modelId),
                    modelId,
                    provider: config.name,
                    providerDisplayName: config.displayName,
                    displayName: modelId,
                });
            }
        }
        return models;
    }

    public hasAnyConfiguredProvider(): boolean {
        return Array.from(this.providers.values()).some(config => config.isConfigured);
    }

    public addCustomModel(providerName: string, modelId: string): boolean {
        const config = this.providers.get(providerName);
        const normalizedModelId = getModelIdFromSelection(modelId).trim();
        if (config && config.isConfigured && normalizedModelId && !config.models.includes(normalizedModelId)) {
            config.models.push(normalizedModelId);
            this.saveToStorage();
            this.notifyModelUpdateListeners();
            return true;
        }
        return false;
    }

    public removeCustomModel(providerName: string, modelId: string): boolean {
        const config = this.providers.get(providerName);
        const normalizedModelId = getModelIdFromSelection(modelId);
        if (!config || getDefaultModels(config).includes(normalizedModelId)) return false;

        config.models = config.models.filter(model => model !== normalizedModelId);
        this.clearModelCapabilities(providerName, normalizedModelId);
        this.saveToStorage();
        this.notifyModelUpdateListeners();
        return true;
    }

    public async fetchAndSetProviderModels(providerName: string): Promise<void> {
        const storedProviderName = this.resolveProviderName(providerName);
        if (!storedProviderName) return;

        const provider = this.activeProviders.get(storedProviderName);
        const config = this.providers.get(storedProviderName);
        if (!provider || !config || typeof provider.listModels !== 'function') return;

        try {
            const models = await provider.listModels();
            if (!models || models.length === 0) return;

            this.clearModelCapabilities(storedProviderName);
            const discoveredIds: string[] = [];
            for (const model of models) {
                const normalized = typeof model === 'string'
                    ? { id: model }
                    : model;
                if (!normalized?.id) continue;

                discoveredIds.push(normalized.id);
                this.recordModelCapabilities(storedProviderName, normalized);
            }

            if (discoveredIds.length > 0) {
                config.models = getProviderType(config) === 'openai-compatible'
                    ? uniqueModels([...config.models, ...discoveredIds])
                    : uniqueModels(discoveredIds);
                this.saveToStorage();
                this.notifyModelUpdateListeners();
            }
        } catch (error) {
            console.error(`Failed to fetch and update ${providerName} models:`, error);
        }
    }

    public addModelUpdateListener(listener: () => void): void {
        this.modelUpdateListeners.push(listener);
    }

    public removeModelUpdateListener(listener: () => void): void {
        this.modelUpdateListeners = this.modelUpdateListeners.filter(current => current !== listener);
    }

    private resolveProviderName(providerName: string): string | null {
        if (this.providers.has(providerName)) return providerName;

        const normalizedProviderName = providerName.toLowerCase();
        return Array.from(this.providers.keys()).find(
            storedName => storedName.toLowerCase() === normalizedProviderName
        ) ?? null;
    }

    private recordModelCapabilities(providerName: string, model: DiscoveredModel): void {
        if (typeof model.supportsImageInput === 'boolean') {
            this.imageInputSupportByModel.set(`${providerName}:${model.id}`, model.supportsImageInput);
        }
        if (typeof model.supportsTools === 'boolean') {
            this.toolSupportByModel.set(`${providerName}:${model.id}`, model.supportsTools);
        }
        if (typeof model.supportsStructuredOutputs === 'boolean') {
            this.structuredOutputSupportByModel.set(`${providerName}:${model.id}`, model.supportsStructuredOutputs);
        }
    }

    private clearModelCapabilities(providerName: string, modelId?: string): void {
        const prefix = modelId ? `${providerName}:${modelId}` : `${providerName}:`;
        for (const map of [
            this.imageInputSupportByModel,
            this.toolSupportByModel,
            this.structuredOutputSupportByModel,
        ]) {
            for (const key of map.keys()) {
                if (modelId ? key === prefix : key.startsWith(prefix)) map.delete(key);
            }
        }
    }

    private notifyModelUpdateListeners(): void {
        this.modelUpdateListeners.forEach(listener => {
            try {
                listener();
            } catch (error) {
                console.error('Error notifying model update listener:', error);
            }
        });
    }
}
