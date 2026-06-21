/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIProvider, createAIProvider } from './AIProvider';

export interface ProviderConfig {
    name: string;
    displayName: string;
    apiKey?: string;
    models: string[];
    isConfigured: boolean;
}

export interface ModelInfo {
    id: string;
    provider: string;
    displayName?: string;
}

// Hardcoded models available to all users
const DEFAULT_MODELS: Record<string, string[]> = {
    gemini: [],
    openrouter: [],
    anthropic: [],
    openai: [],
    nvidia: []
};

export class ProviderManager {
    private providers: Map<string, ProviderConfig> = new Map();
    private activeProviders: Map<string, AIProvider> = new Map();
    private imageInputSupportByModel: Map<string, boolean> = new Map();
    private modelUpdateListeners: (() => void)[] = [];

    constructor() {
        this.initializeProviders();
        this.loadFromStorage();
    }

    private initializeProviders(): void {
        // Initialize default provider configurations
        this.providers.set('gemini', {
            name: 'gemini',
            displayName: 'Gemini',
            models: [...DEFAULT_MODELS.gemini],
            isConfigured: false
        });

        this.providers.set('openrouter', {
            name: 'openrouter',
            displayName: 'OpenRouter',
            models: [...DEFAULT_MODELS.openrouter],
            isConfigured: false
        });

        this.providers.set('anthropic', {
            name: 'anthropic',
            displayName: 'Anthropic',
            models: [...DEFAULT_MODELS.anthropic],
            isConfigured: false
        });

        this.providers.set('openai', {
            name: 'openai',
            displayName: 'OpenAI',
            models: [...DEFAULT_MODELS.openai],
            isConfigured: false
        });

        this.providers.set('nvidia', {
            name: 'nvidia',
            displayName: 'NVIDIA',
            models: [...DEFAULT_MODELS.nvidia],
            isConfigured: false
        });

        this.providers.set('local', {
            name: 'local',
            displayName: 'Local Models',
            models: [], // No default models for local
            isConfigured: false
        });
    }

    private loadFromStorage(): void {
        // Load provider configurations from localStorage
        const storedProviders = localStorage.getItem('ai-providers');
        if (storedProviders) {
            try {
                const parsed = JSON.parse(storedProviders);
                for (const [name, config] of Object.entries(parsed)) {
                    if (this.providers.has(name)) {
                        const providerConfig = config as ProviderConfig;
                        this.providers.set(name, {
                            ...this.providers.get(name)!,
                            ...providerConfig,
                            models: [...(this.providers.get(name)?.models || []), ...(providerConfig.models || [])]
                        });
                    }
                }
            } catch (e) {
                console.error('Failed to load provider configurations:', e);
            }
        }

        // Check for environment variables
        this.checkEnvironmentKeys();

        // Initialize providers that have API keys
        this.initializeConfiguredProviders();
    }

    private checkEnvironmentKeys(): void {
        // Check for Gemini API key
        const geminiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY;
        if (geminiKey) {
            const config = this.providers.get('gemini')!;
            config.apiKey = geminiKey;
            config.isConfigured = true;
        }

        // Check for OpenAI API key
        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey) {
            const config = this.providers.get('openai')!;
            config.apiKey = openaiKey;
            config.isConfigured = true;
        }

