type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeMessage(value: string): string {
    return value
        .replace(/data:[^\s,;]+(?:;[^\s,;]+)*;base64,[A-Za-z0-9+/=]+/gi, '[binary data omitted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 900);
}

function isGenericMessage(message: string): boolean {
    const normalized = message
        .replace(/^\d{3}\s+/, '')
        .trim()
        .toLowerCase();
    return normalized === 'provider returned error'
        || normalized === 'bad request'
        || normalized === 'request failed';
}

function parseJsonIfPossible(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function findMessage(value: unknown, visited = new Set<unknown>(), depth = 0): string | null {
    if (depth > 5 || value == null || visited.has(value)) return null;

    if (typeof value === 'string') {
        const parsed = parseJsonIfPossible(value);
        if (parsed !== value) return findMessage(parsed, visited, depth + 1);
        const message = sanitizeMessage(value);
        return message && !isGenericMessage(message) ? message : null;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            const message = findMessage(entry, visited, depth + 1);
            if (message) return message;
        }
        return null;
    }

    const record = asRecord(value);
    if (!record) return null;
    visited.add(value);

    for (const key of ['message', 'detail', 'error_description', 'reason']) {
        const message = findMessage(record[key], visited, depth + 1);
        if (message) return message;
    }

    for (const key of ['error', 'raw', 'body', 'response', 'data', 'cause']) {
        const message = findMessage(record[key], visited, depth + 1);
        if (message) return message;
    }

    return null;
}

/** Returns an HTTP-like status code when the provider SDK exposed one. */
function getProviderErrorStatus(error: unknown): number | null {
    const record = asRecord(error);
    const directStatus = record?.status;
    if (typeof directStatus === 'number') return directStatus;

    const apiError = asRecord(record?.error);
    const code = apiError?.code ?? record?.code;
    if (typeof code === 'number') return code;
    if (typeof code === 'string' && /^\d{3}$/.test(code)) return Number(code);
    return null;
}

/**
 * Extracts the provider's actionable error text without exposing request
 * payloads. OpenRouter, for example, nests its upstream failure under
 * `error.metadata.raw` while the top-level message is only "Provider returned
 * error".
 */
export function describeProviderError(error: unknown): string {
    const record = asRecord(error);
    const apiError = asRecord(record?.error);
    const metadata = asRecord(apiError?.metadata) ?? asRecord(record?.metadata);
    const raw = metadata?.raw ?? apiError?.raw ?? record?.raw;
    const providerName = asNonEmptyString(metadata?.provider_name)
        ?? asNonEmptyString(metadata?.provider)
        ?? asNonEmptyString(asRecord(raw)?.provider_name);
    const status = getProviderErrorStatus(error);
    const detail = findMessage(raw)
        ?? findMessage(apiError)
        ?? findMessage(record?.cause)
        ?? findMessage(record?.message)
        ?? 'Provider request failed without an error message.';

    return [
        status ? String(status) : '',
        providerName ? `${providerName}:` : '',
        detail,
    ].filter(Boolean).join(' ');
}
