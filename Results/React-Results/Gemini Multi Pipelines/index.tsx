import React, { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse, Part, Chat, GenerateImagesResponse } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';

// --- Constants ---
const DEFAULT_TEXT_MODEL_ID = 'gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL_ID = 'imagen-4.0-generate-preview-06-06';
const MAX_PIPELINES = 5;
const MAX_IMAGES_PER_REQUEST = 4;
const API_KEY_STORAGE_KEY = 'gemini_api_key';

const AVAILABLE_MODELS_FOR_SELECTION = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', defaultSelected: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', defaultSelected: false },
    { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Lite', defaultSelected: false },
];

// --- GitHub Dark Classic Theme for SyntaxHighlighter ---
const gitHubDarkClassicStyle: { [key: string]: CSSProperties } = {
  'pre[class*="language-"]': {
    color: '#e1e4e8', // editor.foreground
    background: '#24292e', // editor.background
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace",
    fontSize: '0.9em',
    textAlign: 'left' as const,
    whiteSpace: 'pre' as const,
    wordSpacing: 'normal' as const,
    wordBreak: 'normal' as const,
    wordWrap: 'normal' as const,
    lineHeight: '1.5',
    MozTabSize: 4, 
    OTabSize: 4,
    tabSize: 4, 
    WebkitHyphens: 'none' as const,
    MozHyphens: 'none' as const,
    msHyphens: 'none' as const,
    hyphens: 'none' as const,
    padding: '1em',
    margin: '.5em 0',
    overflow: 'auto' as const,
    borderRadius: '6px', 
    opacity: 1, // Ensure pre tag itself is opaque
  },
  'code[class*="language-"]': {
    color: '#e1e4e8', // Default text color for code
    background: 'transparent', // Ensure inner code tag is transparent
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace",
    direction: 'ltr' as const,
    textAlign: 'left' as const,
    whiteSpace: 'pre' as const,
    wordSpacing: 'normal' as const,
    wordBreak: 'normal' as const,
    lineHeight: '1.5',
    MozTabSize: 4, 
    OTabSize: 4,
    tabSize: 4, 
    WebkitHyphens: 'none' as const,
    MozHyphens: 'none' as const,
    msHyphens: 'none' as const,
    hyphens: 'none' as const,
    opacity: 1, // Ensure code tag itself is opaque
  },
  'comment': { color: '#6a737d' },
  'prolog': { color: '#6a737d' },
  'doctype': { color: '#6a737d' },
  'cdata': { color: '#6a737d' },
  'punctuation': { color: '#d1d5da' },
  'constant': { color: '#79b8ff' },
  'entity': { color: '#b392f0' },
  'entity.name.function': { color: '#b392f0' },
  'entity.name.class': { color: '#b392f0' },
  'entity.name.tag': { color: '#85e89d' },
  'namespace': { color: '#e1e4e8' },
  'keyword': { color: '#f97583' },
  'storage': { color: '#f97583' },
  'string': { color: '#9ecbff' },
  'char': { color: '#9ecbff' },
  'support': { color: '#79b8ff' },
  'meta.property-name': { color: '#79b8ff' },
  'variable': { color: '#ffab70' },
  'variable.parameter': { color: '#e1e4e8' }, // For function parameters
  'operator': { color: '#f97583' },
  'url': { color: '#79b8ff', textDecoration: 'underline' as const },
  'attr-name': { color: '#85e89d' },
  'attr-value': { color: '#9ecbff' },
  'function': { color: '#b392f0' },
  'class-name': { color: '#b392f0' },
  'tag': { color: '#85e89d' },
  'selector': { color: '#f97583' },
  'property': { color: '#79b8ff' }, // CSS property
  'important': { color: '#f97583', fontWeight: 'bold' as const },
  'atrule': { color: '#f97583' },
  'boolean': { color: '#79b8ff' },
  'number': { color: '#79b8ff' },
  'regex': { color: '#dbedff' },
  'italic': { fontStyle: 'italic' as const },
  'bold': { fontWeight: 'bold' as const },
  'deleted': { background: 'rgba(249, 117, 131, 0.2)', color: '#fdaeb7' }, 
  'inserted': { background: 'rgba(133, 232, 157, 0.2)', color: '#85e89d' }, 
};


// --- Helper Functions ---
const fileToGenerativePart = async (file: File): Promise<Part> => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    const base64EncodedData = await base64EncodedDataPromise;
    return {
        inlineData: {
            data: base64EncodedData,
            mimeType: file.type,
        },
    };
};

// --- Types ---
type Mode = 'multiModel' | 'testConfig' | 'imageGen';

interface FilePreview {
    name: string;
    type: string;
    dataUrl: string; 
    generativePart?: Part;
}

interface GroundingChunkWeb {
    uri: string;
    title: string;
}
interface GroundingChunk {
    web: GroundingChunkWeb;
}

interface HistoryItem {
    id: string; 
    promptText?: string;
    promptFiles?: FilePreview[];
    response?: string;
    error?: string;
    isFollowUp: boolean;
    timestamp: number;
    isLoading?: boolean; 
    groundingMetadata?: GroundingChunk[];
    stoppedByUser?: boolean; 
}

interface FollowUpInputState {
    text: string;
    files: File[]; 
    filePreviews: FilePreview[]; 
    sendToAll: boolean;
}

const initialFollowUpInputState: FollowUpInputState = {
    text: '',
    files: [],
    filePreviews: [],
    sendToAll: false,
};

interface ResultItemConfig {
    temperature?: number;
    topP?: number;
    systemInstruction?: string;
    googleSearchEnabled?: boolean;
}

interface ResultItem {
    id: string; 
    modelName?: string;
    isLoading: boolean; 
    config?: ResultItemConfig;
    conversationHistory: HistoryItem[];
    chatSession?: Chat;
    error?: string; 
}

interface Pipeline {
    id: string; 
    temperature: number;
    topP: number;
}

interface ImageGenRequest {
    id: string;
    prompt: string; // User's original text prompt
    numImages: number;
    isLoading: boolean;
    images: { base64Bytes: string; dataUrl: string; }[];
    error?: string;
    timestamp: number;
    referenceImagePreviewUrl?: string; 
    autoGeneratedDescription?: string; 
    statusMessage?: string; 
}

interface PromptTemplate {
    id: string;
    name: string;
    promptText: string;
    systemInstruction?: string;
}

// API Key Management Types and Functions
const getStoredApiKey = (): string | null => {
    try {
        return localStorage.getItem(API_KEY_STORAGE_KEY);
    } catch (error) {
        console.error('Error accessing localStorage:', error);
        return null;
    }
};

const setStoredApiKey = (apiKey: string): void => {
    try {
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    } catch (error) {
        console.error('Error storing API key:', error);
    }
};

const removeStoredApiKey = (): void => {
    try {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch (error) {
        console.error('Error removing API key:', error);
    }
};

const isValidApiKey = (apiKey: string): boolean => {
    // Basic validation - Gemini API keys typically start with 'AI' and are 39 characters long
    return typeof apiKey === 'string' && 
           apiKey.trim().length > 10 && 
           /^[A-Za-z0-9_-]+$/.test(apiKey.trim());
};

// --- Markdown Custom Components ---
const markdownComponents = {
    h1: ({node, ...props}) => <h1 style={{color: '#e14c4c'}} {...props} />,
    h2: ({node, ...props}) => <h2 style={{color: '#e14c4c'}} {...props} />,
    h3: ({node, ...props}) => <h3 style={{color: '#e14c4c'}} {...props} />,
    h4: ({node, ...props}) => <h4 style={{color: '#e14c4c'}} {...props} />,
    h5: ({node, ...props}) => <h5 style={{color: '#e14c4c'}} {...props} />,
    h6: ({node, ...props}) => <h6 style={{color: '#e14c4c'}} {...props} />,
    strong: ({node, ...props}) => <strong style={{color: '#7490d6'}} {...props} />,
    em: ({node, ...props}) => <em style={{color: '#ff79c6'}} {...props} />,
    code({ node, inline, className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        if (!inline && match) {
            // Code block with language
            return (
                <SyntaxHighlighter
                    style={gitHubDarkClassicStyle}
                    language={match[1]}
                    PreTag="div" // SyntaxHighlighter will wrap this in a <pre> internally if style targets pre
                    {...props}
                >
                    {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
            );
        } else if (inline) {
            // Inline code
            return (
                <code className="inline-code-custom" {...props}>
                    {children}
                </code>
            );
        }
        // Code block without language (falls back to default <pre><code> styling)
        // or other <code> usage not handled above
        return (
            <pre><code className={className} {...props}>
                {children}
            </code></pre>
        );
    }
};


// --- Components ---
const LoadingSpinner: React.FC<{small?: boolean}> = ({small = false}) => (
    <div className={`spinner-container ${small ? 'small' : ''}`} aria-label="Loading...">
        <div className="spinner"></div>
    </div>
);

const ImageLightbox: React.FC<{ src: string | null; onClose: () => void }> = ({ src, onClose }) => {
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!src) return null;

    return (
        <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                <img src={src} alt="Enlarged preview" className="lightbox-image" />
                <button onClick={onClose} className="lightbox-close-button" aria-label="Close image preview">&times;</button>
            </div>
        </div>
    );
};

// API Key Entry Component
const ApiKeyEntryModal: React.FC<{ onApiKeySet: (apiKey: string) => void }> = ({ onApiKeySet }) => {
    const [apiKey, setApiKey] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isValidating, setIsValidating] = useState<boolean>(false);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Focus the input when component mounts
        apiKeyInputRef.current?.focus();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedKey = apiKey.trim();
        
        if (!trimmedKey) {
            setError('Please enter your Gemini API key.');
            return;
        }

        if (!isValidApiKey(trimmedKey)) {
            setError('Please enter a valid Gemini API key. It should be a string of letters, numbers, hyphens, and underscores.');
            return;
        }

        setIsValidating(true);
        setError('');

        try {
            // Test the API key by creating a GoogleGenAI instance
            const testAI = new GoogleGenAI({ apiKey: trimmedKey });
            
            // Try to list models to validate the key
            // Note: This is a simple validation, actual usage will determine if key works
            // We'll store it and let the main app handle any further validation
            
            setStoredApiKey(trimmedKey);
            onApiKeySet(trimmedKey);
        } catch (error: any) {
            console.error('API key validation error:', error);
            setError('Failed to initialize with the provided API key. Please check if your key is correct.');
        } finally {
            setIsValidating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmit(e as any);
        }
    };

    return (
        <div className="api-key-modal-overlay">
            <div className="api-key-modal-content">
                <div className="api-key-modal-header">
                    <h1>Welcome to Gemini Multi Pipelines</h1>
                    <p>To get started, please enter your Gemini API key</p>
                </div>
                
                <form onSubmit={handleSubmit} className="api-key-form">
                    <div className="api-key-input-group">
                        <label htmlFor="api-key-input">Gemini API Key:</label>
                        <input
                            id="api-key-input"
                            ref={apiKeyInputRef}
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter your Gemini API key..."
                            className="api-key-input"
                            disabled={isValidating}
                            aria-describedby={error ? 'api-key-error' : undefined}
                        />
                        <div className="api-key-input-hint">
                            Your API key will be stored locally in your browser and never sent to any server except Google's Gemini API.
                        </div>
                    </div>
                    
                    {error && (
                        <div id="api-key-error" className="api-key-error" role="alert">
                            {error}
                        </div>
                    )}
                    
                    <button 
                        type="submit" 
                        className="api-key-submit-button"
                        disabled={isValidating || !apiKey.trim()}
                    >
                        {isValidating ? 'Validating...' : 'Continue'}
                    </button>
                </form>
                
                <div className="api-key-help">
                    <p><strong>Don't have an API key?</strong></p>
                    <p>Get your free Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a></p>
                </div>
            </div>
        </div>
    );
};

