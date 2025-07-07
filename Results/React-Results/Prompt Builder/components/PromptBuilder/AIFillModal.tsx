import React, { useState, useCallback, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { Modal } from '../Modal';
import { ZapIcon, SpinnerIcon } from '../icons';
import { AIFillWorkflow } from './types';
import { NotificationState } from '../../types';
import { AI_FILL_SYSTEM_INSTRUCTION, BLOCK_CATEGORIES_FOR_PROMPT } from './constants';

interface AIFillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (workflow: AIFillWorkflow) => void;
  modelId: string;
  showNotification: (message: string, type?: NotificationState['type'], duration?: number) => void;
  geminiApiKey: string; // Added geminiApiKey prop
}

export const AIFillModal: React.FC<AIFillModalProps> = ({ isOpen, onClose, onConfirm, geminiApiKey, modelId, showNotification }) => {
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDescription('');
      setIsLoading(false);
      setError(null);
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    if (!geminiApiKey) {
      setError("API key is not configured. Please set it in the application settings.");
      return;
    }
    if (!description.trim()) {
      setError("Please provide a description for the workflow.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const fullPrompt = `${AI_FILL_SYSTEM_INSTRUCTION}
---
AVAILABLE BLOCK TYPES:
${BLOCK_CATEGORIES_FOR_PROMPT}
---
USER REQUEST:
"${description}"`;

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: modelId,
        contents: fullPrompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.5, // Lower temperature for more predictable structure
        },
      });

      let jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) {
        jsonStr = match[2].trim();
      }

      const parsedData = JSON.parse(jsonStr);

      if (parsedData && Array.isArray(parsedData.nodes) && Array.isArray(parsedData.edges)) {
        // Basic validation passed, hand off to the builder
        onConfirm(parsedData as AIFillWorkflow);
        onClose();
      } else {
        throw new Error("The AI returned an invalid or incomplete workflow structure.");
      }

    } catch (e: any) {
      console.error("Error during AI Fill generation:", e);
      const errorMessage = e.message || "An unknown error occurred during generation.";
      setError(`Failed to generate workflow. ${errorMessage}`);
      showNotification(`Generation failed: ${errorMessage}`, 'error', 5000);
    } finally {
      setIsLoading(false);
    }

  }, [geminiApiKey, modelId, description, onConfirm, onClose, showNotification]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI Fill Workflow" size="lg">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        <p>
            Describe the AI agent or workflow you want to build. The AI will generate a set of prompt blocks on the canvas to get you started.
        </p>
        <div className="form-group">
          <label htmlFor="aiFillDescription" className="form-label">
            High-Level Description
          </label>
          <textarea
            id="aiFillDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="form-textarea"
            rows={6}
            placeholder="e.g., a sarcastic cooking assistant that helps users find recipes in the style of Gordon Ramsay"
            autoFocus
            disabled={isLoading}
          />
        </div>
        
        {error && (
            <div style={{ padding: 'var(--space-md)', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-md)', color: 'var(--accent-danger)' }}>
                <strong>Error:</strong> {error}
            </div>
        )}
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--secondary" onClick={onClose} disabled={isLoading}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleGenerate}
          disabled={!description.trim() || isLoading}
        >
          {isLoading ? <SpinnerIcon className="icon" /> : <ZapIcon className="icon" />}
          {isLoading ? 'Generating...' : 'Generate Workflow'}
        </button>
      </div>
    </Modal>
  );
};