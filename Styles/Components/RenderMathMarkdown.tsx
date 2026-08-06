import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { isHTMLContent } from '../ContentDetection';
import { getLanguageDisplayName, highlightCodeSync, isHighlighterReady, onHighlighterReady, resolveLanguage } from '../Shiki';
import { Icon } from '../../UI/Icons';

const MAX_CODE_HIGHLIGHT_SIZE = 50_000;
const LATEX_COMMAND_PATTERN = /\\[a-zA-Z]+/;
const MATH_NOTATION_PATTERNS = [/[_^]\{[^}]+\}/, /\\[{}]/];
const CODE_START = '<!-- CODE_EXECUTION_START -->';
const CODE_END = '<!-- CODE_EXECUTION_END -->';
const OUTPUT_START = '<!-- EXECUTION_OUTPUT_START -->';
const OUTPUT_END = '<!-- EXECUTION_OUTPUT_END -->';
const IMAGE_START = '<!-- EXECUTION_IMAGE_START -->';
const IMAGE_END = '<!-- EXECUTION_IMAGE_END -->';
const CODE_EXECUTION_PATTERN = /^<!-- CODE_EXECUTION_START -->\s*\n?<!-- LANGUAGE: ([^\n]+?) -->\s*\n?```[^\n]*\n([\s\S]*?)\n```\s*\n?<!-- CODE_EXECUTION_END -->$/;
const EXECUTION_OUTPUT_PATTERN = /^<!-- EXECUTION_OUTPUT_START -->\s*\n?```\n?([\s\S]*?)\n?```\s*\n?<!-- EXECUTION_OUTPUT_END -->$/;
const EXECUTION_IMAGE_PATTERN = /^<!-- EXECUTION_IMAGE_START -->\s*\n?<!-- MIME_TYPE: ([^\s]+) -->\s*\n?([\s\S]*?)\n?<!-- EXECUTION_IMAGE_END -->$/;
const EXECUTION_COMMENT_MARKERS = new Set([
    'CODE_EXECUTION_START', 'CODE_EXECUTION_END',
    'EXECUTION_OUTPUT_START', 'EXECUTION_OUTPUT_END',
    'EXECUTION_IMAGE_START', 'EXECUTION_IMAGE_END',
]);
const EXECUTION_COMMENT_PREFIXES = ['LANGUAGE:', 'MIME_TYPE:'];
const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, strict: false, trust: true }]] as any;
const REFERENCED_LABEL_STYLE: React.CSSProperties = { color: 'var(--accent-blue, #3b82f6)' };
const ACTION_GROUP_STYLE: React.CSSProperties = { display: 'flex', gap: 8, marginLeft: 'auto' };
const ACTION_BUTTON_STYLE: React.CSSProperties = { marginLeft: 0 };
const PREVIEW_ICON_STYLE: React.CSSProperties = { color: '#10b981' };
const PREVIEW_BADGE_STYLE: React.CSSProperties = { backgroundColor: 'rgba(16, 185, 129, 0.13)', color: '#10b981' };

type ExecutionImageItem =
    | { kind: 'image'; src: string; mimeType: string; format: string; alt: string }
    | { kind: 'error'; message: string };

type RenderSegment =
    | { kind: 'markdown'; content: string }
    | { kind: 'execution_code'; code: string; language: string }
    | { kind: 'execution_output'; output: string }
    | { kind: 'execution_images'; images: ExecutionImageItem[] };

type ExecutionKind = 'code' | 'output' | 'image';
interface ExecutionBlock { kind: ExecutionKind; start: number; end: number }

interface RenderMathMarkdownProps {
    content: string;
    className?: string;
}

interface ImagePreviewData { src: string; alt: string; format: string }
interface CodeBlockProps {
    code: string;
    language: string;
    label?: string;
    highlightingVersion: number;
    isFilePreview?: boolean;
    downloadUrl?: string;
}
interface PreviewableImageProps {
    src: string;
    alt: string;
    format: string;
    wrapperTag?: 'div' | 'span';
    extraClassName?: string;
    imageClassName?: string;
    onPreview: (data: ImagePreviewData) => void;
}