interface FilePreviewDisplayProps {
    files: FilePreview[];
    onRemoveFile?: (index: number) => void;
    isReadOnly?: boolean;
    onImageClick?: (dataUrl: string) => void; // Added for lightbox
}

const FilePreviewDisplay: React.FC<FilePreviewDisplayProps> = ({ files, onRemoveFile, isReadOnly = false, onImageClick }) => {
    if (!files || files.length === 0) return null;
    return (
        <div className="file-previews-grid">
            {files.map((file, index) => (
                <div key={`${file.name}-${index}-${file.dataUrl.slice(-10)}`} className="file-preview-item">
                    {!isReadOnly && onRemoveFile && (
                        <button
                            onClick={() => onRemoveFile(index)}
                            className="remove-file-button"
                            aria-label={`Remove ${file.name}`}
                        >
                            &times;
                        </button>
                    )}
                    {file.type.startsWith('image/') ? (
                        <img 
                            src={file.dataUrl} 
                            alt={file.name} 
                            onClick={onImageClick ? () => onImageClick(file.dataUrl) : undefined}
                            style={{ cursor: onImageClick ? 'pointer' : 'default' }}
                            role={onImageClick ? "button" : undefined}
                            tabIndex={onImageClick ? 0 : undefined}
                            onKeyDown={onImageClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onImageClick(file.dataUrl); } } : undefined}
                            aria-label={onImageClick ? `View larger image for ${file.name}`: file.name}
                        />
                    ) : null}
                    <span>{file.name} ({file.type.split('/')[1] || 'file'})</span>
                </div>
            ))}
        </div>
    );
};

interface ResultCardProps {
    itemId: string; 
    title: string;
    item: ResultItem;
    followUpInput: FollowUpInputState;
    onFollowUpInputTextChange: (text: string) => void;
    onFollowUpFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveFollowUpFile: (fileIndex: number) => void;
    onSendFollowUp: (sendToAll: boolean, focusCallback?: () => void) => void;
    isSendToAllVisible: boolean;
    sendToAllChecked: boolean;
    onSendToAllChange: (checked: boolean) => void;
    onStopGeneration: (itemId: string, turnId: string) => void; 
    streamStopFlagsRef: React.RefObject<Record<string, Record<string, boolean>>>;
    onImagePreviewClick: (dataUrl: string) => void; 
}

