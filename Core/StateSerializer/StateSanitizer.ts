/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * StateSanitizer - Generic recursive state sanitization utility
 * Automatically resets processing states, flags, and non-serializable references.
 */

/**
 * Status values that should be reset during import.
 * Maps "active" status to their safe "idle" equivalent.
 */
const STATUS_RESET_MAP: Record<string, string> = {
    // Processing states → pending
    'processing': 'pending',
    'retrying': 'pending',

    'running': 'stopped',
    'stopping': 'stopped',
    'orchestrating': 'idle',
    'processing_workers': 'idle',
    'orchestrating_retrying': 'idle',
};

/**
 * Field name patterns that should be reset to false.
 */
const BOOLEAN_RESET_PATTERNS = [
    /^is.*Running$/,
    /^is.*Processing$/,
    /^isStopRequested$/,
    /^isGenerating$/,
];

/**
 * Field names that contain non-serializable values and should be removed.
 */
const NON_SERIALIZABLE_FIELDS = new Set([
    'abortController',
    'tabButtonElement',
    'contentElement',
    'stopButtonElement',
    'uiRoot',
    'root',
    'containerElement',
]);

/**
 * Deep clone an object with JSON serialization (fast path for simple objects).
 * Falls back to recursive cloning for complex cases.
 */
function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    // Fast path for simple objects
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        // Fall back to manual cloning for circular references or special types
        return manualDeepClone(obj) as T;
    }
}

/**
 * Manual deep clone for complex objects.
 */
function manualDeepClone(obj: unknown, seen = new WeakMap()): unknown {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    // Handle circular references
    if (seen.has(obj as object)) {
        return seen.get(obj as object);
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        const cloned: unknown[] = [];
        seen.set(obj, cloned);
        for (const item of obj) {
            cloned.push(manualDeepClone(item, seen));
        }
        return cloned;
    }

    // Handle Date
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }

    // Handle regular objects
    const cloned: Record<string, unknown> = {};
    seen.set(obj as object, cloned);

    for (const [key, value] of Object.entries(obj)) {
        // Skip non-serializable fields
        if (NON_SERIALIZABLE_FIELDS.has(key)) {
            continue;
        }

        // Skip functions and DOM elements
        if (typeof value === 'function' || value instanceof Element) {
            continue;
        }

        cloned[key] = manualDeepClone(value, seen);
    }

    return cloned;
}

/**
 * Check if a field name ends with "Status" (case-insensitive match for common patterns).
 */
function isStatusField(key: string): boolean {
    return key.endsWith('Status') || key.endsWith('status');
}

/**
 * Check if a field should be reset to false.
 */
function shouldResetToFalse(key: string): boolean {
    return BOOLEAN_RESET_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Recursively sanitize a state object.
 * - Resets status fields from processing → pending/idle
 * - Resets boolean flags (isProcessing, isRunning, etc.) to false
 * - Removes non-serializable fields (DOM elements, controllers, etc.)
 */
function sanitizeRecursive(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeRecursive(item));
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        // Skip non-serializable fields
        if (NON_SERIALIZABLE_FIELDS.has(key)) {
            continue;
        }

        // Skip functions
        if (typeof value === 'function') {
            continue;
        }

        // Skip DOM elements
        if (value instanceof Element) {
            continue;
        }

        // Reset status fields
        if (isStatusField(key) && typeof value === 'string') {
            result[key] = STATUS_RESET_MAP[value] ?? value;
            continue;
        }

        // Reset boolean flags
        if (shouldResetToFalse(key) && typeof value === 'boolean') {
            result[key] = false;
            continue;
        }

        // Recurse into nested objects
        if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeRecursive(value);
            continue;
        }

        // Keep primitive values as-is
        result[key] = value;
    }

    return result;
}

/**
 * Sanitize a state object for safe import.
 * Creates a deep clone and resets all processing states.
 * 
 * @param state The state object to sanitize
 * @returns A sanitized deep clone of the state
 * 
 * @example
 * const imported = await deserialize(file);
 * const safe = sanitizeState(imported);
 * handler.restoreState(safe);
 */
export function sanitizeState<T>(state: T): T {
    if (state === null || state === undefined) {
        return state;
    }

    // First deep clone to avoid mutating original
    const cloned = deepClone(state);

    // Then sanitize the clone
    return sanitizeRecursive(cloned) as T;
}
