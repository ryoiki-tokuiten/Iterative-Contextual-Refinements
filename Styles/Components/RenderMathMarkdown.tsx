import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { isHTMLContent } from '../ContentDetection';
import { getLanguageDisplayName, highlightCodeSync, isHighlighterReady, onHighlighterReady, resolveLanguage } from '../Shiki';
import { Icon } from '../../UI/Icons';

const MAX_CODE_HIGHLIGHT_SIZE = 50000;
const LATEX_COMMAND_PATTERN = /\\[a-zA-Z]+/;
const MATH_NOTATION_PATTERNS = [
    /[_^]\{[^}]+\}/,
    /\\[{}]/,
];
const EXECUTION_SEGMENT_PATTERN = /<!-- CODE_EXECUTION_START -->[\s\S]*?<!-- CODE_EXECUTION_END -->|<!-- EXECUTION_OUTPUT_START -->[\s\S]*?<!-- EXECUTION_OUTPUT_END -->|<!-- EXECUTION_IMAGE_START -->[\s\S]*?<!-- EXECUTION_IMAGE_END -->/g;
const CODE_EXECUTION_PATTERN = /^<!-- CODE_EXECUTION_START -->\s*\n?<!-- LANGUAGE: ([^\n]+?) -->\s*\n?```[^\n]*\n([\s\S]*?)\n```\s*\n?<!-- CODE_EXECUTION_END -->$/;
const EXECUTION_OUTPUT_PATTERN = /^<!-- EXECUTION_OUTPUT_START -->\s*\n?```\n?([\s\S]*?)\n?```\s*\n?<!-- EXECUTION_OUTPUT_END -->$/;
const EXECUTION_IMAGE_PATTERN = /^<!-- EXECUTION_IMAGE_START -->\s*\n?<!-- MIME_TYPE: ([^\s]+) -->\s*\n?([\s\S]*?)\n?<!-- EXECUTION_IMAGE_END -->$/;
const EXECUTION_COMMENT_MARKERS = new Set([
    'CODE_EXECUTION_START',
    'CODE_EXECUTION_END',
    'EXECUTION_OUTPUT_START',
    'EXECUTION_OUTPUT_END',
    'EXECUTION_IMAGE_START',
    'EXECUTION_IMAGE_END',
]);
const EXECUTION_COMMENT_PREFIXES = [
    'LANGUAGE:',
    'MIME_TYPE:',
];

type ExecutionImageItem =
    | {
        kind: 'image';
        src: string;
        mimeType: string;
        format: string;
        alt: string;
      }
    | {
        kind: 'error';
        message: string;
      };

type RenderSegment =
    | {
        kind: 'markdown';
        content: string;
      }
    | {
        kind: 'execution_code';
        code: string;
        language: string;
      }
    | {
        kind: 'execution_output';
        output: string;
      }
    | {
        kind: 'execution_images';
        images: ExecutionImageItem[];
      };

export interface RenderMathMarkdownProps {
    content: string;
    className?: string;
}