const ResultCard: React.FC<ResultCardProps> = ({ 
    itemId, title, item, 
    followUpInput, onFollowUpInputTextChange, 
    onFollowUpFileChange, onRemoveFollowUpFile, onSendFollowUp,
    isSendToAllVisible, sendToAllChecked, onSendToAllChange,
    onStopGeneration, streamStopFlagsRef, onImagePreviewClick
}) => {
    const { isLoading, conversationHistory, config, error: itemError } = item;
    const lastSuccessfulTurn = conversationHistory.slice().reverse().find(turn => turn.response && !turn.error);
    const followUpFileInputRef = useRef<HTMLInputElement>(null);
    const followUpTextareaRef = useRef<HTMLTextAreaElement>(null);
    const conversationHistoryRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (conversationHistoryRef.current) {
            // Only auto-scroll if user is near the bottom or it's the initial load
            const { scrollTop, scrollHeight, clientHeight } = conversationHistoryRef.current;
            const isScrolledToBottom = scrollHeight - scrollTop <= clientHeight + 100; // 100px tolerance
            
            if (isScrolledToBottom || conversationHistory.length <= 2) { // also scroll if very few messages
                 conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
            }
        }
    }, [conversationHistory, conversationHistory[conversationHistory.length - 1]?.response, conversationHistory[conversationHistory.length - 1]?.isLoading]);


    const handleFollowUpSendAction = () => {
        if (followUpInput.text.trim() || followUpInput.filePreviews.length > 0) {
            onSendFollowUp(sendToAllChecked, () => {
                followUpTextareaRef.current?.focus();
            });
        }
    };
    
    const handleFollowUpKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            handleFollowUpSendAction();
        }
    };
    
    const hasContentForFollowUp = followUpInput.text.trim() || followUpInput.filePreviews.length > 0;

    const sendToAllInputId = `send-to-all-input-${itemId}`;
    const sendToAllLabelId = `send-to-all-label-${itemId}`;

    return (
        <div className="result-display-card">
            <h4>{title}</h4>
            {config && (
                <div className="config-details">
                    <strong>Current Configuration:</strong>
                    {config.googleSearchEnabled && <><br/><em>Google Search: Enabled (Overrides Temperature, TopP, System Instruction)</em></>}
                    {config.temperature !== undefined && !config.googleSearchEnabled && ` Temp: ${config.temperature.toFixed(1)}`}
                    {config.topP !== undefined && !config.googleSearchEnabled && `, Top P: ${config.topP.toFixed(2)}`}
                    {config.systemInstruction && !config.googleSearchEnabled && <><br/><em>System: "{config.systemInstruction.length > 50 ? config.systemInstruction.substring(0,47) + '...' : config.systemInstruction}"</em></>}
                    {!config.googleSearchEnabled && config.temperature === undefined && config.topP === undefined && config.systemInstruction === undefined && <><br/><em>Using default model parameters.</em></>}
                </div>
            )}

            <div className="conversation-history" ref={conversationHistoryRef}>
                {conversationHistory.map((turn) => {
                    const isStreaming = turn.isLoading && !turn.error;
                    const isStoppedByUser = turn.stoppedByUser;
                    const canStopStream = isStreaming && !(streamStopFlagsRef.current?.[itemId]?.[turn.id]);

                    return (
                        <div key={turn.id} className="chat-turn">
                            {turn.promptText !== undefined || (turn.promptFiles && turn.promptFiles.length > 0) ? (
                                <div className="user-message">
                                    <strong>You:</strong>
                                    {turn.promptText && <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0' }}>{turn.promptText}</p>}
                                    {turn.promptFiles && turn.promptFiles.length > 0 && 
                                        <FilePreviewDisplay 
                                            files={turn.promptFiles} 
                                            isReadOnly={true} 
                                            onImageClick={onImagePreviewClick}
                                        />}
                                </div>
                            ) : null}
                            {(turn.response || turn.isLoading || turn.error) && (
                                <div className={`model-message ${turn.error ? 'error-box' : ''}`}>
                                    <strong>Model:</strong>
                                    {turn.response && (
                                        <div className="response-text">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                                components={markdownComponents}
                                            >
                                                {turn.response}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                    {isStreaming && <LoadingSpinner small={true} />}
                                    {isStoppedByUser && <p className="stopped-notice"><em>Generation stopped by user.</em></p>}
                                    {canStopStream && (
                                        <button 
                                            onClick={() => onStopGeneration(itemId, turn.id)} 
                                            className="action-button danger-action-button stop-generation-button"
                                            aria-label="Stop generating this response"
                                        >
                                            Stop Generation
                                        </button>
                                    )}
                                    {turn.groundingMetadata && turn.groundingMetadata.length > 0 && (
                                        <div className="grounding-sources">
                                            <strong>Sources:</strong>
                                            <ul>
                                                {turn.groundingMetadata.map((chunk, idx) => (
                                                    <li key={`${turn.id}-source-${idx}`}>
                                                        <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer">
                                                            {chunk.web.title || chunk.web.uri}
                                                        </a>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {turn.error && !isStreaming && (
                                        <p>{turn.error}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            
            {isLoading && conversationHistory.length === 0 && !itemError && <LoadingSpinner /> }
            {itemError && conversationHistory.length === 0 && (
                 <div className="error-box" role="alert" style={{marginTop:'1rem'}}><strong>Error:</strong> {itemError}</div>
            )}


            {!isLoading && lastSuccessfulTurn && ( 
                 <div className="follow-up-section">
                    <textarea
                        ref={followUpTextareaRef}
                        className="follow-up-textarea"
                        value={followUpInput.text}
                        onChange={(e) => onFollowUpInputTextChange(e.target.value)}
                        onKeyDown={handleFollowUpKeyDown}
                        placeholder="Ask a follow-up or add files... (Ctrl+Enter to send)"
                        aria-label="Follow-up message input"
                        rows={3}
                    />
                    <div className="follow-up-file-controls">
                        <button 
                            type="button" 
                            className="action-button follow-up-attach-button" 
                            onClick={() => followUpFileInputRef.current?.click()}
                            aria-label="Attach files to follow-up"
                        >
                            Attach Files
                        </button>
                        <input
                            type="file"
                            multiple
                            accept="*"
                            ref={followUpFileInputRef}
                            onChange={onFollowUpFileChange}
                            style={{ display: 'none' }}
                            id={`follow-up-file-input-${itemId}`}
                        />
                    </div>
                    {followUpInput.filePreviews.length > 0 && (
                        <div className="follow-up-file-previews">
                             <FilePreviewDisplay 
                                files={followUpInput.filePreviews} 
                                onRemoveFile={onRemoveFollowUpFile}
                                onImageClick={onImagePreviewClick}
                             />
                        </div>
                    )}
                    <div className="follow-up-actions">
                        {isSendToAllVisible && (
                             <div
                                className="custom-checkbox-container"
                                onClick={() => onSendToAllChange(!sendToAllChecked)}
                                role="checkbox"
                                aria-checked={sendToAllChecked}
                                aria-labelledby={sendToAllLabelId}
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === ' ' || e.key === 'Enter') {
                                        e.preventDefault();
                                        onSendToAllChange(!sendToAllChecked);
                                    }
                                }}
                            >
                                <input
                                    type="checkbox"
                                    id={sendToAllInputId}
                                    checked={sendToAllChecked}
                                    onChange={() => {/* Handled by div click/keydown */}}
                                    aria-labelledby={sendToAllLabelId}
                                    tabIndex={-1} 
                                />
                                <span className="checkmark" aria-hidden="true"></span>
                                <label htmlFor={sendToAllInputId} id={sendToAllLabelId}>
                                    Send to all
                                </label>
                            </div>
                        )}
                        <button
                            onClick={handleFollowUpSendAction}
                            disabled={!hasContentForFollowUp || item.isLoading} 
                            className="action-button follow-up-button"
                        >
                            {item.isLoading ? 'Sending...' : 'Send Follow-up'}
                        </button>
                    </div>
                </div>
            )}
            
            {!isLoading && !itemError && conversationHistory.length === 0 && (
                 <p style={{color: 'var(--text-secondary-color)', textAlign:'center', marginTop:'1rem'}}>
                    {item.modelName ? `Send a message to start a chat with ${item.modelName}.` : `Send a message to test this configuration.`}
                </p>
            )}
        </div>
    );
};


const App: React.FC = () => {
    const [ai, setAi] = useState<GoogleGenAI | null>(null);
    const [currentApiKey, setCurrentApiKey] = useState<string | null>(null);
    const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
    const [currentMode, setCurrentMode] = useState<Mode>('multiModel');
    const [userInputText, setUserInputText] = useState<string>('');
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]); 
    const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]); 

    const [systemInstruction, setSystemInstruction] = useState<string>('');
    const [enableGoogleSearch, setEnableGoogleSearch] = useState<boolean>(false);

    const [selectedModels, setSelectedModels] = useState<string[]>(
        AVAILABLE_MODELS_FOR_SELECTION.filter(m => m.defaultSelected).map(m => m.id)
    );
    const [multiModelChatResults, setMultiModelChatResults] = useState<ResultItem[]>([]);
    const [activeMultiModelChatTab, setActiveMultiModelChatTab] = useState<string>(
        AVAILABLE_MODELS_FOR_SELECTION.find(m => m.defaultSelected)?.id || (AVAILABLE_MODELS_FOR_SELECTION[0]?.id || '')
    );
    
    const [followUpInputs, setFollowUpInputs] = useState<Record<string, FollowUpInputState>>({});

    const [configTesterSelectedModelId, setConfigTesterSelectedModelId] = useState<string>(DEFAULT_TEXT_MODEL_ID);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [testConfigResults, setTestConfigResults] = useState<ResultItem[]>([]);
    const [activeConfigTab, setActiveConfigTab] = useState<string>('set-0');

    const [globalLoading, setGlobalLoading] = useState<boolean>(false); 
    const [isAppLoading, setIsAppLoading] = useState(true);
    const [isContentVisible, setIsContentVisible] = useState(false);

    const mainFileInputRef = useRef<HTMLInputElement>(null);
    const mainPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const streamStopFlagsRef = useRef<Record<string, Record<string, boolean>>>({});

    const [imageGenRequests, setImageGenRequests] = useState<ImageGenRequest[]>([]);
    const [numImagesToGenerate, setNumImagesToGenerate] = useState<number>(1);

    const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
    const [newTemplateName, setNewTemplateName] = useState<string>('');

    const [lightboxImageSrc, setLightboxImageSrc] = useState<string | null>(null);

    const [isMultiModelSettingsCollapsed, setIsMultiModelSettingsCollapsed] = useState(false);
    const [isConfigTesterSettingsCollapsed, setIsConfigTesterSettingsCollapsed] = useState(false);


    // Initialize app and check for stored API key
    useEffect(() => {
        const preloader = document.getElementById('preloader');
        const hidePreloader = () => {
            if (preloader) {
                preloader.style.opacity = '0';
                setTimeout(() => { preloader.style.display = 'none'; }, 500);
            }
        };

        const storedApiKey = getStoredApiKey();
        
        if (!storedApiKey || !isValidApiKey(storedApiKey)) {
            // No valid API key found, show the modal
            setShowApiKeyModal(true);
            setIsAppLoading(false);
            hidePreloader();
            return;
        }

        // Valid API key found, initialize the app
        try {
            const genAI = new GoogleGenAI({ apiKey: storedApiKey });
            setAi(genAI);
            setCurrentApiKey(storedApiKey);
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
            // Remove invalid key and show modal
            removeStoredApiKey();
            setShowApiKeyModal(true);
        } finally {
            setIsAppLoading(false);
            hidePreloader();
        }
    }, []);

    // Handle API key set from modal
    const handleApiKeySet = (apiKey: string) => {
        try {
            const genAI = new GoogleGenAI({ apiKey });
            setAi(genAI);
            setCurrentApiKey(apiKey);
            setShowApiKeyModal(false);
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI with new key:", error);
            // The modal will handle showing the error
        }
    };

    // Handle API key reset
    const handleResetApiKey = () => {
        removeStoredApiKey();
        setAi(null);
        setCurrentApiKey(null);
        setShowApiKeyModal(true);
        // Reset app state
        setMultiModelChatResults([]);
        setTestConfigResults([]);
        setImageGenRequests([]);
        setUserInputText('');
        setUploadedFiles([]);
        setFilePreviews([]);
        setFollowUpInputs({});
    };

    useEffect(() => {
        if (!isAppLoading) {
            const timer = setTimeout(() => setIsContentVisible(true), 100);
            return () => clearTimeout(timer);
        }
    }, [isAppLoading]);

    useEffect(() => {
        const storedTemplates = localStorage.getItem('promptTemplates');
        if (storedTemplates) {
            try {
                setPromptTemplates(JSON.parse(storedTemplates));
            } catch (e) {
                console.error("Failed to parse stored prompt templates:", e);
                localStorage.removeItem('promptTemplates');
            }
        }
    }, []);

    useEffect(() => {
        if (promptTemplates.length > 0 || localStorage.getItem('promptTemplates')) {
             localStorage.setItem('promptTemplates', JSON.stringify(promptTemplates));
        }
    }, [promptTemplates]);


     useEffect(() => {
        const currentSelectedModelDetails = AVAILABLE_MODELS_FOR_SELECTION
            .filter(m => selectedModels.includes(m.id));

        setMultiModelChatResults(prevResults => {
            const newResultsMap = new Map(prevResults.map(r => [r.id, r]));
            currentSelectedModelDetails.forEach(m => {
                if (!newResultsMap.has(m.id)) {
                    newResultsMap.set(m.id, { 
                        id: m.id, 
                        modelName: m.name, 
                        isLoading: false, 
                        conversationHistory: [],
                        chatSession: undefined,
                        config: enableGoogleSearch
                            ? { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined }
                            : { googleSearchEnabled: false, temperature: 1.0, topP: 0.95, systemInstruction: systemInstruction.trim() || undefined }
                    });
                    setFollowUpInputs(prev => ({...prev, [m.id]: { ...initialFollowUpInputState }}));
                } else { // Update existing item's config based on global settings
                    const existing = newResultsMap.get(m.id);
                    if (existing) {
                        newResultsMap.set(m.id, {
                            ...existing, 
                            config: enableGoogleSearch
                                ? { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined }
                                : { 
                                    ...(existing.config || { temperature: 1.0, topP: 0.95 }), // keep existing temp/topP if not searching
                                    googleSearchEnabled: false, 
                                    systemInstruction: systemInstruction.trim() || undefined
                                  }
                        });
                    }
                }
            });
            const finalResults = Array.from(newResultsMap.values()).filter(r => selectedModels.includes(r.id));
            return finalResults;
        });
        
        if (selectedModels.length > 0) {
            if (!selectedModels.includes(activeMultiModelChatTab) || !activeMultiModelChatTab) {
                 setActiveMultiModelChatTab(selectedModels[0]);
            }
        } else if (AVAILABLE_MODELS_FOR_SELECTION.length > 0 && activeMultiModelChatTab) {
             setActiveMultiModelChatTab(''); 
        }
    }, [selectedModels, systemInstruction, enableGoogleSearch]);


    const handleMainFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newFilesArray = Array.from(event.target.files || []);
        if (newFilesArray.length === 0) return;

        // In ImageGen mode, only allow one file and replace existing if any
        const filesToProcess = currentMode === 'imageGen' ? newFilesArray.slice(0, 1) : newFilesArray;

        if (currentMode === 'imageGen') {
            setUploadedFiles(filesToProcess); // Replace
        } else {
            setUploadedFiles(prev => [...prev, ...filesToProcess]); // Append
        }
        
        const newPreviewsPromises = filesToProcess.map(async file => {
            const dataUrl = await new Promise<string>(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
            });
            try {
                const generativePart = await fileToGenerativePart(file);
                return { name: file.name, type: file.type, dataUrl, generativePart };
            } catch (e) {
                console.error(`Error processing file ${file.name} for generative part:`, e);
                // For image gen, we critically need the dataUrl for preview, generativePart is secondary (used by text model)
                return { name: file.name, type: file.type, dataUrl }; 
            }
        });

        const resolvedPreviews = await Promise.all(newPreviewsPromises);
        
        if (currentMode === 'imageGen') {
            setFilePreviews(resolvedPreviews); // Replace
        } else {
            setFilePreviews(prev => [...prev, ...resolvedPreviews.filter(p => p !== null)]); // Append
        }

        if (mainFileInputRef.current) {
            mainFileInputRef.current.value = ""; 
        }
    };

    const handleRemoveMainFile = (indexToRemove: number) => {
        setUploadedFiles(prev => prev.filter((_, index) => index !== indexToRemove));
        setFilePreviews(prev => prev.filter((_, index) => index !== indexToRemove));
    };
    
    const updateFollowUpInputText = (itemId: string, text: string) => {
        setFollowUpInputs(prev => ({
            ...prev,
            [itemId]: { ...(prev[itemId] || initialFollowUpInputState), text }
        }));
    };

    const updateFollowUpSendToAll = (itemId: string, checked: boolean) => {
        setFollowUpInputs(prev => ({
            ...prev,
            [itemId]: { ...(prev[itemId] || initialFollowUpInputState), sendToAll: checked }
        }));
    };

    const handleFollowUpFileChange = async (itemId: string, event: React.ChangeEvent<HTMLInputElement>) => {
        const newFiles = Array.from(event.target.files || []);
        if (newFiles.length === 0) return;

        const currentInputState = followUpInputs[itemId] || initialFollowUpInputState;
        const updatedRawFiles = [...currentInputState.files, ...newFiles];

        const newPreviewsPromises = newFiles.map(async file => {
            const dataUrl = await new Promise<string>(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
            });
            try {
                const generativePart = await fileToGenerativePart(file);
                return { name: file.name, type: file.type, dataUrl, generativePart };
            } catch (e) {
                 console.error(`Error processing follow-up file ${file.name}:`, e);
                return { name: file.name, type: file.type, dataUrl };
            }
        });

        const resolvedNewPreviews = await Promise.all(newPreviewsPromises);
        setFollowUpInputs(prev => ({
            ...prev,
            [itemId]: {
                ...currentInputState,
                files: updatedRawFiles,
                filePreviews: [...currentInputState.filePreviews, ...resolvedNewPreviews]
            }
        }));
        
        event.target.value = "";
    };

    const handleRemoveFollowUpFile = (itemId: string, indexToRemove: number) => {
        setFollowUpInputs(prev => {
            const currentInput = prev[itemId] || initialFollowUpInputState;
            return {
                ...prev,
                [itemId]: {
                    ...currentInput,
                    files: currentInput.files.filter((_, i) => i !== indexToRemove),
                    filePreviews: currentInput.filePreviews.filter((_, i) => i !== indexToRemove),
                }
            };
        });
    };

    const handleStopGeneration = (itemId: string, turnId: string) => {
        if (!streamStopFlagsRef.current[itemId]) {
            streamStopFlagsRef.current[itemId] = {};
        }
        streamStopFlagsRef.current[itemId][turnId] = true;

        const updater = currentMode === 'multiModel' ? setMultiModelChatResults : setTestConfigResults;
        updater(prev => prev.map(r => {
            if (r.id === itemId) {
                return {
                    ...r,
                    conversationHistory: r.conversationHistory.map(turn => 
                        turn.id === turnId ? { ...turn, isLoading: false, stoppedByUser: true } : turn
                    )
                };
            }
            return r;
        }));
    };


    const generateContentParts = useCallback(async (text: string, currentFilePreviews: FilePreview[]): Promise<Part[]> => {
        const parts: Part[] = [];
        if (text.trim()) {
            parts.push({ text: text.trim() });
        }
        for (const preview of currentFilePreviews.filter(fp => fp.generativePart)) {
            parts.push(preview.generativePart!);
        }
        return parts;
    }, []);

    const handleModelSelectionChange = (modelId: string) => {
        setSelectedModels(prev =>
            prev.includes(modelId) ? prev.filter(id => id !== modelId) : [...prev, modelId]
        );
         if (!followUpInputs[modelId]) {
            setFollowUpInputs(prev => ({...prev, [modelId]: {...initialFollowUpInputState}}));
        }
    };
    
    const commonChatSendLogic = async (
        targetId: string, 
        chatSession: Chat,
        contentParts: Part[],
        promptText: string,
        promptFiles: FilePreview[],
        isFollowUp: boolean,
        updateResultsFunc: React.Dispatch<React.SetStateAction<ResultItem[]>>
    ) => {
        const userTurnId = `turn-${Date.now()}-user-${targetId}-${Math.random().toString(36).substring(7)}`;
        const modelTurnId = `turn-${Date.now()}-model-${targetId}-${Math.random().toString(36).substring(7)}`;

        const userHistoryItem: HistoryItem = {
            id: userTurnId,
            promptText: promptText,
            promptFiles: promptFiles.map(fp => ({ name: fp.name, type: fp.type, dataUrl: fp.dataUrl })),
            isFollowUp: isFollowUp,
            timestamp: Date.now(),
        };
        const modelHistoryItemInitial: HistoryItem = {
             id: modelTurnId, response: '', isLoading: true, isFollowUp, timestamp: Date.now() + 1, stoppedByUser: false
        };

        if (streamStopFlagsRef.current[targetId]) {
            delete streamStopFlagsRef.current[targetId][modelTurnId];
        }


        updateResultsFunc(prev => prev.map(r => r.id === targetId ? {
            ...r,
            isLoading: true, 
            error: undefined,
            conversationHistory: isFollowUp ? 
                [...r.conversationHistory, userHistoryItem, modelHistoryItemInitial]
                : [userHistoryItem, modelHistoryItemInitial]
        } : r));

        try {
            const stream = await chatSession.sendMessageStream({ message: contentParts });
            let accumulatedResponse = "";
            let accumulatedGroundingMetadata: GroundingChunk[] | undefined = undefined;

            for await (const chunk of stream) {
                if (streamStopFlagsRef.current[targetId]?.[modelTurnId]) {
                    updateResultsFunc(prev => prev.map(r => r.id === targetId ? {
                        ...r,
                        isLoading: false,
                        conversationHistory: r.conversationHistory.map(turn => turn.id === modelTurnId ? {
                            ...turn,
                            isLoading: false,
                            stoppedByUser: true,
                            response: accumulatedResponse || "Generation stopped by user." 
                        } : turn)
                    } : r));
                    break; 
                }

                accumulatedResponse += chunk.text;
                if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                    const newChunks = chunk.candidates[0].groundingMetadata.groundingChunks as GroundingChunk[];
                    accumulatedGroundingMetadata = [
                        ...(accumulatedGroundingMetadata || []),
                        ...newChunks
                    ].filter((v,i,a) => a.findIndex(t=>(t.web.uri === v.web.uri))===i); 
                }

                updateResultsFunc(prev => prev.map(r => r.id === targetId ? {
                    ...r,
                    conversationHistory: r.conversationHistory.map(turn => turn.id === modelTurnId ? {
                        ...turn,
                        response: accumulatedResponse,
                        groundingMetadata: accumulatedGroundingMetadata,
                        isLoading: true 
                    } : turn)
                } : r));
            }
            updateResultsFunc(prev => prev.map(r => r.id === targetId ? {
                ...r,
                isLoading: false, 
                conversationHistory: r.conversationHistory.map(turn => turn.id === modelTurnId ? {
                    ...turn,
                    isLoading: false, 
                } : turn)
            } : r));

        } catch (error: any) {
            console.error(`Stream error for ${targetId}:`, error);
            const errorMessage = error.message || 'Failed to get stream response';
            updateResultsFunc(prev => prev.map(r => r.id === targetId ? {
                ...r,
                isLoading: false,
                conversationHistory: r.conversationHistory.map(turn => turn.id === modelTurnId ? {
                    ...turn,
                    error: errorMessage,
                    isLoading: false
                } : turn)
            } : r));
        }
    };


    const handleMultiModelChatSend = async () => {
        if (!ai || !currentApiKey || selectedModels.length === 0 || (!userInputText.trim() && filePreviews.filter(fp => fp.generativePart).length === 0)) {
            if (!ai || !currentApiKey) {
                alert("API key is not configured. Please refresh the page and enter your API key.");
                return;
            }
            if (selectedModels.length === 0) alert("Please select at least one model.");
            return;
        }
    
        setGlobalLoading(true);
        const currentModelsToQuery = AVAILABLE_MODELS_FOR_SELECTION.filter(m => selectedModels.includes(m.id));
        const contentParts = await generateContentParts(userInputText, filePreviews);

        if (contentParts.length === 0) {
            alert("Cannot send an empty message (no text or processable files).");
            setGlobalLoading(false);
            return;
        }
        const initialUserPromptText = userInputText;
        const initialUserPromptFilesForHistory = filePreviews; 

        let chatCreationApiConfig: any = {};
        let resultItemConfigUpdate: ResultItemConfig;

        if (enableGoogleSearch) {
            chatCreationApiConfig.tools = [{ googleSearch: {} }];
            resultItemConfigUpdate = { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined };
        } else {
            if (systemInstruction.trim()) {
                chatCreationApiConfig.systemInstruction = systemInstruction.trim();
            }
            // For MultiModel initial chat, temp/topP are not set per model from UI, API defaults are used.
            // ResultItem.config will reflect this by storing general defaults or current systemInstruction.
            resultItemConfigUpdate = { 
                googleSearchEnabled: false, 
                temperature: 1.0, // Default display value
                topP: 0.95,      // Default display value
                systemInstruction: systemInstruction.trim() || undefined 
            };
        }
    
        const promises = currentModelsToQuery.map(model => {
            const chatSession = ai.chats.create({ model: model.id, config: chatCreationApiConfig });
            setMultiModelChatResults(prevResults =>
                prevResults.map(pr =>
                    pr.id === model.id
                        ? { ...pr, chatSession, config: resultItemConfigUpdate } 
                        : pr
                )
            );
             if (!followUpInputs[model.id]) {
                setFollowUpInputs(prev => ({...prev, [model.id]: {...initialFollowUpInputState}}));
            }
            return commonChatSendLogic(model.id, chatSession, contentParts, initialUserPromptText, initialUserPromptFilesForHistory, false, setMultiModelChatResults);
        });

        Promise.allSettled(promises).then(() => {
            setGlobalLoading(false);
            mainPromptTextareaRef.current?.focus();
        });
        
        setUserInputText('');
        setUploadedFiles([]);
        setFilePreviews([]);
    };
    
    const handleSendMultiModelFollowUp = async (originatingModelId: string, sendToAll: boolean, focusCallback?: () => void) => {
        const originatingFollowUpInput = followUpInputs[originatingModelId] || initialFollowUpInputState;
        if (!originatingFollowUpInput.text.trim() && originatingFollowUpInput.filePreviews.filter(fp => fp.generativePart).length === 0) return;

        const contentParts = await generateContentParts(originatingFollowUpInput.text, originatingFollowUpInput.filePreviews.filter(fp => fp.generativePart));
        if (contentParts.length === 0) {
             alert("Cannot send an empty follow-up (no text or processable files).");
             return;
        }
        const followUpPromptText = originatingFollowUpInput.text;
        const followUpPromptFilesForHistory = originatingFollowUpInput.filePreviews;

        const targetModelIds = sendToAll 
            ? selectedModels 
            : [originatingModelId];

        const promises = targetModelIds.map(async (modelId) => {
            const resultItem = multiModelChatResults.find(r => r.id === modelId);
            if (!resultItem || !resultItem.chatSession) {
                console.warn(`No chat session for model ${modelId}, skipping follow-up.`);
                setMultiModelChatResults(prev => prev.map(r => r.id === modelId ? {...r, isLoading: false, error: "Chat session not found for follow-up."} : r));
                return;
            }
            // Follow-ups use the existing chatSession, which retains its original creation config
            return commonChatSendLogic(modelId, resultItem.chatSession, contentParts, followUpPromptText, followUpPromptFilesForHistory, true, setMultiModelChatResults);
        });

        await Promise.allSettled(promises);
        setFollowUpInputs(prev => ({...prev, [originatingModelId]: {...initialFollowUpInputState}})); 
        focusCallback?.();
    };

    const addPipeline = () => {
        if (pipelines.length < MAX_PIPELINES) {
            const newPipelineId = `pipe-${Date.now()}`; 
            const newPipelines = [...pipelines, { id: newPipelineId, temperature: 1.0, topP: 0.95 }];
            setPipelines(newPipelines);
            
            const newResultItemId = `set-${pipelines.length}`; 
            const newPipelineConfig = newPipelines[newPipelines.length-1];
            setTestConfigResults(prev => [...prev, {
                id: newResultItemId,
                isLoading: false,
                conversationHistory: [],
                config: enableGoogleSearch
                    ? { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined }
                    : { 
                        googleSearchEnabled: false, 
                        temperature: newPipelineConfig.temperature, 
                        topP: newPipelineConfig.topP, 
                        systemInstruction: systemInstruction.trim() || undefined 
                      },
                chatSession: undefined
            }]);
             setFollowUpInputs(prev => ({...prev, [newResultItemId]: {...initialFollowUpInputState}})); 

            if (newPipelines.length === 1 && pipelines.length === 0) {
                 setActiveConfigTab('set-0');
            } else if (newPipelines.length > 0 && (activeConfigTab === '' || parseInt(activeConfigTab.split('-')[1]) >= newPipelines.length)) {
                 setActiveConfigTab(`set-${newPipelines.length -1}`);
            }
        }
    };

    const updatePipeline = (index: number, field: keyof Omit<Pipeline, 'id'>, value: string) => {
        const newPipelines = [...pipelines];
        let numValue = parseFloat(value);
        if (isNaN(numValue)) return;

        if (field === 'temperature') numValue = Math.max(0.0, Math.min(2.0, numValue));
        else if (field === 'topP') numValue = Math.max(0.0, Math.min(1.0, numValue));
        
        newPipelines[index][field] = numValue;
        setPipelines(newPipelines);

        const resultItemId = `set-${index}`;
        setTestConfigResults(prev => prev.map(r => {
            if (r.id === resultItemId) {
                return {
                    ...r,
                    config: enableGoogleSearch
                        ? { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined }
                        : { 
                            ...r.config, 
                            googleSearchEnabled: false,
                            temperature: newPipelines[index].temperature, 
                            topP: newPipelines[index].topP,
                            systemInstruction: systemInstruction.trim() || undefined
                          }
                };
            }
            return r;
        }));
    };
    
    useEffect(() => { // Update existing testConfigResults if global systemInstruction or googleSearch changes
        setTestConfigResults(prevResults => prevResults.map((r, index) => {
            const pipeline = pipelines[index]; // Assuming pipeline order matches result order
            if (!pipeline) return r; // Should not happen if lengths are synced

            return {
                ...r,
                config: enableGoogleSearch
                    ? { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined }
                    : {
                        googleSearchEnabled: false,
                        temperature: pipeline.temperature,
                        topP: pipeline.topP,
                        systemInstruction: systemInstruction.trim() || undefined
                      }
            };
        }));
    }, [systemInstruction, enableGoogleSearch, pipelines]);


    const removePipeline = (indexToRemove: number) => {
        const resultItemIdToRemove = `set-${indexToRemove}`;
        setPipelines(prev => prev.filter((_, i) => i !== indexToRemove));
        setTestConfigResults(prev => prev.filter(r => r.id !== resultItemIdToRemove)
            .map((r, newIndex) => ({ ...r, id: `set-${newIndex}` }))); 

        setFollowUpInputs(prev => { 
            const copy = {...prev};
            delete copy[resultItemIdToRemove];
            const rekeyedFollowUps: Record<string, FollowUpInputState> = {};
            Object.entries(copy).forEach(([key, value]) => {
                if (key.startsWith('set-')) {
                    const oldIndex = parseInt(key.split('-')[1]);
                    if (oldIndex > indexToRemove) {
                        rekeyedFollowUps[`set-${oldIndex - 1}`] = value;
                    } else if (oldIndex < indexToRemove) {
                        rekeyedFollowUps[key] = value;
                    }
                } else {
                    rekeyedFollowUps[key] = value; 
                }
            });
            return rekeyedFollowUps;
        });

        const currentActiveIndex = parseInt(activeConfigTab.split('-')[1] || "0", 10);
        if (pipelines.length -1 === 0) { 
            setActiveConfigTab('');
        } else if (indexToRemove === currentActiveIndex) {
            setActiveConfigTab('set-0'); 
        } else if (indexToRemove < currentActiveIndex) {
            setActiveConfigTab(`set-${currentActiveIndex - 1}`); 
        }
    };
    

    const handleTestConfigSend = async () => {
        if (!ai || !currentApiKey || pipelines.length === 0 || (!userInputText.trim() && filePreviews.filter(fp => fp.generativePart).length === 0)) {
            if (!ai || !currentApiKey) {
                alert("API key is not configured. Please refresh the page and enter your API key.");
                return;
            }
            if (pipelines.length === 0) alert("Please add at least one pipeline configuration.");
            return;
        }

        setGlobalLoading(true);
        const contentParts = await generateContentParts(userInputText, filePreviews);
        if (contentParts.length === 0) {
            alert("Cannot send an empty message (no text or processable files).");
            setGlobalLoading(false);
            return;
        }
        
        const initialUserPromptText = userInputText;
        const initialUserPromptFilesForHistory = filePreviews;

        const promises = pipelines.map((pipeline, index) => {
            const resultItemId = `set-${index}`;
            let chatCreationApiConfig: any = {};
            let resultItemConfigUpdate: ResultItemConfig;

            if (enableGoogleSearch) {
                chatCreationApiConfig.tools = [{ googleSearch: {} }];
                resultItemConfigUpdate = { googleSearchEnabled: true, temperature: undefined, topP: undefined, systemInstruction: undefined };
            } else {
                chatCreationApiConfig.temperature = pipeline.temperature;
                chatCreationApiConfig.topP = pipeline.topP;
                if (systemInstruction.trim()) {
                    chatCreationApiConfig.systemInstruction = systemInstruction.trim();
                }
                resultItemConfigUpdate = {
                    googleSearchEnabled: false,
                    temperature: pipeline.temperature,
                    topP: pipeline.topP,
                    systemInstruction: systemInstruction.trim() || undefined
                };
            }

            const chatSession = ai.chats.create({ 
                model: configTesterSelectedModelId, 
                config: chatCreationApiConfig
            });

            setTestConfigResults(prevResults =>
                prevResults.map(pr =>
                    pr.id === resultItemId
                        ? { ...pr, chatSession, config: resultItemConfigUpdate } 
                        : pr
                )
            );
             if (!followUpInputs[resultItemId]) {
                setFollowUpInputs(prev => ({...prev, [resultItemId]: {...initialFollowUpInputState}}));
            }

            return commonChatSendLogic(resultItemId, chatSession, contentParts, initialUserPromptText, initialUserPromptFilesForHistory, false, setTestConfigResults);
        });
        
        Promise.allSettled(promises).then(() => {
            setGlobalLoading(false);
            mainPromptTextareaRef.current?.focus();
        });

        setUserInputText('');
        setUploadedFiles([]);
        setFilePreviews([]);
    };

    const handleSendTestConfigFollowUp = async (originatingPipelineId: string, sendToAll: boolean, focusCallback?: () => void) => { 
        const originatingFollowUpInput = followUpInputs[originatingPipelineId] || initialFollowUpInputState;

        if (!originatingFollowUpInput.text.trim() && originatingFollowUpInput.filePreviews.filter(fp => fp.generativePart).length === 0) return;

        const contentParts = await generateContentParts(originatingFollowUpInput.text, originatingFollowUpInput.filePreviews.filter(fp => fp.generativePart));
        if (contentParts.length === 0) {
             alert("Cannot send an empty follow-up (no text or processable files).");
             return;
        }
        const followUpPromptText = originatingFollowUpInput.text;
        const followUpPromptFilesForHistory = originatingFollowUpInput.filePreviews;

        const targetPipelineIds = sendToAll 
            ? testConfigResults.map(r => r.id) 
            : [originatingPipelineId];
        
        const promises = targetPipelineIds.map(async (pipelineId) => {
            const resultItem = testConfigResults.find(r => r.id === pipelineId);
             if (!resultItem || !resultItem.chatSession) {
                console.warn(`No chat session for pipeline ${pipelineId}, skipping follow-up.`);
                setTestConfigResults(prev => prev.map(r => r.id === pipelineId ? {...r, isLoading: false, error: "Chat session not found for follow-up."} : r));
                return;
            }
            // Follow-ups use the existing chatSession, which retains its original creation config
            return commonChatSendLogic(pipelineId, resultItem.chatSession, contentParts, followUpPromptText, followUpPromptFilesForHistory, true, setTestConfigResults);
        });
        
        await Promise.allSettled(promises);
        setFollowUpInputs(prev => ({...prev, [originatingPipelineId]: {...initialFollowUpInputState}})); 
        focusCallback?.();
    };

    const handleImageGenerationSend = async () => {
        if (!ai || !currentApiKey) {
            alert("API key is not configured. Please refresh the page and enter your API key.");
            return;
        }
        if (!userInputText.trim() && uploadedFiles.length === 0) {
            alert("Please enter a prompt or attach a reference image for image generation.");
            return;
        }

        setGlobalLoading(true);
        const requestId = `imgreq-${Date.now()}`;
        let referenceImagePreviewUrl: string | undefined = undefined;
        let autoGeneratedDescription: string | undefined = undefined;
        let finalImagePrompt = userInputText;

        const baseRequest: Omit<ImageGenRequest, 'images' | 'error'> = {
            id: requestId,
            prompt: userInputText,
            numImages: numImagesToGenerate,
            isLoading: true,
            timestamp: Date.now(),
            statusMessage: "Preparing request..."
        };
        setImageGenRequests(prev => [{...baseRequest, images: [], error: undefined}, ...prev]);

        const updateRequestStatus = (statusMessage: string, error?: string) => {
            setImageGenRequests(prev => prev.map(req => 
                req.id === requestId ? { ...req, statusMessage, error, isLoading: error ? false : req.isLoading } : req
            ));
        };

        try {
            if (uploadedFiles.length > 0 && filePreviews.length > 0 && filePreviews[0].generativePart) {
                const referenceFilePreview = filePreviews[0];
                referenceImagePreviewUrl = referenceFilePreview.dataUrl;
                updateRequestStatus("Analyzing reference image...");

                const imageAnalysisPromptText = "Describe this image in detail for an image generation model. Focus on its key elements, style, color palette, and composition. The description should be suitable to guide the creation of a similar or related image.";
                const descriptionParts: Part[] = [referenceFilePreview.generativePart, { text: imageAnalysisPromptText }];
                
                try {
                    const descriptionResponse: GenerateContentResponse = await ai.models.generateContent({
                        model: DEFAULT_TEXT_MODEL_ID, // Use the default text model for description
                        contents: { parts: descriptionParts },
                    });
                    autoGeneratedDescription = descriptionResponse.text;
                    if (autoGeneratedDescription) {
                        finalImagePrompt = `${autoGeneratedDescription}\n\n${userInputText.trim() ? userInputText.trim() : "(No additional prompt)"}`;
                    } else {
                         throw new Error("Failed to generate description from reference image.");
                    }
                } catch (descError: any) {
                    console.error("Reference image description error:", descError);
                    updateRequestStatus("Error analyzing reference image. Proceeding with text prompt only.", descError.message);
                    finalImagePrompt = userInputText; 
                    autoGeneratedDescription = `Error: Could not generate description. (${descError.message})`;
                }
            }
            
            if (!finalImagePrompt.trim()) {
                 throw new Error("Cannot generate image without a text prompt (either typed or generated from reference image).");
            }

            updateRequestStatus("Generating images...");
            const response: GenerateImagesResponse = await ai.models.generateImages({
                model: DEFAULT_IMAGE_MODEL_ID,
                prompt: finalImagePrompt,
                config: { numberOfImages: numImagesToGenerate, outputMimeType: 'image/jpeg' },
            });
            
            const generatedImages = response.generatedImages.map(img => ({
                base64Bytes: img.image.imageBytes,
                dataUrl: `data:image/jpeg;base64,${img.image.imageBytes}`
            }));

            setImageGenRequests(prev => prev.map(req => 
                req.id === requestId ? { 
                    ...req, 
                    isLoading: false, 
                    images: generatedImages, 
                    referenceImagePreviewUrl, 
                    autoGeneratedDescription,
                    prompt: userInputText, 
                    statusMessage: "Completed" 
                } : req
            ));
        } catch (error: any) {
            console.error("Image generation error:", error);
            setImageGenRequests(prev => prev.map(req => 
                req.id === requestId ? { 
                    ...req, 
                    isLoading: false, 
                    error: error.message || "Failed to generate images",
                    referenceImagePreviewUrl, 
                    autoGeneratedDescription,
                    prompt: userInputText,
                    statusMessage: "Error"
                } : req
            ));
        } finally {
            setGlobalLoading(false);
            setUploadedFiles([]);
            setFilePreviews([]);
            mainPromptTextareaRef.current?.focus();
        }
    };

    const handleSaveTemplate = () => {
        if (!newTemplateName.trim()) {
            alert("Please enter a name for the template.");
            return;
        }
        if (!userInputText.trim() && !systemInstruction.trim()) {
            alert("Cannot save an empty template (no prompt text or system instruction).");
            return;
        }
        const newTemplate: PromptTemplate = {
            id: `template-${Date.now()}`,
            name: newTemplateName.trim(),
            promptText: userInputText,
            systemInstruction: systemInstruction,
        };
        setPromptTemplates(prev => [newTemplate, ...prev]);
        setNewTemplateName('');
    };

    const handleLoadTemplate = (template: PromptTemplate) => {
        setUserInputText(template.promptText);
        setSystemInstruction(template.systemInstruction || '');
        mainPromptTextareaRef.current?.focus();
    };

    const handleDeleteTemplate = (templateId: string) => {
        setPromptTemplates(prev => prev.filter(t => t.id !== templateId));
    };

    useEffect(() => {
        if (currentMode !== 'multiModel' && currentMode !== 'testConfig' && currentMode !== 'imageGen') {
            setUploadedFiles([]);
            setFilePreviews([]);
        }
         // Reset files when switching away from imageGen mode, or to imageGen mode if more than one file was previously selected
        if (currentMode === 'imageGen' && uploadedFiles.length > 1) {
            setUploadedFiles([]);
            setFilePreviews([]);
        } else if (currentMode !== 'imageGen' && currentMode !== 'multiModel' && currentMode !== 'testConfig') {
            setUploadedFiles([]);
            setFilePreviews([]);
        }
    }, [currentMode, uploadedFiles.length]);


    if (isAppLoading) {
        return null; 
    }

    // Show API key modal if needed
    if (showApiKeyModal) {
        return <ApiKeyEntryModal onApiKeySet={handleApiKeySet} />;
    }

    // Show loading state
    if (isAppLoading) {
        return null;
    }
    
    const isFileRelevantForCurrentMode = 
        (currentMode === 'multiModel' || currentMode === 'testConfig' || currentMode === 'imageGen');

    const mainSendButtonDisabled = globalLoading || 
        (currentMode === 'multiModel' && (selectedModels.length === 0 || (!userInputText.trim() && filePreviews.filter(fp => fp.generativePart).length === 0))) ||
        (currentMode === 'testConfig' && (pipelines.length === 0 || (!userInputText.trim() && filePreviews.filter(fp => fp.generativePart).length === 0))) ||
        (currentMode === 'imageGen' && (!userInputText.trim() && uploadedFiles.length === 0));


    const mainSendButtonText = () => {
        if (globalLoading) return 'Processing...';
        if (currentMode === 'multiModel') return selectedModels.length > 0 ? `Send to ${selectedModels.length} Model Instance(s)` : 'Select a Model Instance';
        if (currentMode === 'testConfig') return 'Test Configurations';
        if (currentMode === 'imageGen') return 'Generate Images';
        return 'Send';
    };

    const handleMainSendAction = () => {
        if (currentMode === 'multiModel') handleMultiModelChatSend();
        else if (currentMode === 'testConfig') handleTestConfigSend();
        else if (currentMode === 'imageGen') handleImageGenerationSend();
    };


    return (
        <>
            <main>
                <div className="left-column-container">
                    <div className="mode-switcher" role="tablist" aria-label="Application Mode">
                        <button
                            role="tab"
                            aria-selected={currentMode === 'multiModel'}
                            onClick={() => setCurrentMode('multiModel')}
                            className={`mode-switch-button ${currentMode === 'multiModel' ? 'active' : ''}`}
                        >
                            Multi-Instance Chat
                        </button>
                        <button
                            role="tab"
                            aria-selected={currentMode === 'testConfig'}
                            onClick={() => setCurrentMode('testConfig')}
                            className={`mode-switch-button ${currentMode === 'testConfig' ? 'active' : ''}`}
                        >
                            Configuration Tester
                        </button>
                        <button
                            role="tab"
                            aria-selected={currentMode === 'imageGen'}
                            onClick={() => setCurrentMode('imageGen')}
                            className={`mode-switch-button ${currentMode === 'imageGen' ? 'active' : ''}`}
                        >
                            Image Generation
                        </button>
                    </div>

                    <section className={`section input-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.1s'}}>
                        <div className="section-title-header">
                            <h2 className="section-title">Compose Prompt</h2>
                            <button
                                onClick={handleResetApiKey}
                                className="action-button danger-action-button small-action-button"
                                title="Change API Key"
                                aria-label="Change API Key"
                            >
                                Change API Key
                            </button>
                        </div>
                        <div className="control-group">
                            <label htmlFor="prompt-textarea-input">Your Message{currentMode === 'imageGen' ? ' (Image Prompt)' : ''}:</label>
                            <textarea
                                id="prompt-textarea-input"
                                ref={mainPromptTextareaRef}
                                className="text-input prompt-textarea"
                                value={userInputText}
                                onChange={(e) => setUserInputText(e.target.value)}
                                placeholder={currentMode === 'imageGen' ? "Describe the image you want to generate, or add to reference image's description..." : "Type your message, or describe the content context..."}
                                aria-label="Message input"
                                rows={currentMode === 'imageGen' ? 3 : 5}
                            />
                        </div>
                        
                        {isFileRelevantForCurrentMode && (
                            <div className="control-group">
                                <label htmlFor="main-file-upload-input">
                                    {currentMode === 'imageGen' ? 'Attach Reference Image (Optional, 1 image):' : 'Upload Files (for initial prompt):'}
                                </label>
                                <div className="file-input-wrapper">
                                    <span className="file-input-display" onClick={() => mainFileInputRef.current?.click()}>
                                        {uploadedFiles.length > 0 ? 
                                            `${uploadedFiles.length} file(s) selected. ${currentMode === 'imageGen' ? 'Click to change.' : 'Click to add more or drop here.'}` 
                                            : (currentMode === 'imageGen' ? "Click to select or drop a reference image" : "Click to select or drop files here")}
                                    </span>
                                    <input
                                        id="main-file-upload-input"
                                        type="file"
                                        multiple={currentMode !== 'imageGen'}
                                        accept={currentMode === 'imageGen' ? "image/*" : "*"} 
                                        onChange={handleMainFileChange}
                                        aria-label={currentMode === 'imageGen' ? "Upload reference image" : "Upload files for initial prompt"}
                                        ref={mainFileInputRef}
                                        style={{ display: 'none'}}
                                    />
                                </div>
                                {currentMode === 'imageGen' && filePreviews.length === 0 &&
                                    <p className="file-input-hint">If an image is attached, its AI-generated description will be combined with your text prompt.</p>
                                }
                            </div>
                        )}
                        {isFileRelevantForCurrentMode && filePreviews.length > 0 && 
                            <FilePreviewDisplay 
                                files={filePreviews} 
                                onRemoveFile={handleRemoveMainFile}
                                onImageClick={setLightboxImageSrc}
                            />}


                        {currentMode !== 'imageGen' && (
                            <>
                                <div className="control-group">
                                    <label htmlFor="system-instruction-input">System Instruction (Optional, applies to all text models unless Google Search is enabled):</label>
                                    <textarea
                                        id="system-instruction-input"
                                        className="text-input"
                                        value={systemInstruction}
                                        onChange={(e) => setSystemInstruction(e.target.value)}
                                        placeholder="e.g., You are a helpful assistant."
                                        aria-label="System instruction input"
                                        rows={3}
                                        disabled={enableGoogleSearch}
                                    />
                                     {enableGoogleSearch && <p className="file-input-hint" style={{color: 'var(--accent-yellow)'}}>System instruction is disabled when Google Search is active.</p>}
                                </div>

                                <div className="custom-checkbox-container" onClick={() => setEnableGoogleSearch(!enableGoogleSearch)} style={{padding: '0.5rem 0'}}>
                                    <input
                                        type="checkbox"
                                        id="google-search-checkbox"
                                        checked={enableGoogleSearch}
                                        onChange={() => {/* Handled by div click */}}
                                        aria-labelledby="google-search-label"
                                    />
                                    <span className="checkmark" aria-hidden="true"></span>
                                    <label htmlFor="google-search-checkbox" id="google-search-label">Enable Google Search Grounding</label>
                                </div>
                            </>
                        )}
                        
                        <button
                            onClick={handleMainSendAction}
                            disabled={mainSendButtonDisabled}
                            aria-label={mainSendButtonText()}
                            className="action-button primary-action-button"
                        >
                            {mainSendButtonText()}
                        </button>
                    </section>
                    
                    {currentMode === 'multiModel' && (
                        <section className={`section multimodel-settings-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.12s'}}>
                            <div className="section-title-header">
                                <h2 className="section-title">Multi-Instance Settings</h2>
                                <button
                                    onClick={() => setIsMultiModelSettingsCollapsed(!isMultiModelSettingsCollapsed)}
                                    className="toggle-section-button"
                                    aria-expanded={!isMultiModelSettingsCollapsed}
                                    aria-controls="multi-model-settings-content-left"
                                >
                                    {isMultiModelSettingsCollapsed ? 'Show Settings' : 'Hide Settings'}
                                </button>
                            </div>
                            
                            <div id="multi-model-settings-content-left" hidden={isMultiModelSettingsCollapsed}>
                                <div className="control-group">
                                    <h3 className="section-subtitle">Select Model Instance for Parallel Chat</h3>
                                    <div className="checkbox-list" role="group" aria-label="Select model instances">
                                        {AVAILABLE_MODELS_FOR_SELECTION.map(model => (
                                            <div key={model.id} className="custom-checkbox-container" onClick={() => handleModelSelectionChange(model.id)}>
                                                <input
                                                    type="checkbox"
                                                    id={`model-checkbox-${model.id}`}
                                                    checked={selectedModels.includes(model.id)}
                                                    onChange={() => {/* Handled by div click */}}
                                                    aria-labelledby={`model-label-${model.id}`}
                                                />
                                                <span className="checkmark" aria-hidden="true"></span>
                                                <label htmlFor={`model-checkbox-${model.id}`} id={`model-label-${model.id}`}>{model.name}</label>
                                            </div>
                                        ))}
                                    </div>
                                    {AVAILABLE_MODELS_FOR_SELECTION.length === 0 && <p style={{color: "var(--text-secondary-color)"}}>No text models available for selection.</p>}
                                     {AVAILABLE_MODELS_FOR_SELECTION.length === 1 && <p className="file-input-hint" style={{marginTop: '0.5rem'}}>You can chat with multiple instances of the same model type simultaneously by ensuring it's selected.</p>}
                                </div>
                            </div>
                        </section>
                    )}

                    {currentMode === 'testConfig' && (
                         <section className={`section configtester-settings-left-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.12s'}}>
                            <div className="section-title-header">
                                <h2 className="section-title">Configuration Settings</h2>
                                <button
                                    onClick={() => setIsConfigTesterSettingsCollapsed(!isConfigTesterSettingsCollapsed)}
                                    className="toggle-section-button"
                                    aria-expanded={!isConfigTesterSettingsCollapsed}
                                    aria-controls="config-tester-settings-content-left"
                                >
                                    {isConfigTesterSettingsCollapsed ? 'Show Settings' : 'Hide Settings'}
                                </button>
                            </div>
                            
                            <div id="config-tester-settings-content-left" hidden={isConfigTesterSettingsCollapsed}>
                                <div className="control-group">
                                    <label htmlFor="config-model-select" className="section-subtitle" style={{borderBottom:'none', paddingBottom:0, marginBottom:'0.5rem'}}>Base Model for Testing:</label>
                                    <select
                                        id="config-model-select"
                                        className="styled-select"
                                        value={configTesterSelectedModelId}
                                        onChange={(e) => setConfigTesterSelectedModelId(e.target.value)}
                                        aria-label="Select base model for configuration testing"
                                        disabled={AVAILABLE_MODELS_FOR_SELECTION.length <=1}
                                    >
                                        {AVAILABLE_MODELS_FOR_SELECTION.map(model => (
                                            <option key={model.id} value={model.id}>
                                                {model.name}
                                            </option>
                                        ))}
                                    </select>
                                    {AVAILABLE_MODELS_FOR_SELECTION.length === 1 && <p className="file-input-hint" style={{marginTop: '0.5rem'}}>Using {AVAILABLE_MODELS_FOR_SELECTION[0].name} as the base model.</p>}
                                </div>

                                <div className="pipeline-configuration-group">
                                    <h3 className="section-subtitle">Configure Test Pipelines (Max {MAX_PIPELINES})</h3>
                                    {pipelines.map((pipeline, index) => (
                                        <div key={pipeline.id} className="pipeline-item">
                                            <span className="pipeline-set-number">Set {index + 1}:</span>
                                            <div className="control-group slider-control-group">
                                                <label htmlFor={`temp-slider-${index}`}>Temp: <span className="slider-value">{pipeline.temperature.toFixed(1)}</span></label>
                                                <input
                                                    type="range" id={`temp-slider-${index}`} className="styled-slider temp-slider"
                                                    value={pipeline.temperature} onChange={(e) => updatePipeline(index, 'temperature', e.target.value)}
                                                    min="0.0" max="2.0" step="0.1" aria-label={`Temperature for Set ${index + 1}`}
                                                    disabled={enableGoogleSearch}
                                                />
                                            </div>
                                            <div className="control-group slider-control-group">
                                                <label htmlFor={`topP-slider-${index}`}>Top P: <span className="slider-value">{pipeline.topP.toFixed(2)}</span></label>
                                                <input
                                                    type="range" id={`topP-slider-${index}`} className="styled-slider topP-slider"
                                                    value={pipeline.topP} onChange={(e) => updatePipeline(index, 'topP', e.target.value)}
                                                    min="0.0" max="1.0" step="0.01" aria-label={`Top P for Set ${index + 1}`}
                                                    disabled={enableGoogleSearch}
                                                />
                                            </div>
                                            <button onClick={() => removePipeline(index)} aria-label={`Remove Set ${index + 1}`} className="action-button danger-action-button">Remove</button>
                                             {enableGoogleSearch && <p className="file-input-hint" style={{color: 'var(--accent-yellow)', width: '100%', marginTop: '0.5rem'}}>Temperature and TopP settings are disabled when Google Search is active.</p>}
                                        </div>
                                    ))}
                                    {pipelines.length < MAX_PIPELINES && (
                                        <button onClick={addPipeline} className="action-button success-action-button">Add Pipeline</button>
                                    )}
                                     {pipelines.length === 0 && <p style={{color: "var(--text-secondary-color)", textAlign:'center'}}>Add a pipeline to start testing configurations. The "Test Configurations" button will appear in the "Compose Prompt" panel once a pipeline is added.</p>}
                                </div>
                            </div>
                        </section>
                    )}


                    <section className={`section prompt-templates-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.15s'}}>
                        <h2 className="section-title">Prompt Templates</h2>
                        <div className="control-group">
                            <label htmlFor="template-name-input">Template Name:</label>
                            <input 
                                type="text" 
                                id="template-name-input" 
                                className="text-input"
                                value={newTemplateName}
                                onChange={(e) => setNewTemplateName(e.target.value)}
                                placeholder="Enter name for new template"
                            />
                        </div>
                        <button onClick={handleSaveTemplate} className="action-button" aria-label="Save current prompt and system instruction as a new template">
                            Save Current as Template
                        </button>
                        {promptTemplates.length > 0 && (
                            <div className="templates-list">
                                <h3 className="section-subtitle" style={{marginTop:'1.5rem', marginBottom:'0.5rem'}}>Saved Templates</h3>
                                {promptTemplates.map(template => (
                                    <div key={template.id} className="template-item">
                                        <span className="template-name">{template.name}</span>
                                        <div className="template-actions">
                                            <button onClick={() => handleLoadTemplate(template)} className="action-button small-action-button" aria-label={`Load template ${template.name}`}>Load</button>
                                            <button onClick={() => handleDeleteTemplate(template.id)} className="action-button danger-action-button small-action-button" aria-label={`Delete template ${template.name}`}>Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                         {promptTemplates.length === 0 && <p style={{color: "var(--text-secondary-color)", marginTop:'1rem', textAlign:'center'}}>No templates saved yet.</p>}
                    </section>
                </div>

                <div className="right-column-container">
                    {currentMode === 'multiModel' && (
                        <section className={`section multimodel-chat-area-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.2s'}} id="multimodel-chat-panel" role="region" aria-labelledby="multimodel-chat-area-title">
                            <h2 className="section-title" id="multimodel-chat-area-title">Model Conversations</h2>
                            {selectedModels.length > 0 ? (
                                <>
                                    <nav className="tabs-nav" role="tablist" aria-label="Model Conversation Tabs">
                                        {AVAILABLE_MODELS_FOR_SELECTION
                                            .filter(m => selectedModels.includes(m.id))
                                            .map(model => (
                                            <button
                                                key={model.id}
                                                role="tab"
                                                aria-selected={activeMultiModelChatTab === model.id}
                                                aria-controls={`model-content-${model.id}`}
                                                id={`model-tab-${model.id}`}
                                                onClick={() => setActiveMultiModelChatTab(model.id)}
                                                className={`tab-nav-button ${activeMultiModelChatTab === model.id ? 'active' : ''}`}
                                            >
                                                {model.name} {selectedModels.length > 1 ? `(Instance ${selectedModels.indexOf(model.id) + 1})` : ''}
                                            </button>
                                        ))}
                                    </nav>
                                    {AVAILABLE_MODELS_FOR_SELECTION
                                        .filter(m => selectedModels.includes(m.id))
                                        .map(model => {
                                            const resultItem = multiModelChatResults.find(r => r.id === model.id);
                                            if (!resultItem) return null;
                                            const currentFollowUp = followUpInputs[resultItem.id] || initialFollowUpInputState;
                                            return (
                                                <div
                                                    key={model.id}
                                                    id={`model-content-${model.id}`}
                                                    role="tabpanel"
                                                    aria-labelledby={`model-tab-${model.id}`}
                                                    className="tab-content-panel"
                                                    hidden={activeMultiModelChatTab !== model.id}
                                                >
                                                    <ResultCard
                                                        itemId={resultItem.id}
                                                        title={`${resultItem.modelName || model.name}`}
                                                        item={resultItem}
                                                        followUpInput={currentFollowUp}
                                                        onFollowUpInputTextChange={(text) => updateFollowUpInputText(resultItem.id, text)}
                                                        onFollowUpFileChange={(e) => handleFollowUpFileChange(resultItem.id, e)}
                                                        onRemoveFollowUpFile={(index) => handleRemoveFollowUpFile(resultItem.id, index)}
                                                        onSendFollowUp={(sendToAll, focusCallback) => handleSendMultiModelFollowUp(resultItem.id, sendToAll, focusCallback)}
                                                        isSendToAllVisible={selectedModels.length > 1} 
                                                        sendToAllChecked={currentFollowUp.sendToAll}
                                                        onSendToAllChange={(checked) => updateFollowUpSendToAll(resultItem.id, checked)}
                                                        onStopGeneration={handleStopGeneration}
                                                        streamStopFlagsRef={streamStopFlagsRef}
                                                        onImagePreviewClick={setLightboxImageSrc}
                                                    />
                                                </div>
                                            );
                                    })}
                                </>
                            ) : (!globalLoading && <p style={{color: "var(--text-secondary-color)", textAlign: 'center', marginTop: '1rem'}}>Please select model instances from the "Multi-Instance Settings" in the left panel to start chatting.</p>)}
                        </section>
                    )}

                    {currentMode === 'testConfig' && (
                        <section className={`section configtester-results-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.2s', paddingTop: '1rem' }} id="testconfig-results-panel" role="region" aria-label="Configuration Test Results Area">
                            
                            {(pipelines.length > 0 && (testConfigResults.length > 0 || globalLoading)) ? (
                                <>
                                    <nav className="tabs-nav" role="tablist" aria-label="Configuration Test Set Responses Tabs" style={{marginTop: '0rem', marginBottom: '1.5rem'}}>
                                        {pipelines.map((_, index) => (
                                            <button
                                                key={`set-tab-${index}`} role="tab"
                                                aria-selected={activeConfigTab === `set-${index}`}
                                                aria-controls={`set-content-${index}`} id={`set-tab-button-${index}`}
                                                onClick={() => setActiveConfigTab(`set-${index}`)}
                                                className={`tab-nav-button ${activeConfigTab === `set-${index}` ? 'active' : ''}`}
                                            >
                                                Set {index + 1}
                                            </button>
                                        ))}
                                    </nav>
                                    {pipelines.map((pipeline, index) => {
                                        const resultItem = testConfigResults.find(r => r.id === `set-${index}`);
                                        if (!resultItem) return null; 
                                        const currentFollowUp = followUpInputs[resultItem.id] || initialFollowUpInputState;
                                        return (
                                        <div
                                            key={`set-content-wrapper-${index}`} id={`set-content-${index}`} role="tabpanel"
                                            aria-labelledby={`set-tab-button-${index}`} className="tab-content-panel"
                                            hidden={activeConfigTab !== `set-${index}`}
                                        >
                                             <ResultCard
                                                itemId={resultItem.id}
                                                title={`Response for Set ${index + 1} (Model: ${AVAILABLE_MODELS_FOR_SELECTION.find(m => m.id === configTesterSelectedModelId)?.name || configTesterSelectedModelId})`}
                                                item={resultItem}
                                                followUpInput={currentFollowUp}
                                                onFollowUpInputTextChange={(text) => updateFollowUpInputText(resultItem.id, text)}
                                                onFollowUpFileChange={(e) => handleFollowUpFileChange(resultItem.id, e)}
                                                onRemoveFollowUpFile={(fileIdx) => handleRemoveFollowUpFile(resultItem.id, fileIdx)}
                                                onSendFollowUp={(sendToAll, focusCallback) => handleSendTestConfigFollowUp(resultItem.id, sendToAll, focusCallback)}
                                                isSendToAllVisible={pipelines.length > 1}
                                                sendToAllChecked={currentFollowUp.sendToAll}
                                                onSendToAllChange={(checked) => updateFollowUpSendToAll(resultItem.id, checked)}
                                                onStopGeneration={handleStopGeneration}
                                                streamStopFlagsRef={streamStopFlagsRef}
                                                onImagePreviewClick={setLightboxImageSrc}
                                            />
                                        </div>
                                    )})}
                                </>
                            ) : (
                                // This block handles the empty states more cleanly
                                globalLoading ? <LoadingSpinner /> : (
                                    pipelines.length === 0 ? (
                                        <p style={{color: "var(--text-secondary-color)", textAlign: 'center', marginTop: '1rem'}}>
                                            Please add and configure test pipelines in the "Configuration Settings" on the left.
                                        </p>
                                    ) : ( // pipelines.length > 0 but no results and not loading
                                         testConfigResults.every(r => r.conversationHistory.length === 0) && !userInputText && filePreviews.length === 0 &&
                                        <p style={{color: "var(--text-secondary-color)", textAlign: 'center', marginTop: '1rem'}}>
                                            Compose a prompt and click "Test Configurations" in the left panel.
                                        </p>
                                    )
                                )
                            )}
                        </section>
                    )}

                    {currentMode === 'imageGen' && (
                         <section className={`section imagegen-section ${isContentVisible ? 'is-visible' : ''}`} style={{transitionDelay: '0.2s'}} id="imagegen-panel" role="region" aria-labelledby="imagegen-title">
                            <h2 className="section-title" id="imagegen-title">Image Generation Results</h2>
                            <div className="control-group">
                                <label htmlFor="num-images-select">Number of Images (1-{MAX_IMAGES_PER_REQUEST}): <span className="slider-value">{numImagesToGenerate}</span></label>
                                <input
                                    type="range"
                                    id="num-images-select"
                                    className="styled-slider"
                                    value={numImagesToGenerate}
                                    onChange={(e) => setNumImagesToGenerate(parseInt(e.target.value))}
                                    min="1" max={MAX_IMAGES_PER_REQUEST} step="1"
                                    aria-label="Number of images to generate"
                                />
                            </div>
                            {imageGenRequests.find(req => req.isLoading && !req.error) && <LoadingSpinner />}
                            
                            {imageGenRequests.length === 0 && !globalLoading && (
                                <p style={{color: "var(--text-secondary-color)", textAlign: 'center', marginTop: '1rem'}}>
                                    Enter a prompt in the left panel and click "Generate Images". You can also optionally attach a reference image.
                                </p>
                            )}

                            <div className="image-results-container">
                                {imageGenRequests.map(req => (
                                    <div key={req.id} className="image-request-item">
                                        <div className="image-request-details">
                                            {req.referenceImagePreviewUrl && (
                                                <div className="reference-image-display">
                                                    <strong>Reference Image:</strong>
                                                    <img 
                                                        src={req.referenceImagePreviewUrl} 
                                                        alt="User provided reference" 
                                                        onClick={() => setLightboxImageSrc(req.referenceImagePreviewUrl!)}
                                                        style={{cursor: 'pointer'}}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxImageSrc(req.referenceImagePreviewUrl!); } }}
                                                        aria-label="View larger reference image"
                                                    />
                                                </div>
                                            )}
                                            <div className="prompt-details">
                                                <h3 className="section-subtitle image-prompt-title">Your Text Prompt:</h3>
                                                <p className="user-text-prompt">"{req.prompt || '(No text prompt provided)'}"</p>
                                                {req.autoGeneratedDescription && (
                                                    <>
                                                        <h3 className="section-subtitle image-prompt-title" style={{marginTop:'0.5rem'}}>AI Generated Description from Reference:</h3>
                                                        <p className="ai-generated-description">"{req.autoGeneratedDescription}"</p>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <p className="timestamp">Requested: {new Date(req.timestamp).toLocaleTimeString()} 
                                            {req.statusMessage && <span> | Status: <em className={req.error ? 'status-error' : (req.isLoading ? 'status-loading' : 'status-completed')}>{req.statusMessage}</em></span>}
                                        </p>
                                        {req.isLoading && !req.error && <LoadingSpinner small />}
                                        {req.error && <div className="error-box" role="alert" style={{marginTop:'0.5rem'}}>{req.error}</div>}
                                        
                                        {req.images.length > 0 && (
                                            <div className="generated-images-grid">
                                                {req.images.map((image, idx) => (
                                                    <div key={idx} className="generated-image-item">
                                                        <img 
                                                            src={image.dataUrl} 
                                                            alt={`Generated image ${idx + 1} for prompt: ${req.prompt}`} 
                                                            onClick={() => setLightboxImageSrc(image.dataUrl)}
                                                            style={{cursor: 'pointer'}}
                                                            role="button"
                                                            tabIndex={0}
                                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxImageSrc(image.dataUrl); } }}
                                                            aria-label={`View larger generated image ${idx + 1}`}
                                                        />
                                                         <a href={image.dataUrl} download={`generated_image_${req.id}_${idx+1}.jpg`} className="action-button small-action-button download-image-button">Download</a>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </main>
            {lightboxImageSrc && <ImageLightbox src={lightboxImageSrc} onClose={() => setLightboxImageSrc(null)} />}
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);