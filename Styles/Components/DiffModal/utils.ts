import { highlightCodeSync } from '../../Shiki';

export function applyCustomThemeToD2H(container: HTMLElement) {
    // Theme is applied via CSS ID selectors for maximum specificity
    // Apply syntax highlighting to code content using Shiki
    const codeLines = container.querySelectorAll('.d2h-code-line-ctn, .d2h-code-side-line-ctn');
    codeLines.forEach((lineElement) => {
        const code = lineElement.textContent || '';
        if (code.trim()) {
            try {
                // Use Shiki for syntax highlighting
                const highlighted = highlightCodeSync(code, 'plaintext');
                // Extract just the code content from Shiki's output
                const codeMatch = highlighted.match(/<code[^>]*>([\s\S]*)<\/code>/);
                if (codeMatch && codeMatch[1]) {
                    (lineElement as HTMLElement).innerHTML = codeMatch[1];
                }
            } catch (e) {
                // Ignore highlighting errors
            }
        }
    });
}
