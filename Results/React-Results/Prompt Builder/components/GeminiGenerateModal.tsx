import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { Modal } from './Modal';
import { LightbulbIcon, SpinnerIcon, PaperClipIcon, XCircleIcon } from './icons';
import { AttachedFile } from '../types';

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const readFileAsBase64InModal = (file: File): Promise<AttachedFile> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File "${file.name}" is too large (max ${MAX_FILE_SIZE_MB}MB).`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1]; 
      resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: base64Data });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

interface GeminiGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyGeneratedContent: (generatedText: string, mode: 'replace' | 'append') => void;
  modelId: string;
  contextLabel: string; 
  systemInstruction: string;
  initialContextText?: string; 
  showNotification?: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
  geminiApiKey: string; // Added geminiApiKey prop
}

export const GeminiGenerateModal: React.FC<GeminiGenerateModalProps> = ({
  isOpen,
  onClose,
  onApplyGeneratedContent,
  geminiApiKey,
  modelId,
  contextLabel,
  systemInstruction,
  initialContextText,
  showNotification, 
}) => {

  const [userPrompt, setUserPrompt] = useState(''); 
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFilesInModal, setAttachedFilesInModal] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUserPrompt('');
      setGeneratedText('');
      setError(null);
      setAttachedFilesInModal([]);
    }
  }, [isOpen]);

  const handleFileChangeInModal = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFilesPromises: Promise<AttachedFile>[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!attachedFilesInModal.find(af => af.name === file.name && af.data.length === file.size)) {
            newFilesPromises.push(readFileAsBase64InModal(file));
        }
    }

    try {
        const results = await Promise.all(newFilesPromises);
        setAttachedFilesInModal(prev => [...prev, ...results]);
        if (showNotification) showNotification(`${results.length} file(s) attached.`, 'success');
    } catch (error: any) {
        console.error("Error attaching files in modal:", error);
        if (showNotification) showNotification(error.message || "Error attaching one or more files.", "error");
    }
    if(fileInputRef.current) fileInputRef.current.value = ""; 
  };

  const removeAttachedFileInModal = (fileName: string) => {
    setAttachedFilesInModal(prev => prev.filter(f => f.name !== fileName));
  };

  const handleGenerate = useCallback(async () => {
    if (!geminiApiKey) {
      setError("API key is not configured.");
      return;
    }
    if (!modelId) {
      setError("Gemini Model ID is not configured.");
      return;
    }
    if (!userPrompt.trim()) {
      setError(`Please provide a description or instruction for what you want to generate.`);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedText('');

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const parts: Part[] = [];

      parts.push({ text: `User's primary request for generation: ${userPrompt}` });

      if (initialContextText && initialContextText.trim()) {
        parts.push({ text: `\n\nExisting content from form (for context):\n"""\n${initialContextText}\n"""` });
      }
      
      attachedFilesInModal.forEach(file => {
        parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
      });
      
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: {
          systemInstruction: systemInstruction,
        }
      });

      setGeneratedText(response.text.trim());
    } catch (e: any) {
      console.error(`Error generating ${contextLabel.toLowerCase()}:`, e);
      setError(e.message || `Failed to generate ${contextLabel.toLowerCase()}.`);
    } finally {
      setIsGenerating(false);
    }
  }, [userPrompt, apiKey, modelId, contextLabel, systemInstruction, initialContextText, attachedFilesInModal]);

  const handleApply = (mode: 'replace' | 'append') => {
    if (generatedText.trim()) {
      onApplyGeneratedContent(generatedText, mode);
    }
  };
  
  const readOnlyBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-md)',
    padding: '0.75rem 1rem',
    maxHeight: '120px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    color: 'var(--text-secondary)',
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Generate ${contextLabel} with Gemini`} size="2xl">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        
        {initialContextText && initialContextText.trim() && (
            <div className="form-group">
                <label className="form-label">Existing {contextLabel} (Context from Form)</label>
                <div style={readOnlyBoxStyle} className="custom-scrollbar">{initialContextText}</div>
            </div>
        )}

        <div className="form-group">
            <label className="form-label">Attach Files for Context (Max {MAX_FILE_SIZE_MB}MB each)</label>
            <input 
                type="file" multiple onChange={handleFileChangeInModal} ref={fileInputRef} className="sr-only"
                accept="image/*,video/*,application/pdf,.txt,.json,.md,.csv,.tsv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn--secondary" style={{alignSelf: 'flex-start'}}>
                <PaperClipIcon className="icon" /> Attach Files
            </button>
            {attachedFilesInModal.length > 0 && (
                <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxHeight: '120px', overflowY: 'auto', padding:'var(--space-sm)', backgroundColor:'var(--bg-secondary)', borderRadius:'var(--radius-md)'}} className="custom-scrollbar">
                    {attachedFilesInModal.map(file => (
                        <div key={file.name} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-xs) var(--space-sm)', borderRadius: 'var(--radius-sm)'}}>
                            <span style={{fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={file.name}>{file.name}</span>
                            <button type="button" onClick={() => removeAttachedFileInModal(file.name)} className="btn btn--ghost btn--icon btn--sm" title="Remove file">
                                <XCircleIcon className="icon" style={{color: 'var(--accent-danger)'}}/>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>

        <div className="form-group">
          <label htmlFor="userPrompt" className="form-label">
            Describe what you want Gemini to generate:
          </label>
          <textarea
            id="userPrompt"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder={`e.g., "Summarize the provided text and attached files", "Expand on the topic of AI ethics based on the attached PDF", "Write three alternative opening paragraphs"`}
            className="form-textarea"
            rows={3}
            disabled={isGenerating}
            autoFocus
          />
        </div>

        <div className="form-group">
            <label htmlFor="generatedText" className="form-label">Generated {contextLabel}</label>
          <div style={{ position: 'relative' }}>
            <textarea
              id="generatedText"
              value={generatedText}
              onChange={(e) => setGeneratedText(e.target.value)}
              placeholder={isGenerating ? "Gemini is working its magic..." : `Generated ${contextLabel.toLowerCase()} will appear here...`}
              className="form-textarea"
              style={{minHeight: '150px'}}
              rows={6}
              readOnly={isGenerating}
              aria-label={`Generated ${contextLabel.toLowerCase()}`}
            />
            {isGenerating && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18, 20, 29, 0.7)', borderRadius: 'var(--radius-md)' }}>
                <SpinnerIcon className="icon animate-spin" style={{ width: '2rem', height: '2rem', color: 'var(--accent-primary)' }} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: 'var(--space-md)', backgroundColor: 'rgba(248, 113, 113, 0.1)', border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-md)', color: 'var(--accent-danger)'}}>
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      <div className="modal__footer" style={{justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap'}}>
          <button
            type="button"
            onClick={handleGenerate}
            className="btn btn--secondary" 
            disabled={isGenerating || !userPrompt.trim() || !apiKey || !modelId}
          >
            <LightbulbIcon className="icon" />
            {isGenerating ? 'Generating...' : generatedText ? 'Re-generate' : 'Generate'}
          </button>
          
          <div style={{display: 'flex', gap: 'var(--space-sm)'}}>
            <button type="button" onClick={onClose} className="btn btn--secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleApply('append')}
              className="btn btn--primary"
              disabled={isGenerating || !generatedText.trim()}
              title="Add generated text to the end of the current content in the form"
            >
              Append to Form
            </button>
            <button
              type="button"
              onClick={() => handleApply('replace')}
              className="btn btn--primary"
              disabled={isGenerating || !generatedText.trim()}
              title="Replace current content in the form with generated text"
            >
              Replace in Form
            </button>
          </div>
        </div>
    </Modal>
  );
};