        // Check for Anthropic API key
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
            const config = this.providers.get('anthropic')!;
            config.apiKey = anthropicKey;
            config.isConfigured = true;
        }

        // Check for OpenRouter API key
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (openrouterKey) {
            const config = this.providers.get('openrouter')!;
            config.apiKey = openrouterKey;
            config.isConfigured = true;
        }

        // Check for NVIDIA API key
        const nvidiaKey = process.env.NVIDIA_API_KEY;
        if (nvidiaKey) {
            const config = this.providers.get('nvidia')!;
            config.apiKey = nvidiaKey;
            config.isConfigured = true;
        }
    }

    private initializeConfiguredProviders(): void {
        const fetchPromises: Promise<void>[] = [];
        for (const [name, config] of this.providers) {
            if (config.isConfigured && config.apiKey) {
                try {
                    const provider = createAIProvider(name);

                    // For local models, pass endpoint URL with models
                    const initString = name === 'local'
                        ? `${config.apiKey}|${config.models.join(',')}`
                        : config.apiKey;

                    if (provider.initialize(initString)) {
                        this.activeProviders.set(name, provider);
                        if (['gemini', 'openai', 'anthropic', 'openrouter', 'nvidia'].includes(name)) {
                            fetchPromises.push(
                                this.fetchAndSetProviderModels(name).catch(err => {
                                    console.error(`Async fetch of ${name} models failed:`, err);
                                })
                            );
                        }
                    }
                } catch (e) {
                    console.error(`Failed to initialize provider ${name}:`, e);
                }
            }
        }
    }

    public saveToStorage(): void {
        const configsToSave: Record<string, any> = {};
        for (const [name, config] of this.providers) {
            // Only save user-configured data, not environment keys
            if (config.apiKey && !this.isEnvironmentKey(name)) {
                configsToSave[name] = {
                    name: config.name,
                    displayName: config.displayName,
                    apiKey: config.apiKey,
                    models: config.models.filter(m => !DEFAULT_MODELS[name]?.includes(m)), // Only save custom models
                    isConfigured: config.isConfigured
                };
            }
        }
        localStorage.setItem('ai-providers', JSON.stringify(configsToSave));
    }

    private isEnvironmentKey(providerName: string): boolean {
        const config = this.providers.get(providerName);
        if (!config?.apiKey) return false;

        switch (providerName) {
            case 'gemini':
                return config.apiKey === (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY);
            case 'openai':
                return config.apiKey === process.env.OPENAI_API_KEY;
            case 'anthropic':
                return config.apiKey === process.env.ANTHROPIC_API_KEY;
            case 'openrouter':
                return config.apiKey === process.env.OPENROUTER_API_KEY;
            case 'nvidia':
                return config.apiKey === process.env.NVIDIA_API_KEY;
            default:
                return false;
        }
    }

    public configureProvider(providerName: string, apiKey: string, customModels: string[] = []): boolean {
        const config = this.providers.get(providerName);
        if (!config) return false;

        try {
            const provider = createAIProvider(providerName);

            // For local models, apiKey is actually the endpoint URL
            // We'll pass both endpoint and models as a combined string
            const initString = providerName === 'local'
                ? `${apiKey}|${customModels.join(',')}`
                : apiKey;

            if (provider.initialize(initString)) {
                config.apiKey = apiKey;
                config.isConfigured = true;

                // For local models, only use the provided models
                // For other providers, add custom models to the existing default models
                if (providerName === 'local') {
                    config.models = customModels;
                } else {
                    const allModels = [...DEFAULT_MODELS[providerName] || [], ...customModels];
                    config.models = [...new Set(allModels)]; // Remove duplicates
                }

                this.activeProviders.set(providerName, provider);
                this.saveToStorage();

                if (['gemini', 'openai', 'anthropic', 'openrouter', 'nvidia'].includes(providerName)) {
                    this.fetchAndSetProviderModels(providerName).catch(err => {
                        console.error(`Async configure fetch of ${providerName} models failed:`, err);
                    });
                } else {
                    this.notifyModelUpdateListeners();
                }
                return true;
            }
        } catch (e) {
            console.error(`Failed to configure provider ${providerName}:`, e);
        }
        return false;
    }

    public removeProvider(providerName: string): void {
        const config = this.providers.get(providerName);
        if (config && !this.isEnvironmentKey(providerName)) {
            config.apiKey = undefined;
            config.isConfigured = false;
            config.models = [...DEFAULT_MODELS[providerName] || []]; // Reset to default models
            this.activeProviders.delete(providerName);
            this.saveToStorage();
            this.notifyModelUpdateListeners();
        }
    }

    public getProvider(providerName: string): AIProvider | null {
        return this.activeProviders.get(providerName) || null;
    }

    public getProviderForModel(modelId: string): AIProvider | null {
        for (const [providerName, config] of this.providers) {
            if (config.models.includes(modelId) && this.activeProviders.has(providerName)) {
                return this.activeProviders.get(providerName)!;
            }
        }
        return null;
    }

    public getProviderNameForModel(modelId: string): string | null {
        for (const [providerName, config] of this.providers) {
            if (config.models.includes(modelId) && this.activeProviders.has(providerName)) {
                return providerName;
            }
        }
        return null;
    }

    public getProviderConfig(providerName: string): ProviderConfig | null {
        return this.providers.get(providerName) ?? null;
    }

    public getProviderConfigForModel(modelId: string): ProviderConfig | null {
        const providerName = this.getProviderNameForModel(modelId);
        if (!providerName) {
            return null;
        }
        return this.getProviderConfig(providerName);
    }

    /**
     * Returns a provider-published capability when available. `null` means
     * the provider's model API does not expose a reliable answer.
     */
    public getImageInputSupportForModel(modelId: string): boolean | null {
        const providerName = this.getProviderNameForModel(modelId);
        if (!providerName) return null;
        return this.imageInputSupportByModel.get(`${providerName}:${modelId}`) ?? null;
    }

    public getAllProviders(): ProviderConfig[] {
        return Array.from(this.providers.values());
    }

    public getAllModels(): ModelInfo[] {
        const models: ModelInfo[] = [];
        for (const [providerName, config] of this.providers) {
            if (config.isConfigured) {
                for (const modelId of config.models) {
                    models.push({
                        id: modelId,
                        provider: providerName,
                        displayName: modelId
                    });
                }
            }
        }
        return models;
    }

    public hasAnyConfiguredProvider(): boolean {
        return Array.from(this.providers.values()).some(config => config.isConfigured);
    }

    public getConfiguredProviders(): ProviderConfig[] {
        return Array.from(this.providers.values()).filter(config => config.isConfigured);
    }

    public addCustomModel(providerName: string, modelId: string): boolean {
        const config = this.providers.get(providerName);
        if (config && config.isConfigured && !config.models.includes(modelId)) {
            config.models.push(modelId);
            this.saveToStorage();
            this.notifyModelUpdateListeners();
            return true;
        }
        return false;
    }

    public removeCustomModel(providerName: string, modelId: string): boolean {
        const config = this.providers.get(providerName);
        if (config && !DEFAULT_MODELS[providerName]?.includes(modelId)) {
            config.models = config.models.filter(m => m !== modelId);
            this.saveToStorage();
            this.notifyModelUpdateListeners();
            return true;
        }
        return false;
    }

    public async fetchAndSetProviderModels(providerName: string): Promise<void> {
        const provider = this.activeProviders.get(providerName);
        if (!provider || !('listModels' in provider) || typeof (provider as any).listModels !== 'function') {
            return;
        }

        try {
            const models = await (provider as AIProvider).listModels!();
            if (models && models.length > 0) {
                const config = this.providers.get(providerName);
                if (config) {
                    for (const key of this.imageInputSupportByModel.keys()) {
                        if (key.startsWith(`${providerName}:`)) this.imageInputSupportByModel.delete(key);
                    }

                    config.models = models.map(model => {
                        if (typeof model === 'string') return model;
                        if (typeof model.supportsImageInput === 'boolean') {
                            this.imageInputSupportByModel.set(`${providerName}:${model.id}`, model.supportsImageInput);
                        }
                        return model.id;
                    });
                    this.saveToStorage();
                    this.notifyModelUpdateListeners();
                }
            }
        } catch (e) {
            console.error(`Failed to fetch and update ${providerName} models:`, e);
        }
    }

    public addModelUpdateListener(listener: () => void): void {
        this.modelUpdateListeners.push(listener);
    }

    public removeModelUpdateListener(listener: () => void): void {
        this.modelUpdateListeners = this.modelUpdateListeners.filter(l => l !== listener);
    }

    private notifyModelUpdateListeners(): void {
        this.modelUpdateListeners.forEach(listener => {
            try {
                listener();
            } catch (e) {
                console.error("Error notifying model update listener:", e);
            }
        });
    }
}
