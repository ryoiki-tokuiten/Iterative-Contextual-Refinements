/**
 * Shiki Syntax Highlighter Setup
 * 
 * Provides syntax highlighting with proper light/dark mode support via CSS variables.
 * Uses dual theme rendering so theme switching is instant via CSS.
 * 
 * OPTIMIZED: Only bundles essential languages to minimize bundle size.
 * Additional languages are loaded dynamically when needed.
 */

import { bundledLanguagesInfo } from 'shiki';
import { createBundledHighlighter, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const BUNDLED_LANGUAGE_LOADERS = {
        javascript: () => import('shiki/langs/javascript.mjs'),
        typescript: () => import('shiki/langs/typescript.mjs'),
        python: () => import('shiki/langs/python.mjs'),
        css: () => import('shiki/langs/css.mjs'),
        html: () => import('shiki/langs/html.mjs'),
        json: () => import('shiki/langs/json.mjs'),
        shellscript: () => import('shiki/langs/shellscript.mjs'),
        markdown: () => import('shiki/langs/markdown.mjs'),
        sql: () => import('shiki/langs/sql.mjs'),
        java: () => import('shiki/langs/java.mjs'),
        cpp: () => import('shiki/langs/cpp.mjs'),
        c: () => import('shiki/langs/c.mjs'),
        go: () => import('shiki/langs/go.mjs'),
        rust: () => import('shiki/langs/rust.mjs'),
        yaml: () => import('shiki/langs/yaml.mjs'),
        xml: () => import('shiki/langs/xml.mjs'),
        jsx: () => import('shiki/langs/jsx.mjs'),
        tsx: () => import('shiki/langs/tsx.mjs')
} as const;

const BUNDLED_LANGUAGE_IDS = Object.keys(BUNDLED_LANGUAGE_LOADERS) as Array<keyof typeof BUNDLED_LANGUAGE_LOADERS>;
const PLAIN_TEXT_ALIASES = new Set(['plaintext', 'text', 'txt']);

const LANGUAGE_INFO = new Map(
    bundledLanguagesInfo
        .filter((info) => BUNDLED_LANGUAGE_IDS.includes(info.id as keyof typeof BUNDLED_LANGUAGE_LOADERS))
        .map((info) => [info.id, info])
);

const LANGUAGE_LOOKUP = new Map<string, string>();

for (const id of BUNDLED_LANGUAGE_IDS) {
    LANGUAGE_LOOKUP.set(id, id);
}

for (const info of LANGUAGE_INFO.values()) {
    info.aliases?.forEach((alias) => {
        LANGUAGE_LOOKUP.set(alias, info.id);
    });
}

for (const alias of PLAIN_TEXT_ALIASES) {
    LANGUAGE_LOOKUP.set(alias, 'plaintext');
}

// Fine-grained bundle: only load the languages + themes we explicitly list.
const createHighlighter = createBundledHighlighter({
    langs: BUNDLED_LANGUAGE_LOADERS,
    themes: {
        'github-dark': () => import('shiki/themes/github-dark.mjs'),
        'github-light': () => import('shiki/themes/github-light.mjs')
    },
    // Use JS regex engine to avoid wasm loading requirements in the browser.
    engine: () => createJavaScriptRegexEngine()
});

// Singleton highlighter instance
let highlighterInstance: HighlighterCore | null = null;
let initPromise: Promise<HighlighterCore> | null = null;
const readinessListeners: (() => void)[] = [];

/**
 * Initialize the Shiki highlighter with dual themes for light/dark mode
 */
async function initHighlighter(): Promise<HighlighterCore> {
    if (highlighterInstance) return highlighterInstance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const highlighter = await createHighlighter({
                themes: ['github-dark', 'github-light'],
                langs: [...BUNDLED_LANGUAGE_IDS]
            });
            highlighterInstance = highlighter as HighlighterCore; // Cast to Core type
            // Notify listeners
            readinessListeners.forEach(l => l());
            readinessListeners.length = 0;
            return highlighter as HighlighterCore;
        } catch (error) {
            console.error('Failed to initialize Shiki:', error);
            initPromise = null; // Allow retry
            throw error;
        }
    })();

    return initPromise;
}

/**
 * Subscribe to highlighter readiness (for re-rendering components)
 */
export function onHighlighterReady(callback: () => void): () => void {
    if (highlighterInstance) {
        callback();
        return () => { };
    }
    readinessListeners.push(callback);
    return () => {
        const idx = readinessListeners.indexOf(callback);
        if (idx !== -1) readinessListeners.splice(idx, 1);
    };
}

/**
 * Check if highlighter is ready
 */
export function isHighlighterReady(): boolean {
    return highlighterInstance !== null;
}

/**
 * Resolve language alias to actual language name
 */
export function resolveLanguage(lang: string): string {
    const lowered = lang.toLowerCase().trim();
    return LANGUAGE_LOOKUP.get(lowered) || 'plaintext';
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(lang: string): boolean {
    return resolveLanguage(lang) !== 'plaintext' || PLAIN_TEXT_ALIASES.has(lang.toLowerCase().trim());
}

export function getLanguageDisplayName(lang: string): string {
    const resolved = resolveLanguage(lang);
    if (resolved === 'plaintext') {
        return 'Plain Text';
    }
    return LANGUAGE_INFO.get(resolved)?.name || resolved.toUpperCase();
}

/**
 * Highlight code with dual themes (light + dark)
 * Returns HTML with CSS variables for instant theme switching
 */
function highlightCode(code: string, lang: string = 'plaintext'): string {
    if (!highlighterInstance) {
        // Init in background if not started
        if (!initPromise) initHighlighter().catch(console.error);
        // Fallback: return simple pre/code
        return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
    }

    const resolvedLang = resolveLanguage(lang);

    // If language not loaded, use plaintext
    const availableLangs = highlighterInstance.getLoadedLanguages();
    const langToUse = availableLangs.includes(resolvedLang) ? resolvedLang : 'plaintext';

    try {
        return highlighterInstance.codeToHtml(code, {
            lang: langToUse,
            themes: {
                light: 'github-light',
                dark: 'github-dark'
            },
            defaultColor: false
        });
    } catch (error) {
        console.warn(`Shiki highlighting failed for language "${lang}":`, error);
        return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
    }
}

/**
 * Highlight code synchronously (returns escaped text if not ready)
 */
export function highlightCodeSync(code: string, lang: string = 'plaintext'): string {
    return highlightCode(code, lang);
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Auto-initialize on module load (non-blocking)
if (typeof window !== 'undefined') {
    initHighlighter().catch(err => {
        console.error('Failed to initialize Shiki highlighter:', err);
    });
}