interface ImagePreviewData {
    src: string;
    alt: string;
    format: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function containsLatexMath(content: string): boolean {
    if (LATEX_COMMAND_PATTERN.test(content)) {
        return true;
    }
    return MATH_NOTATION_PATTERNS.some((pattern) => pattern.test(content));
}

function convertBacktickedLatexToMath(content: string): string {
    return content.replace(/(?<!`)`([^`]+)`(?!`)/g, (match, codeContent) => {
        if (containsLatexMath(codeContent)) {
            return `$$${codeContent}$$`;
        }
        return match;
    });
}

function createFallbackHighlightedMarkup(code: string): string {
    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

function highlightMarkup(code: string, language: string): string {
    const resolvedLanguage = resolveLanguage(language || 'plaintext');

    if (code.length > MAX_CODE_HIGHLIGHT_SIZE) {
        return createFallbackHighlightedMarkup(code);
    }

    try {
        return highlightCodeSync(code, resolvedLanguage);
    } catch {
        return createFallbackHighlightedMarkup(code);
    }
}

function getMarkdownFenceLanguage(className?: string): string {
    if (!className) {
        return 'plaintext';
    }

    const token = className
        .split(/\s+/)
        .find((value) => value.startsWith('language-'));

    return token ? token.slice('language-'.length) : 'plaintext';
}

function extractCodeBlockChild(children: React.ReactNode): { code: string; language: string } | null {
    for (const child of React.Children.toArray(children)) {
        if (!React.isValidElement(child)) {
            continue;
        }

        const childProps = child.props as { className?: string; children?: React.ReactNode };
        return {
            code: getNodeText(childProps.children ?? '').replace(/\n$/, ''),
            language: getMarkdownFenceLanguage(childProps.className),
        };
    }

    return null;
}

function parseExecutionCode(match: string): RenderSegment | null {
    const parsed = match.match(CODE_EXECUTION_PATTERN);
    if (!parsed) return null;

    return {
        kind: 'execution_code',
        language: parsed[1].trim().toLowerCase(),
        code: parsed[2].trim(),
    };
}

function parseExecutionOutput(match: string): RenderSegment | null {
    const parsed = match.match(EXECUTION_OUTPUT_PATTERN);
    if (!parsed) return null;

    return {
        kind: 'execution_output',
        output: parsed[1].trim(),
    };
}

function parseExecutionImage(match: string): RenderSegment | null {
    const parsed = match.match(EXECUTION_IMAGE_PATTERN);
    if (!parsed) return null;

    const mimeType = parsed[1].trim() || 'image/png';
    const base64Data = parsed[2].trim();

    if (!base64Data) {
        return {
            kind: 'execution_images',
            images: [{ kind: 'error', message: 'Empty image data received' }],
        };
    }

    let src = base64Data;
    if (!base64Data.startsWith('data:')) {
        const cleanedBase64 = base64Data.replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanedBase64)) {
            return {
                kind: 'execution_images',
                images: [{ kind: 'error', message: 'Invalid base64 encoding' }],
            };
        }
        src = `data:${mimeType.startsWith('image/') ? mimeType : 'image/png'};base64,${cleanedBase64}`;
    }

    const normalizedMimeType = mimeType.startsWith('image/') ? mimeType : 'image/png';

    return {
        kind: 'execution_images',
        images: [{
            kind: 'image',
            src,
            mimeType: normalizedMimeType,
            format: normalizedMimeType.replace('image/', '').toUpperCase(),
            alt: 'Generated visualization',
        }],
    };
}

function parseExecutionSegment(match: string): RenderSegment | null {
    if (match.startsWith('<!-- CODE_EXECUTION_START -->')) {
        return parseExecutionCode(match);
    }
    if (match.startsWith('<!-- EXECUTION_OUTPUT_START -->')) {
        return parseExecutionOutput(match);
    }
    if (match.startsWith('<!-- EXECUTION_IMAGE_START -->')) {
        return parseExecutionImage(match);
    }
    return null;
}

function pushMarkdownSegment(segments: RenderSegment[], content: string) {
    const cleanedContent = stripExecutionMarkerComments(content);
    if (!cleanedContent) return;

    const previousSegment = segments[segments.length - 1];
    if (previousSegment?.kind === 'markdown') {
        previousSegment.content += cleanedContent;
        return;
    }

    segments.push({ kind: 'markdown', content: cleanedContent });
}

function isExecutionMarkerComment(commentBody: string): boolean {
    const trimmedComment = commentBody.trim();
    if (EXECUTION_COMMENT_MARKERS.has(trimmedComment)) {
        return true;
    }

    return EXECUTION_COMMENT_PREFIXES.some((prefix) => trimmedComment.startsWith(prefix));
}

function stripExecutionMarkerComments(content: string): string {
    if (!content.includes('<!--')) {
        return content;
    }

    let cleanedContent = '';
    let currentIndex = 0;

    while (currentIndex < content.length) {
        const commentStart = content.indexOf('<!--', currentIndex);
        if (commentStart === -1) {
            cleanedContent += content.slice(currentIndex);
            break;
        }

        const commentEnd = content.indexOf('-->', commentStart + 4);
        if (commentEnd === -1) {
            cleanedContent += content.slice(currentIndex);
            break;
        }

        cleanedContent += content.slice(currentIndex, commentStart);

        const commentBody = content.slice(commentStart + 4, commentEnd);
        if (!isExecutionMarkerComment(commentBody)) {
            cleanedContent += content.slice(commentStart, commentEnd + 3);
        }

        currentIndex = commentEnd + 3;
    }

    return cleanedContent;
}

function isStandaloneHtmlDocument(content: string): boolean {
    return !EXECUTION_SEGMENT_PATTERN.test(content) && isHTMLContent(content);
}

function isRelaxedJson(content: string): boolean {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            JSON.parse(trimmed);
            return true;
        } catch {
            return (trimmed.includes('"') && trimmed.includes(':')) || trimmed.endsWith('}') || trimmed.endsWith(']');
        }
    }
    return false;
}

function tokenizeContent(content: string): RenderSegment[] {
    if (isStandaloneHtmlDocument(content)) {
        return [{
            kind: 'execution_code',
            language: 'html',
            code: content.trim(),
        }];
    }

    if (isRelaxedJson(content)) {
        let code = content.trim();
        try {
            code = JSON.stringify(JSON.parse(code), null, 2);
        } catch {
            // Keep original if not strictly parseable
        }
        return [{
            kind: 'execution_code',
            language: 'json',
            code,
        }];
    }

    const normalizedContent = convertBacktickedLatexToMath(content);
    const segments: RenderSegment[] = [];
    let lastIndex = 0;

    for (const match of normalizedContent.matchAll(EXECUTION_SEGMENT_PATTERN)) {
        const matchedContent = match[0];
        const matchIndex = match.index ?? 0;
        const parsedSegment = parseExecutionSegment(matchedContent);
        const between = normalizedContent.slice(lastIndex, matchIndex);
        const previousSegment = segments[segments.length - 1];
        const canMergeImages = !!parsedSegment &&
            parsedSegment.kind === 'execution_images' &&
            previousSegment?.kind === 'execution_images' &&
            between.trim() === '';

        if (!canMergeImages) {
            pushMarkdownSegment(segments, between);
        }

        if (!parsedSegment) {
            pushMarkdownSegment(segments, matchedContent);
        } else if (parsedSegment.kind === 'execution_images' && previousSegment?.kind === 'execution_images' && between.trim() === '') {
            previousSegment.images.push(...parsedSegment.images);
        } else {
            segments.push(parsedSegment);
        }

        lastIndex = matchIndex + matchedContent.length;
    }

    pushMarkdownSegment(segments, normalizedContent.slice(lastIndex));

    return segments.filter((segment) => segment.kind !== 'markdown' || segment.content.length > 0);
}

function getNodeText(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(getNodeText).join('');
    }
    if (React.isValidElement(node)) {
        return getNodeText((node.props as { children?: React.ReactNode }).children);
    }
    return '';
}

const headingComponents = {
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h1 {...props} className={['token-heading', 'token-heading1', props.className].filter(Boolean).join(' ')} />,
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props} className={['token-heading', 'token-heading2', props.className].filter(Boolean).join(' ')} />,
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props} className={['token-heading', 'token-heading3', props.className].filter(Boolean).join(' ')} />,
    h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h4 {...props} className={['token-heading', props.className].filter(Boolean).join(' ')} />,
    h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h5 {...props} className={['token-heading', props.className].filter(Boolean).join(' ')} />,
    h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h6 {...props} className={['token-heading', props.className].filter(Boolean).join(' ')} />,
};

const ImagePreviewModal: React.FC<{
    data: ImagePreviewData | null;
    onClose: () => void;
}> = ({ data, onClose }) => {
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = React.useCallback(() => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 180);
    }, [onClose]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleClose();
            }
        };

        if (data) {
            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.body.style.overflow = '';
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [data, handleClose]);

    if (!data) return null;

    return createPortal(
        <div
            className="file-preview-modal-overlay"
            onClick={handleClose}
            style={isClosing ? { animation: 'fadeIn 0.2s ease reverse' } : undefined}
        >
            <div
                className="file-preview-modal"
                onClick={(event) => event.stopPropagation()}
                style={isClosing ? { animation: 'scaleIn 0.2s ease reverse' } : undefined}
            >
                <div className="preview-modal-header">
                    <div className="preview-file-info">
                        <Icon name="image" style={{ color: '#10b981' }} />
                        <span className="preview-file-name">Generated Figure</span>
                        <span className="preview-file-badge" style={{ backgroundColor: 'rgba(16, 185, 129, 0.13)', color: '#10b981' }}>
                            {data.format}
                        </span>
                    </div>
                    <button className="preview-close-btn" title="Close (Esc)" onClick={handleClose}>
                        <Icon name="close" />
                    </button>
                </div>
                <div className="preview-modal-content">
                    <div className="preview-image-container">
                        <img src={data.src} alt={data.alt} className="preview-image" />
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const CodeBlock: React.FC<{
    code: string;
    language: string;
    label?: string;
    highlightingVersion: number;
}> = ({ code, language, label, highlightingVersion }) => {
    const [copied, setCopied] = useState(false);
    const resolvedLanguage = resolveLanguage(language || 'plaintext');
    const displayLabel = label || getLanguageDisplayName(resolvedLanguage);

    const highlightedMarkup = useMemo(
        () => highlightMarkup(code, resolvedLanguage),
        [code, resolvedLanguage, highlightingVersion]
    );

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            console.error('Copy failed:', error);
        }
    };

    return (
        <div className="code-block-container">
            <div className="code-block-header">
                <span className="code-block-title">{displayLabel}</span>
                <button className="code-copy-icon" type="button" title="Copy code" aria-label="Copy code" onClick={handleCopy}>
                    <Icon name={copied ? 'check' : 'content_copy'} />
                </button>
            </div>
            <div className="code-block-content" dangerouslySetInnerHTML={{ __html: highlightedMarkup }} />
        </div>
    );
};

const OutputBlock: React.FC<{ output: string }> = ({ output }) => {
    const lowerOutput = output.toLowerCase();
    const hasError = lowerOutput.includes('error') || lowerOutput.includes('traceback') || lowerOutput.includes('exception');

    return (
        <div className={['code-block-container', 'exec-output-block', hasError ? 'exec-output-error' : ''].filter(Boolean).join(' ')}>
            <div className="code-block-header">
                <span className="code-block-title">{hasError ? 'ERROR' : 'OUTPUT'}</span>
            </div>
            <div className="code-block-content exec-output-content">
                <pre><code className="exec-output-text">{output}</code></pre>
            </div>
        </div>
    );
};

const PreviewableImage: React.FC<{
    src: string;
    alt: string;
    format: string;
    wrapperTag?: 'div' | 'span';
    extraClassName?: string;
    imageClassName?: string;
    onPreview: (data: ImagePreviewData) => void;
}> = ({ src, alt, format, wrapperTag = 'div', extraClassName = '', imageClassName = '', onPreview }) => {
    const [hasError, setHasError] = useState(false);
    const Wrapper = wrapperTag;

    const handleOpen = () => {
        if (hasError) return;
        onPreview({ src, alt, format });
    };

    if (hasError) {
        return (
            <Wrapper className={['exec-image-item', 'exec-image-error-item', extraClassName].filter(Boolean).join(' ')}>
                <div className="exec-image-error">Failed to render image</div>
            </Wrapper>
        );
    }

    return (
        <Wrapper
            className={['exec-image-item', extraClassName].filter(Boolean).join(' ')}
            onClick={handleOpen}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpen();
                }
            }}
            role="button"
            tabIndex={0}
        >
            <img
                src={src}
                alt={alt}
                className={['exec-rendered-image', imageClassName].filter(Boolean).join(' ')}
                loading="lazy"
                onError={() => setHasError(true)}
            />
        </Wrapper>
    );
};

const ExecutionImagesBlock: React.FC<{
    images: ExecutionImageItem[];
    onPreview: (data: ImagePreviewData) => void;
}> = ({ images, onPreview }) => (
    <div className="code-block-container exec-image-block">
        <div className="code-block-header">
            <span className="code-block-title">FIGURE</span>
        </div>
        <div className="exec-image-grid">
            {images.map((image, index) => (
                image.kind === 'error'
                    ? (
                        <div key={`execution-image-${index}`} className="exec-image-item exec-image-error-item">
                            <div className="exec-image-error">{image.message}</div>
                        </div>
                    )
                    : (
                        <PreviewableImage
                            key={`execution-image-${index}`}
                            src={image.src}
                            alt={image.alt}
                            format={image.format}
                            onPreview={onPreview}
                        />
                    )
            ))}
        </div>
    </div>
);

const MarkdownSegmentContent: React.FC<{
    content: string;
    highlightingVersion: number;
    onPreview: (data: ImagePreviewData) => void;
}> = ({ content, highlightingVersion, onPreview }) => {
    const components = useMemo(() => ({
        ...headingComponents,
        strong: (props: React.HTMLAttributes<HTMLElement>) => <strong {...props} className={['token-critical', props.className].filter(Boolean).join(' ')} />,
        pre: ({ children }: { children?: React.ReactNode }) => {
            const codeBlockChild = extractCodeBlockChild(children);
            if (!codeBlockChild) {
                return <pre>{children}</pre>;
            }

            return (
                <CodeBlock
                    code={codeBlockChild.code}
                    language={codeBlockChild.language}
                    highlightingVersion={highlightingVersion}
                />
            );
        },
        img: ({ src, alt }: { src?: string; alt?: string }) => {
            if (!src) return null;
            return (
                <PreviewableImage
                    src={src}
                    alt={alt || 'Image'}
                    format="IMAGE"
                    wrapperTag="span"
                    imageClassName="markdown-image"
                    onPreview={onPreview}
                />
            );
        },
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
            return <code className={className}>{children}</code>;
        },
    }), [highlightingVersion, onPreview]);

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, trust: true }]] as any}
            components={components as any}
        >
            {content}
        </ReactMarkdown>
    );
};

export const RenderMathMarkdown: React.FC<RenderMathMarkdownProps> = ({ content, className = '' }) => {
    const [highlightingVersion, setHighlightingVersion] = useState(isHighlighterReady() ? 1 : 0);
    const [previewData, setPreviewData] = useState<ImagePreviewData | null>(null);

    useEffect(() => onHighlighterReady(() => setHighlightingVersion((value) => value + 1)), []);

    const segments = useMemo(() => tokenizeContent(content || ''), [content]);

    return (
        <div className={`render-math-markdown ${className}`.trim()}>
            <div className="rich-content-display">
                <div className="latex-content-wrapper">
                    {segments.map((segment, index) => {
                        if (segment.kind === 'markdown') {
                            return (
                                <MarkdownSegmentContent
                                    key={`segment-${index}`}
                                    content={segment.content}
                                    highlightingVersion={highlightingVersion}
                                    onPreview={setPreviewData}
                                />
                            );
                        }

                        if (segment.kind === 'execution_code') {
                            return (
                                <CodeBlock
                                    key={`segment-${index}`}
                                    code={segment.code}
                                    language={segment.language || 'python'}
                                    highlightingVersion={highlightingVersion}
                                />
                            );
                        }

                        if (segment.kind === 'execution_output') {
                            return <OutputBlock key={`segment-${index}`} output={segment.output} />;
                        }

                        return (
                            <ExecutionImagesBlock
                                key={`segment-${index}`}
                                images={segment.images}
                                onPreview={setPreviewData}
                            />
                        );
                    })}
                </div>
            </div>
            <ImagePreviewModal data={previewData} onClose={() => setPreviewData(null)} />
        </div>
    );
};

export default RenderMathMarkdown;