function classes(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
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
    return LATEX_COMMAND_PATTERN.test(content) || MATH_NOTATION_PATTERNS.some((pattern) => pattern.test(content));
}

function convertBacktickedLatexToMath(content: string): string {
    if (!content.includes('`')) return content;
    return content.replace(/(?<!`)`([^`]+)`(?!`)/g, (match, codeContent: string) =>
        containsLatexMath(codeContent) ? `$$${codeContent}$$` : match
    );
}

function createFallbackHighlightedMarkup(code: string): string {
    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

function highlightMarkup(code: string, language: string): string {
    const resolvedLanguage = resolveLanguage(language || 'plaintext');
    if (code.length > MAX_CODE_HIGHLIGHT_SIZE) return createFallbackHighlightedMarkup(code);
    try {
        return highlightCodeSync(code, resolvedLanguage);
    } catch {
        return createFallbackHighlightedMarkup(code);
    }
}

function getMarkdownFenceLanguage(className?: string): string {
    const token = className?.split(/\s+/).find((value) => value.startsWith('language-'));
    return token?.slice('language-'.length) || 'plaintext';
}

function isSandboxArtifactHref(href?: string): boolean {
    return !!href && (
        href.includes('/api/sandbox/files/') ||
        href.includes('/api/sandbox/artifacts/') ||
        href.includes('/api/sandbox/workspace/file')
    );
}

function pathWithoutQueryOrHash(href: string): string {
    const delimiter = href.search(/[?#]/);
    return delimiter === -1 ? href : href.slice(0, delimiter);
}

function isImageArtifactHref(href: string): boolean {
    return IMAGE_EXTENSION_PATTERN.test(pathWithoutQueryOrHash(href));
}

function getNodeText(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(getNodeText).join('');
    if (React.isValidElement(node)) return getNodeText((node.props as { children?: React.ReactNode }).children);
    return '';
}

function extractCodeBlockChild(children: React.ReactNode): { code: string; language: string } | null {
    for (const child of React.Children.toArray(children)) {
        if (!React.isValidElement(child)) continue;
        const props = child.props as { className?: string; children?: React.ReactNode };
        return {
            code: getNodeText(props.children ?? '').replace(/\n$/, ''),
            language: getMarkdownFenceLanguage(props.className),
        };
    }
    return null;
}

function parseExecutionCode(match: string): RenderSegment | null {
    const parsed = match.match(CODE_EXECUTION_PATTERN);
    return parsed ? {
        kind: 'execution_code',
        language: parsed[1].trim().toLowerCase(),
        code: parsed[2].trim(),
    } : null;
}

function parseExecutionOutput(match: string): RenderSegment | null {
    const parsed = match.match(EXECUTION_OUTPUT_PATTERN);
    return parsed ? { kind: 'execution_output', output: parsed[1].trim() } : null;
}

function parseExecutionImage(match: string): RenderSegment | null {
    const parsed = match.match(EXECUTION_IMAGE_PATTERN);
    if (!parsed) return null;

    const declaredMimeType = parsed[1].trim() || 'image/png';
    const mimeType = declaredMimeType.startsWith('image/') ? declaredMimeType : 'image/png';
    const base64Data = parsed[2].trim();
    if (!base64Data) {
        return { kind: 'execution_images', images: [{ kind: 'error', message: 'Empty image data received' }] };
    }

    let src = base64Data;
    if (!base64Data.startsWith('data:')) {
        const cleanedBase64 = base64Data.replace(/\s/g, '');
        if (!BASE64_PATTERN.test(cleanedBase64)) {
            return { kind: 'execution_images', images: [{ kind: 'error', message: 'Invalid base64 encoding' }] };
        }
        src = `data:${mimeType};base64,${cleanedBase64}`;
    }

    return {
        kind: 'execution_images',
        images: [{
            kind: 'image', src, mimeType,
            format: mimeType.replace('image/', '').toUpperCase(),
            alt: 'Generated visualization',
        }],
    };
}

function parseExecutionBlock(content: string, block: ExecutionBlock): RenderSegment | null {
    const source = content.slice(block.start, block.end);
    if (block.kind === 'code') return parseExecutionCode(source);
    if (block.kind === 'output') return parseExecutionOutput(source);
    return parseExecutionImage(source);
}

function findNextExecutionBlock(content: string, from: number): ExecutionBlock | null {
    let cursor = from;
    while ((cursor = content.indexOf('<!--', cursor)) !== -1) {
        let kind: ExecutionKind | undefined;
        let startMarker = '';
        let endMarker = '';
        if (content.startsWith(CODE_START, cursor)) {
            kind = 'code'; startMarker = CODE_START; endMarker = CODE_END;
        } else if (content.startsWith(OUTPUT_START, cursor)) {
            kind = 'output'; startMarker = OUTPUT_START; endMarker = OUTPUT_END;
        } else if (content.startsWith(IMAGE_START, cursor)) {
            kind = 'image'; startMarker = IMAGE_START; endMarker = IMAGE_END;
        }

        if (kind) {
            const endStart = content.indexOf(endMarker, cursor + startMarker.length);
            if (endStart !== -1) return { kind, start: cursor, end: endStart + endMarker.length };
        }
        cursor += 4;
    }
    return null;
}

function isExecutionMarkerComment(commentBody: string): boolean {
    const value = commentBody.trim();
    return EXECUTION_COMMENT_MARKERS.has(value) || EXECUTION_COMMENT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function stripExecutionMarkerComments(content: string): string {
    if (!content.includes('<!--')) return content;

    let cleaned = '';
    let cursor = 0;
    while (cursor < content.length) {
        const start = content.indexOf('<!--', cursor);
        if (start === -1) return cleaned + content.slice(cursor);
        const end = content.indexOf('-->', start + 4);
        if (end === -1) return cleaned + content.slice(cursor);

        cleaned += content.slice(cursor, start);
        if (!isExecutionMarkerComment(content.slice(start + 4, end))) cleaned += content.slice(start, end + 3);
        cursor = end + 3;
    }
    return cleaned;
}

function pushMarkdownSegment(segments: RenderSegment[], content: string): void {
    const cleaned = stripExecutionMarkerComments(content);
    if (!cleaned) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === 'markdown') previous.content += cleaned;
    else segments.push({ kind: 'markdown', content: cleaned });
}

function isStandaloneHtmlDocument(content: string): boolean {
    return findNextExecutionBlock(content, 0) === null && isHTMLContent(content);
}

function isRelaxedJson(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return (trimmed.includes('"') && trimmed.includes(':')) || trimmed.endsWith('}') || trimmed.endsWith(']');
    }
}

function tokenizeContent(content: string): RenderSegment[] {
    if (!content) return [];
    if (isStandaloneHtmlDocument(content)) {
        return [{ kind: 'execution_code', language: 'html', code: content.trim() }];
    }

    if (isRelaxedJson(content)) {
        let code = content.trim();
        try {
            code = JSON.stringify(JSON.parse(code), null, 2);
        } catch {
            // Relaxed JSON remains readable even when strict parsing fails.
        }
        return [{ kind: 'execution_code', language: 'json', code }];
    }

    const normalized = convertBacktickedLatexToMath(content);
    let block = findNextExecutionBlock(normalized, 0);
    if (!block) {
        const markdown = stripExecutionMarkerComments(normalized);
        return markdown ? [{ kind: 'markdown', content: markdown }] : [];
    }

    const segments: RenderSegment[] = [];
    let markdownStart = 0;
    while (block) {
        const between = normalized.slice(markdownStart, block.start);
        const parsed = parseExecutionBlock(normalized, block);
        const previous = segments[segments.length - 1];
        const mergeImages = parsed?.kind === 'execution_images' &&
            previous?.kind === 'execution_images' && between.trim() === '';

        if (!mergeImages) pushMarkdownSegment(segments, between);
        if (!parsed) pushMarkdownSegment(segments, normalized.slice(block.start, block.end));
        else if (mergeImages && previous?.kind === 'execution_images') previous.images.push(...parsed.images);
        else segments.push(parsed);

        markdownStart = block.end;
        block = findNextExecutionBlock(normalized, markdownStart);
    }

    pushMarkdownSegment(segments, normalized.slice(markdownStart));
    return segments;
}

function downloadHref(href: string): void {
    const link = document.createElement('a');
    link.href = href;
    link.download = '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function artifactFileInfo(href: string): { filename: string; language: string } {
    const pathname = pathWithoutQueryOrHash(href);
    const slash = pathname.lastIndexOf('/');
    const filename = safeDecodeURIComponent(pathname.slice(slash + 1)) || 'file';
    const dot = filename.lastIndexOf('.');
    return { filename, language: dot === -1 ? 'plaintext' : filename.slice(dot + 1) || 'plaintext' };
}

function headingClass(level: number, className?: string): string {
    return classes('token-heading', level <= 3 && `token-heading${level}`, className);
}

const headingComponents = {
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h1 {...props} className={headingClass(1, props.className)} />,
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props} className={headingClass(2, props.className)} />,
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props} className={headingClass(3, props.className)} />,
    h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h4 {...props} className={headingClass(4, props.className)} />,
    h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h5 {...props} className={headingClass(5, props.className)} />,
    h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h6 {...props} className={headingClass(6, props.className)} />,
};

const ImagePreviewModal: React.FC<{ data: ImagePreviewData | null; onClose: () => void }> = ({ data, onClose }) => {
    const [isClosing, setIsClosing] = useState(false);
    const closeTimer = React.useRef<number | undefined>(undefined);

    const handleClose = React.useCallback(() => {
        if (isClosing) return;
        setIsClosing(true);
        closeTimer.current = window.setTimeout(() => {
            closeTimer.current = undefined;
            setIsClosing(false);
            onClose();
        }, 180);
    }, [isClosing, onClose]);

    useEffect(() => {
        if (!data) return;
        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClose();
        };

        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [data, handleClose]);

    useEffect(() => () => {
        if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    }, []);

    if (!data) return null;

    return createPortal(
        <div className="file-preview-modal-overlay" onClick={handleClose} style={isClosing ? { animation: 'fadeIn 0.2s ease reverse' } : undefined}>
            <div className="file-preview-modal" onClick={(event) => event.stopPropagation()} style={isClosing ? { animation: 'scaleIn 0.2s ease reverse' } : undefined}>
                <div className="preview-modal-header">
                    <div className="preview-file-info">
                        <Icon name="image" style={PREVIEW_ICON_STYLE} />
                        <span className="preview-file-name">Generated Figure</span>
                        <span className="preview-file-badge" style={PREVIEW_BADGE_STYLE}>{data.format}</span>
                    </div>
                    <button className="preview-close-btn" type="button" title="Close (Esc)" aria-label="Close preview" onClick={handleClose}>
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

const CodeBlock: React.FC<CodeBlockProps> = function CodeBlock({ code, language, label, highlightingVersion, isFilePreview, downloadUrl }) {
    const [copied, setCopied] = useState(false);
    const resolvedLanguage = resolveLanguage(language || 'plaintext');
    const displayLabel = label || getLanguageDisplayName(resolvedLanguage);
    const highlightedMarkup = useMemo(
        () => highlightMarkup(code, resolvedLanguage),
        [code, resolvedLanguage, highlightingVersion]
    );

    const handleCopy = React.useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch (error) {
            console.error('Copy failed:', error);
        }
    }, [code]);

    return (
        <div className="code-block-container">
            <div className="code-block-header">
                <span className="code-block-title">
                    {displayLabel}
                    {isFilePreview && <span style={REFERENCED_LABEL_STYLE}> (Referenced File)</span>}
                </span>
                {downloadUrl ? (
                    <div style={ACTION_GROUP_STYLE}>
                        <button className="code-copy-icon" type="button" title="Download file" aria-label="Download file" onClick={() => downloadHref(downloadUrl)} style={ACTION_BUTTON_STYLE}>
                            <Icon name="download" />
                        </button>
                        <button className="code-copy-icon" type="button" title="Copy code" aria-label="Copy code" onClick={handleCopy} style={ACTION_BUTTON_STYLE}>
                            <Icon name={copied ? 'check' : 'content_copy'} />
                        </button>
                    </div>
                ) : (
                    <button className="code-copy-icon" type="button" title="Copy code" aria-label="Copy code" onClick={handleCopy}>
                        <Icon name={copied ? 'check' : 'content_copy'} />
                    </button>
                )}
            </div>
            <div className="code-block-content" dangerouslySetInnerHTML={{ __html: highlightedMarkup }} />
        </div>
    );
};

const OutputBlock: React.FC<{ output: string }> = function OutputBlock({ output }) {
    const lowerOutput = output.toLowerCase();
    const hasError = lowerOutput.includes('error') || lowerOutput.includes('traceback') || lowerOutput.includes('exception');
    return (
        <div className={classes('code-block-container', 'exec-output-block', hasError && 'exec-output-error')}>
            <div className="code-block-header"><span className="code-block-title">{hasError ? 'ERROR' : 'OUTPUT'}</span></div>
            <div className="code-block-content exec-output-content"><pre><code className="exec-output-text">{output}</code></pre></div>
        </div>
    );
};

const PreviewableImage: React.FC<PreviewableImageProps> = function PreviewableImage({
    src,
    alt,
    format,
    wrapperTag = 'div',
    extraClassName = '',
    imageClassName = '',
    onPreview,
}) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const hasError = failedSrc === src;
    const Wrapper = wrapperTag;

    const handleOpen = React.useCallback(() => {
        if (!hasError) onPreview({ src, alt, format });
    }, [alt, format, hasError, onPreview, src]);

    if (hasError) {
        const ErrorMessageTag = wrapperTag === 'span' ? 'span' : 'div';
        return (
            <Wrapper className={classes('exec-image-item', 'exec-image-error-item', extraClassName)}>
                <ErrorMessageTag className="exec-image-error" title={src}>Failed to render image</ErrorMessageTag>
            </Wrapper>
        );
    }

    return (
        <Wrapper
            className={classes('exec-image-item', extraClassName)}
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
                className={classes('exec-rendered-image', imageClassName)}
                loading="lazy"
                onError={() => setFailedSrc(src)}
            />
        </Wrapper>
    );
};

const ExecutionImagesBlock: React.FC<{ images: ExecutionImageItem[]; onPreview: (data: ImagePreviewData) => void }> = function ExecutionImagesBlock({ images, onPreview }) {
        return (
            <div className="code-block-container exec-image-block">
                <div className="code-block-header"><span className="code-block-title">FIGURE</span></div>
                <div className="exec-image-grid">
                    {images.map((image, index) => image.kind === 'error' ? (
                        <div key={`execution-image-${index}`} className="exec-image-item exec-image-error-item">
                            <div className="exec-image-error">{image.message}</div>
                        </div>
                    ) : (
                        <PreviewableImage key={`execution-image-${index}`} src={image.src} alt={image.alt} format={image.format} onPreview={onPreview} />
                    ))}
                </div>
            </div>
        );
};

const SandboxFileViewer: React.FC<{ href: string }> = function SandboxFileViewer({ href }) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [isImage, setIsImage] = useState(() => isImageArtifactHref(href));
    const [preview, setPreview] = useState<ImagePreviewData | null>(null);
    const { filename, language } = useMemo(() => artifactFileInfo(href), [href]);

    useEffect(() => {
        const imageFromPath = isImageArtifactHref(href);
        const controller = new AbortController();
        setContent(null);
        setIsImage(imageFromPath);
        setLoading(!imageFromPath);
        if (imageFromPath) return () => controller.abort();

        void fetch(href, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
                    await response.body?.cancel();
                    return null;
                }
                return response.text();
            })
            .then((text) => {
                if (text === null) setIsImage(true);
                else setContent(text);
                setLoading(false);
            })
            .catch((error: Error) => {
                if (error.name === 'AbortError') return;
                setContent(`Error loading file content: ${error.message}`);
                setLoading(false);
            });

        return () => controller.abort();
    }, [href]);

    if (isImage) {
        return (
            <>
                <div className="code-block-container sandbox-file-image-preview">
                    <div className="code-block-header">
                        <span className="code-block-title">{filename}<span style={REFERENCED_LABEL_STYLE}> (Referenced Image)</span></span>
                        <button className="code-copy-icon" type="button" title="Download image" aria-label="Download image" onClick={() => downloadHref(href)}>
                            <Icon name="download" />
                        </button>
                    </div>
                    <div className="exec-image-grid">
                        <PreviewableImage src={href} alt={filename} format={language.toUpperCase() || 'IMAGE'} onPreview={setPreview} />
                    </div>
                </div>
                <ImagePreviewModal data={preview} onClose={() => setPreview(null)} />
            </>
        );
    }

    return (
        <CodeBlock
            code={loading ? 'Loading file content...' : (content || '')}
            language={loading ? 'plaintext' : language}
            highlightingVersion={1}
            label={filename}
            isFilePreview
            downloadUrl={href}
        />
    );
};

const MarkdownSegmentContent: React.FC<{
    content: string;
    highlightingVersion: number;
    onPreview: (data: ImagePreviewData) => void;
}> = function MarkdownSegmentContent({ content, highlightingVersion, onPreview }) {
    const components = useMemo(() => ({
        ...headingComponents,
        strong: (props: React.HTMLAttributes<HTMLElement>) => <strong {...props} className={classes('token-critical', props.className)} />,
        pre: ({ children }: { children?: React.ReactNode }) => {
            const codeBlock = extractCodeBlockChild(children);
            return codeBlock ? (
                <CodeBlock code={codeBlock.code} language={codeBlock.language} highlightingVersion={highlightingVersion} />
            ) : <pre>{children}</pre>;
        },
        img: ({ src, alt }: { src?: string; alt?: string }) => src ? (
            <PreviewableImage src={src} alt={alt || 'Image'} format="IMAGE" wrapperTag="span" imageClassName="markdown-image" onPreview={onPreview} />
        ) : null,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => isSandboxArtifactHref(href) ? (
            <SandboxFileViewer key={href} href={href!} />
        ) : (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
        ),
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => <code className={className}>{children}</code>,
    }), [highlightingVersion, onPreview]);

    return (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components as any}>
            {content}
        </ReactMarkdown>
    );
};

const RenderedContent = React.memo<{
    segments: RenderSegment[];
    highlightingVersion: number;
    onPreview: (data: ImagePreviewData) => void;
}>(function RenderedContent({ segments, highlightingVersion, onPreview }) {
    return (
        <div className="rich-content-display">
            <div className="latex-content-wrapper">
                {segments.map((segment, index) => {
                    switch (segment.kind) {
                        case 'markdown':
                            return <MarkdownSegmentContent key={`segment-${index}`} content={segment.content} highlightingVersion={highlightingVersion} onPreview={onPreview} />;
                        case 'execution_code':
                            return <CodeBlock key={`segment-${index}`} code={segment.code} language={segment.language || 'python'} highlightingVersion={highlightingVersion} />;
                        case 'execution_output':
                            return <OutputBlock key={`segment-${index}`} output={segment.output} />;
                        case 'execution_images':
                            return <ExecutionImagesBlock key={`segment-${index}`} images={segment.images} onPreview={onPreview} />;
                    }
                })}
            </div>
        </div>
    );
});

const RenderMathMarkdown: React.FC<RenderMathMarkdownProps> = React.memo(function RenderMathMarkdown({ content, className = '' }) {
    const [highlightingVersion, setHighlightingVersion] = useState(isHighlighterReady() ? 1 : 0);
    const [previewData, setPreviewData] = useState<ImagePreviewData | null>(null);

    useEffect(() => onHighlighterReady(() => setHighlightingVersion((value) => value + 1)), []);
    const segments = useMemo(() => tokenizeContent(content || ''), [content]);

    return (
        <div className={classes('render-math-markdown', className)}>
            <RenderedContent segments={segments} highlightingVersion={highlightingVersion} onPreview={setPreviewData} />
            <ImagePreviewModal data={previewData} onClose={() => setPreviewData(null)} />
        </div>
    );
});

export default RenderMathMarkdown;
