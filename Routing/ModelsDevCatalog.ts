/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Models.dev is deliberately treated as advisory metadata. The configured
 * endpoint remains the authority for live model availability; this catalog is
 * only used when an endpoint publishes no usable model list.
 */

export interface ModelsDevReasoningOption {
    type?: string;
    options?: string[];
    min?: number;
    max?: number;
    default?: string | number;
}

export interface ModelsDevModel {
    id: string;
    name?: string;
    description?: string;
    tool_call?: boolean;
    structured_output?: boolean;
    reasoning?: boolean;
    reasoning_options?: ModelsDevReasoningOption[];
    modalities?: {
        input?: string[];
        output?: string[];
    };
}

interface ModelsDevProvider {
    id?: string;
    name?: string;
    api?: string;
    models?: Record<string, ModelsDevModel>;
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>;

interface CachedCatalog {
    fetchedAt: number;
    catalog: ModelsDevCatalog;
}

const MODELS_DEV_URL = 'https://models.dev/api.json';
const STORAGE_KEY = 'models-dev-catalog-v1';
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
const ACCEPT_STALE_FOR_MS = 7 * 24 * 60 * 60 * 1000;

let memoryCache: CachedCatalog | null = null;
let inFlightRequest: Promise<ModelsDevCatalog | null> | null = null;

function normalizeEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

function readStoredCatalog(): CachedCatalog | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as CachedCatalog;
        if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.catalog || typeof parsed.catalog !== 'object') {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function writeStoredCatalog(catalog: ModelsDevCatalog): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            fetchedAt: Date.now(),
            catalog,
        } satisfies CachedCatalog));
    } catch {
        // Catalog caching is an optimization. A storage quota or privacy-mode
        // failure must not prevent a configured endpoint from working.
    }
}

function isCatalog(value: unknown): value is ModelsDevCatalog {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function fetchCatalog(): Promise<ModelsDevCatalog | null> {
    try {
        const response = await fetch(MODELS_DEV_URL, {
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;

        const catalog = await response.json();
        if (!isCatalog(catalog)) return null;

        writeStoredCatalog(catalog);
        memoryCache = { fetchedAt: Date.now(), catalog };
        return catalog;
    } catch {
        return null;
    }
}

export async function loadCatalog(): Promise<ModelsDevCatalog | null> {
    const now = Date.now();
    const cached = memoryCache ?? readStoredCatalog();

    if (cached) {
        memoryCache = cached;
        if (now - cached.fetchedAt < FRESH_FOR_MS) {
            return cached.catalog;
        }

        if (now - cached.fetchedAt < ACCEPT_STALE_FOR_MS) {
            if (!inFlightRequest) {
                inFlightRequest = fetchCatalog().finally(() => {
                    inFlightRequest = null;
                });
            }
            return cached.catalog;
        }
    }

    if (!inFlightRequest) {
        inFlightRequest = fetchCatalog().finally(() => {
            inFlightRequest = null;
        });
    }

    return inFlightRequest;
}

function modelFromCatalog(id: string, model: ModelsDevModel): ModelsDevModel {
    return {
        ...model,
        id: model.id || id,
    };
}

/**
 * Returns catalog models for a known API base URL. Unknown endpoints return
 * an empty list and remain fully usable with manually entered model IDs.
 */
export function findModelsDevProvider(
    catalog: ModelsDevCatalog,
    providerOrEndpoint: string
): ModelsDevProvider | null {
    if (!providerOrEndpoint) return null;
    const target = providerOrEndpoint.trim().toLowerCase();
    const normalizedEndpoint = normalizeEndpoint(providerOrEndpoint);

    // 1. Direct match by catalog dictionary key or provider ID
    if (catalog[target]) return catalog[target];
    const matchById = Object.values(catalog).find(entry =>
        typeof entry.id === 'string' && entry.id.toLowerCase() === target
    );
    if (matchById) return matchById;

    // 2. Exact match by provider API URL
    const matchByApi = Object.values(catalog).find(entry =>
        typeof entry.api === 'string' && normalizeEndpoint(entry.api) === normalizedEndpoint
    );
    if (matchByApi) return matchByApi;

    return null;
}

/**
 * Returns catalog models for a known API base URL or provider key.
 * Unknown endpoints return an empty list and do not leak models from other providers.
 */
export async function getModelsDevModels(endpointOrProvider: string): Promise<ModelsDevModel[]> {
    const catalog = await loadCatalog();
    if (!catalog) return [];

    const provider = findModelsDevProvider(catalog, endpointOrProvider);
    if (!provider?.models || typeof provider.models !== 'object') return [];

    return Object.entries(provider.models).map(([id, model]) => modelFromCatalog(id, model));
}

/**
 * Looks up a single model's metadata in Models.dev strictly within the target provider.
 */
export async function getModelsDevModel(
    providerOrEndpoint: string,
    modelId: string
): Promise<ModelsDevModel | null> {
    const catalog = await loadCatalog();
    if (!catalog) return null;

    const cleanModelId = modelId.includes('::') ? modelId.slice(modelId.indexOf('::') + 2) : modelId;
    const targetProvider = findModelsDevProvider(catalog, providerOrEndpoint);

    if (targetProvider?.models) {
        const found = targetProvider.models[cleanModelId]
            || Object.values(targetProvider.models).find(m => m.id === cleanModelId);
        if (found) return modelFromCatalog(found.id || cleanModelId, found);
    }

    return null;
}

export function extractReasoningEffortOptions(model: ModelsDevModel): string[] | null {
    if (!model.reasoning_options || !Array.isArray(model.reasoning_options)) return null;
    for (const opt of model.reasoning_options) {
        if (Array.isArray(opt.values) && opt.values.length > 0) {
            return opt.values;
        }
        if (Array.isArray(opt.options) && opt.options.length > 0) {
            return opt.options;
        }
    }
    return null;
}

export function clearModelsDevCatalogCache(): void {
    memoryCache = null;
    inFlightRequest = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore storage failures; the next request will simply fetch again.
    }
}
