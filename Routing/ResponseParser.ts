/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ResponseParser — Gemini native code execution response parsing utilities.
 * Extracts structured parts (text, code, output, images) from Gemini API
 * responses and formats them into markdown with HTML comment markers
 * that RenderMathMarkdown can pick up and render.
 *
 * This lives in /Routing because it's a provider-level concern, not
 * mode-specific logic. Any mode (Contextual, Deepthink, Agentic, etc.)
 * can import and use these functions.
 */

export interface ResponsePart {
    type: 'text' | 'code' | 'output' | 'image';
    content: string;
    language?: string;
    mimeType?: string;
}

/**
 * Extract ordered parts from a Gemini API response.
 * Handles text, executableCode, codeExecutionResult, and inlineData parts.
 */
export function extractPartsInOrder(response: any): ResponsePart[] {
    const orderedParts: ResponsePart[] = [];

    if (!response?.candidates?.[0]?.content?.parts) {
        return orderedParts;
    }

    const parts = response.candidates[0].content.parts;

    for (const part of parts) {
        // Skip native thinking/reasoning parts — these are internal model thoughts,
        // not actual response content. They have thought: true set by the API.
        if (part.thought === true) {
            continue;
        }

        if (part.text) {
            orderedParts.push({
                type: 'text',
                content: part.text
            });
        }
        else if (part.executableCode) {
            orderedParts.push({
                type: 'code',
                content: part.executableCode.code || '',
                language: (part.executableCode.language || 'PYTHON').toLowerCase()
            });
        }
        else if (part.codeExecutionResult) {
            orderedParts.push({
                type: 'output',
                content: part.codeExecutionResult.output || ''
            });
        }
        else if (part.inlineData) {
            const mimeType = part.inlineData.mimeType || 'image/png';
            const data = part.inlineData.data || '';
            orderedParts.push({
                type: 'image',
                content: data,
                mimeType: mimeType
            });
        }
    }

    return orderedParts;
}

/**
 * Format extracted response parts into a markdown string with
 * HTML comment markers for code execution blocks, output blocks,
 * and image blocks. These markers are parsed by RenderMathMarkdown.
 */
export function formatPartsForDisplay(parts: ResponsePart[]): string {
    if (parts.length === 0) return '';

    const formattedParts: string[] = [];

    for (const part of parts) {
        switch (part.type) {
            case 'text':
                formattedParts.push(part.content);
                break;
            case 'code':
                formattedParts.push(
                    `\n<!-- CODE_EXECUTION_START -->\n` +
                    `<!-- LANGUAGE: ${part.language} -->\n` +
                    `\`\`\`${part.language} \n${part.content} \n\`\`\`\n` +
                    `<!-- CODE_EXECUTION_END -->`
                );
                break;
            case 'output':
                formattedParts.push(
                    `\n<!-- EXECUTION_OUTPUT_START -->\n` +
                    `\`\`\`\n${part.content} \n\`\`\`\n` +
                    `<!-- EXECUTION_OUTPUT_END -->\n`
                );
                break;
            case 'image':
                formattedParts.push(
                    `\n<!-- EXECUTION_IMAGE_START -->\n` +
                    `<!-- MIME_TYPE: ${part.mimeType} -->\n` +
                    `${part.content}\n` +
                    `<!-- EXECUTION_IMAGE_END -->\n`
                );
                break;
        }
    }

    return formattedParts.join('\n').trim();
}

/**
 * Extract raw inlineData image Parts from a Gemini code execution response.
 * Returns them as proper Gemini Part[] so they can be passed directly to
 * subsequent API calls as vision inputs — not embedded as text tokens.
 */
export function extractInlineImageParts(response: any): { inlineData: { mimeType: string; data: string } }[] {
    if (!response?.candidates?.[0]?.content?.parts) return [];
    return response.candidates[0].content.parts
        .filter((part: any) => part.inlineData?.data && part.inlineData?.mimeType)
        .map((part: any) => ({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } }));
}

/**
 * Like formatPartsForDisplay but replaces image data with a short reference label.
 * Use this when embedding a previous code execution response back into a text prompt —
 * pass the actual images alongside via extractInlineImageParts() as vision Parts so
 * the model sees them as images, not as raw base64 text tokens.
 */
export function formatPartsForDisplayNoImages(parts: ResponsePart[]): string {
    if (parts.length === 0) return '';
    const formattedParts: string[] = [];
    let imageCount = 0;

    for (const part of parts) {
        switch (part.type) {
            case 'text':
                formattedParts.push(part.content);
                break;
            case 'code':
                formattedParts.push(
                    `\n<!-- CODE_EXECUTION_START -->\n` +
                    `<!-- LANGUAGE: ${part.language} -->\n` +
                    `\`\`\`${part.language} \n${part.content} \n\`\`\`\n` +
                    `<!-- CODE_EXECUTION_END -->`
                );
                break;
            case 'output':
                formattedParts.push(
                    `\n<!-- EXECUTION_OUTPUT_START -->\n` +
                    `\`\`\`\n${part.content} \n\`\`\`\n` +
                    `<!-- EXECUTION_OUTPUT_END -->\n`
                );
                break;
            case 'image':
                imageCount++;
                // Placeholder only — actual image is passed as a vision Part alongside
                formattedParts.push(`[Image ${imageCount}: attached as vision input below]`);
                break;
        }
    }

    return formattedParts.join('\n').trim();
}
