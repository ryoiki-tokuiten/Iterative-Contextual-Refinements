import React, { useState, useEffect, useCallback } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Modal } from './Modal';
import { LightbulbIcon, SpinnerIcon, CheckIcon } from './icons';

interface GeminiSuggestTagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptTitle: string;
  promptContent: string;
  systemInstructions: string;
  currentTags: string[]; 
  onApplyTags: (suggestedTagsToAdd: string[]) => void;
  modelId: string;
  tagSuggestionInstruction: string;
  geminiApiKey: string; // Added geminiApiKey prop
}

export const GeminiSuggestTagsModal: React.FC<GeminiSuggestTagsModalProps> = ({
  isOpen,
  onClose,
  promptTitle,
  promptContent,
  systemInstructions,
  currentTags,
  onApplyTags,
  modelId,
  tagSuggestionInstruction,
  geminiApiKey,
}) => {
  

  const fetchSuggestions = useCallback(async () => {
    if (!geminiApiKey) {
      setError("API key is not configured.");
      return;
    }
    if (!modelId) {
      setError("Gemini Model ID is not configured.");
      return;
    }
    if (!promptContent.trim() && !systemInstructions.trim() && !promptTitle.trim()) {
        setError("Not enough context to suggest tags. Please add more content to the prompt.");
        setIsSuggesting(false);
        return;
    }

    setIsSuggesting(true);
    setError(null);
    setSuggestedTags([]);
    setSelectedNewTags([]);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      let contextForGemini = `System Instruction for Tag Generation: ${tagSuggestionInstruction}\n\n`;
      contextForGemini += `Prompt Title: "${promptTitle || 'N/A'}"\n\n`;
      contextForGemini += `Prompt Content:\n"""\n${promptContent || 'N/A'}\n"""\n\n`;
      contextForGemini += `Prompt System Instructions:\n"""\n${systemInstructions || 'N/A'}\n"""\n\n`;
      contextForGemini += `Existing Tags (for context, do not repeat these): ${currentTags.join(', ') || 'N/A'}\n\n`;
      contextForGemini += `Suggested Tags (comma-separated list):`;
      
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: modelId,
        contents: contextForGemini,
      });

      const rawTags = response.text.trim();
      let cleanedTags = rawTags.replace(/^```(\w*\s*)?\n?([\s\S]*?)\n?```$/s, '$2').trim();
      
      const parsedTags = cleanedTags
        .split(',')
        .map(tag => tag.trim().toLowerCase().replace(/\s+/g, '-'))
        .filter(tag => tag.length > 0);
      
      const currentTagsLower = currentTags.map(t => t.toLowerCase());
      const uniqueNewSuggestions = parsedTags.filter(tag => !currentTagsLower.includes(tag));

      setSuggestedTags(Array.from(new Set(uniqueNewSuggestions)));

    } catch (e: any) {
      console.error("Error suggesting tags:", e);
      setError(e.message || "Failed to suggest tags.");
      setSuggestedTags([]);
    } finally {
      setIsSuggesting(false);
    }
  }, [apiKey, modelId, promptTitle, promptContent, systemInstructions, currentTags, tagSuggestionInstruction]);

  useEffect(() => {
    if (isOpen) {
      fetchSuggestions(); 
    } else {
      setSuggestedTags([]);
      setSelectedNewTags([]);
      setError(null);
      setIsSuggesting(false);
    }
  }, [isOpen, fetchSuggestions]);

  const handleToggleSelectTag = (tag: string) => {
    setSelectedNewTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleApplySelectedTags = () => {
    if (selectedNewTags.length > 0) {
      onApplyTags(selectedNewTags);
    }
    onClose();
  };

  const contextBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    height: '60px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    border: '1px solid var(--border-primary)'
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Suggest Tags with Gemini" size="2xl">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)'}}>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
            <div className="form-group">
                <label className="form-label">Prompt Title (Context)</label>
                <div style={contextBoxStyle} className="custom-scrollbar">{promptTitle || "Not provided"}</div>
            </div>
            <div className="form-group">
                <label className="form-label">Existing Tags</label>
                <div style={contextBoxStyle} className="custom-scrollbar">
                    {currentTags.length > 0 ? currentTags.join(', ') : "None"}
                </div>
            </div>
        </div>

        <div className="form-group">
          <label className="form-label">Suggested Tags (click to select)</label>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)',
            padding: 'var(--space-md)', backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)',
            minHeight: '100px', alignItems: 'center', justifyContent: 'center'
          }}>
            {isSuggesting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--text-secondary)' }}>
                <SpinnerIcon className="icon animate-spin" /> Suggesting tags...
                </div>
            )}
            {!isSuggesting && error && (
                <div style={{color: 'var(--accent-danger)'}}><strong>Error:</strong> {error}</div>
            )}
            {!isSuggesting && !error && suggestedTags.length === 0 && (
                <p style={{color: 'var(--text-secondary)', margin:0}}>No new tag suggestions found.</p>
            )}
            {!isSuggesting && !error && suggestedTags.length > 0 && (
                suggestedTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleToggleSelectTag(tag)}
                    className={`tag-btn ${selectedNewTags.includes(tag) ? 'active' : ''}`}
                    aria-pressed={selectedNewTags.includes(tag)}
                    style={{display: 'flex', alignItems: 'center', gap: 'var(--space-xs)'}}
                  >
                    {selectedNewTags.includes(tag) && <CheckIcon style={{width:'1em', height:'1em'}} />}
                    {tag}
                  </button>
                ))
            )}
          </div>
        </div>
        
      </div>

      <div className="modal__footer" style={{justifyContent: 'space-between'}}>
          <button
            type="button"
            onClick={fetchSuggestions}
            className="btn btn--secondary"
            disabled={isSuggesting || !apiKey || !modelId}
          >
            <LightbulbIcon className="icon" />
            {isSuggesting ? 'Regenerating...' : 'Regenerate'}
          </button>
          <div style={{display: 'flex', gap:'var(--space-sm)'}}>
            <button type="button" onClick={onClose} className="btn btn--secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplySelectedTags}
              className="btn btn--primary"
              disabled={isSuggesting || selectedNewTags.length === 0}
            >
              Add Selected ({selectedNewTags.length})
            </button>
          </div>
        </div>
    </Modal>
  );
};