import React, { useState, useEffect, useRef } from 'react';
import { Prompt, IdTextPair } from '../types';
import { EditableListItem } from './EditableListItem';
import { SparklesIcon, LightbulbIcon } from './icons'; 

interface PromptFormProps {
  prompt?: Prompt | null;
  projectId: string; 
  onSave: (prompt: Prompt) => void;
  onCancel: () => void;
  onRefineRequest?: (
    fieldKey: 'content' | 'systemInstructions', 
    currentText: string, 
    onApplyRefinement: (refinedText: string) => void
  ) => void;
  onGenerateRequest?: ( 
    fieldKey: 'content' | 'systemInstructions',
    onApplyGeneratedText: (generatedText: string, mode: 'replace' | 'append') => void,
    initialText?: string
  ) => void;
  onSuggestTagsRequest?: (
    promptTitle: string,
    promptContent: string,
    systemInstructions: string,
    currentTags: string[],
    onApplySuggestedTags: (newTags: string[]) => void
  ) => void;
  showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

export const PromptForm: React.FC<PromptFormProps> = ({ 
    prompt, projectId, onSave, onCancel, onRefineRequest, onGenerateRequest, onSuggestTagsRequest, showNotification
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [systemInstructions, setSystemInstructions] = useState<string>('');
  const [rules, setRules] = useState<IdTextPair[]>([]);
  const [tagsString, setTagsString] = useState(''); 
  const [temperature, setTemperature] = useState<number>(1);
  const [topP, setTopP] = useState<number>(0.95);

  useEffect(() => {
    if (prompt) {
      setTitle(prompt.title);
      setContent(prompt.content);
      if (Array.isArray(prompt.systemInstructions)) {
        setSystemInstructions(prompt.systemInstructions.map(si => si.text).join('\n\n'));
      } else {
        setSystemInstructions(prompt.systemInstructions || '');
      }
      setRules(prompt.rules || []);
      setTagsString((prompt.tags || []).join(', '));
      setTemperature(prompt.temperature ?? 1);
      setTopP(prompt.topP ?? 0.95);
    } else {
      setTitle('');
      setContent('');
      setSystemInstructions('');
      setRules([]);
      setTagsString('');
      setTemperature(1);
      setTopP(0.95);
    }
  }, [prompt]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      showNotification("Prompt title and content cannot be empty.", "error");
      return;
    }
    const now = new Date().toISOString();
    const tagsArray = tagsString.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean);

    onSave({
      id: prompt?.id || self.crypto.randomUUID(),
      projectId: prompt?.projectId || projectId,
      title: title.trim(),
      content: content,
      systemInstructions: systemInstructions.trim(),
      rules,
      tags: Array.from(new Set(tagsArray)),
      temperature: temperature,
      topP: topP,
      createdAt: prompt?.createdAt || now,
      updatedAt: now,
    });
  };

  const handleApplySuggestedTagsToForm = (tagsToAdd: string[]) => {
    setTagsString(prev => {
      const existingTags = prev.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const newTagsLower = tagsToAdd.map(t => t.trim().toLowerCase());
      const combinedUniqueTags = Array.from(new Set([...existingTags, ...newTagsLower]));
      return combinedUniqueTags.join(', ');
    });
  };
  
  const geminiButtonStyle = "btn btn--secondary btn--sm"; 

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <div className="modal__body custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', flexGrow: 1 }}>
        <div className="form-group">
          <label htmlFor="promptTitle" className="form-label">Prompt Title</label>
          <input
            id="promptTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="form-input"
          />
        </div>
        
        <div className="form-group">
          <div className="form-label">
            <span>Prompt Content <span style={{fontWeight: 400}}>(Use **bold text** for emphasis)</span></span>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              {onGenerateRequest && (
                <button 
                  type="button" 
                  onClick={() => onGenerateRequest(
                    'content', 
                    (newText, mode) => {
                        if (mode === 'replace') setContent(newText);
                        else setContent(prev => prev + (prev ? '\n\n' : '') + newText);
                    },
                    content
                  )}
                  className={geminiButtonStyle}
                  aria-label="Generate prompt content with Gemini"
                  title="Generate content with Gemini"
                >
                  <LightbulbIcon className="icon" /> Generate
                </button>
              )}
              {onRefineRequest && (
                <button 
                  type="button" 
                  onClick={() => onRefineRequest('content', content, (newText) => setContent(newText))}
                  className={geminiButtonStyle}
                  aria-label="Refine prompt content with Gemini"
                  title="Refine content with Gemini"
                >
                  <SparklesIcon className="icon" /> Refine
                </button>
              )}
            </div>
          </div>
          <textarea
            id="promptContent"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10} 
            required
            className="form-textarea"
            style={{minHeight: '150px'}}
          />
        </div>
        
        <div className="form-group">
           <div className="form-label">
            <span>System Instructions</span>
             <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                {onGenerateRequest && (
                  <button 
                    type="button" 
                    onClick={() => onGenerateRequest(
                        'systemInstructions', 
                        (newText, mode) => {
                            if (mode === 'replace') setSystemInstructions(newText);
                            else setSystemInstructions(prev => prev + (prev ? '\n\n' : '') + newText);
                        },
                        systemInstructions
                    )}
                    className={geminiButtonStyle}
                    aria-label="Generate system instructions with Gemini"
                    title="Generate system instructions with Gemini"
                  >
                    <LightbulbIcon className="icon" /> Generate
                  </button>
                )}
                {onRefineRequest && (
                  <button 
                    type="button" 
                    onClick={() => onRefineRequest('systemInstructions', systemInstructions, (newText) => setSystemInstructions(newText))}
                    className={geminiButtonStyle}
                    aria-label="Refine system instructions with Gemini"
                    title="Refine system instructions with Gemini"
                  >
                    <SparklesIcon className="icon" /> Refine
                  </button>
                )}
            </div>
          </div>
          <textarea
            id="systemInstructions"
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
            rows={5}
            placeholder="Enter system instructions for the AI model..."
            className="form-textarea"
            style={{minHeight: '100px'}}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
            <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="promptTemperature" className="form-label">Temperature</label>
                <input
                    id="promptTemperature"
                    type="number"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    min="0"
                    max="2"
                    step="0.01"
                    className="form-input"
                />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="promptTopP" className="form-label">Top P</label>
                <input
                    id="promptTopP"
                    type="number"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                    min="0"
                    max="1"
                    step="0.01"
                    className="form-input"
                />
            </div>
        </div>

        <EditableListItem
          label="Rules"
          items={rules}
          setItems={setRules}
          placeholder="Enter a rule"
        />

        <div className="form-group">
          <div className="form-label">
            <span>Tags (comma-separated, lowercase)</span>
            {onSuggestTagsRequest && (
                <button
                    type="button"
                    onClick={() => {
                        const currentTagsArray = tagsString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                        onSuggestTagsRequest(title, content, systemInstructions, currentTagsArray, handleApplySuggestedTagsToForm);
                    }}
                    className={geminiButtonStyle}
                    aria-label="Suggest tags with Gemini"
                    title="Suggest tags with Gemini"
                >
                    <LightbulbIcon className="icon" /> Suggest Tags
                </button>
            )}
          </div>
          <input
            id="promptTags"
            type="text"
            value={tagsString}
            onChange={(e) => setTagsString(e.target.value)}
            placeholder="e.g. code-generation, python, data-analysis"
            className="form-input"
          />
        </div>
      </div>

      <div className="modal__footer">
        <button type="button" onClick={onCancel} className="btn btn--secondary">
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          {prompt ? 'Save Prompt' : 'Create Prompt'}
        </button>
      </div>
    </form>
  );
};