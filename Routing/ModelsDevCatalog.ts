/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Models.dev is deliberately treated as advisory metadata. The configured
 * endpoint remains the authority for live model availability; this catalog is
 * only used when an endpoint publishes no usable model list.
 */

export interface ModelsDevModel {
    id: string;
    name?: string;
    description?: string;
    tool_call?: boolean;
    structured_output?: boolean;
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

async function loadCatalog(): Promise<ModelsDevCatalog | null> {
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
export async function getModelsDevModels(endpoint: string): Promise<ModelsDevModel[]> {
    const catalog = await loadCatalog();
    if (!catalog) return [];

    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const provider = Object.values(catalog).find(entry =>
        typeof entry.api === 'string' && normalizeEndpoint(entry.api) === normalizedEndpoint
    );

    if (!provider?.models || typeof provider.models !== 'object') return [];

    return Object.entries(provider.models).map(([id, model]) => modelFromCatalog(id, model));
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
