import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types'; 
import { PlusIcon, DeleteIcon } from './icons';

interface SettingsModalProps {
  onCancel: () => void; 
  currentSettings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  initialDefaultSettings: AppSettings; 
  guidelineDefaultModelId: string; 
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onCancel, 
  currentSettings,
  onSaveSettings,
  initialDefaultSettings,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [refineInstruction, setRefineInstruction] = useState('');
  const [generateInstruction, setGenerateInstruction] = useState('');
  const [tagSuggestionInstruction, setTagSuggestionInstruction] = useState('');
  const [defaultModelId, setDefaultModelId] = useState('');
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([]);
  const [newModelIdInput, setNewModelIdInput] = useState('');

  useEffect(() => {
    setGeminiApiKey(currentSettings.geminiApiKey);
    setRefineInstruction(currentSettings.geminiRefineInstruction);
    setGenerateInstruction(currentSettings.geminiGenerateInstruction);
    setTagSuggestionInstruction(currentSettings.geminiTagSuggestionInstruction || initialDefaultSettings.geminiTagSuggestionInstruction);
    setDefaultModelId(currentSettings.defaultGeminiModelId);
    
    const combinedModels = Array.from(new Set([
        ...(initialDefaultSettings.availableGeminiModelIds || []), 
        ...(currentSettings.availableGeminiModelIds || []),
        currentSettings.defaultGeminiModelId, 
    ])).filter(Boolean).sort();
    setAvailableModelIds(combinedModels);
  }, [currentSettings, initialDefaultSettings]);

  const handleSave = () => {
    const finalAvailableModels = Array.from(new Set([...availableModelIds, defaultModelId])).filter(Boolean).sort();
    
    onSaveSettings({
      geminiApiKey,
      geminiRefineInstruction: refineInstruction,
      geminiGenerateInstruction: generateInstruction,
      geminiTagSuggestionInstruction: tagSuggestionInstruction,
      defaultGeminiModelId: defaultModelId,
      availableGeminiModelIds: finalAvailableModels,
    });
  };

  const handleResetRefine = () => setRefineInstruction(initialDefaultSettings.geminiRefineInstruction);
  const handleResetGenerate = () => setGenerateInstruction(initialDefaultSettings.geminiGenerateInstruction);
  const handleResetTagSuggestion = () => setTagSuggestionInstruction(initialDefaultSettings.geminiTagSuggestionInstruction);
  
  const handleResetModelConfig = () => {
    setDefaultModelId(initialDefaultSettings.defaultGeminiModelId);
    setAvailableModelIds(Array.from(new Set([...initialDefaultSettings.availableGeminiModelIds])).filter(Boolean).sort());
  };

  const handleAddNewModelId = () => {
    const trimmedNewModelId = newModelIdInput.trim();
    if (trimmedNewModelId && !availableModelIds.includes(trimmedNewModelId)) {
      setAvailableModelIds(prev => Array.from(new Set([...prev, trimmedNewModelId])).sort());
      setNewModelIdInput('');
    } else if (availableModelIds.includes(trimmedNewModelId)) {
        alert("This Model ID already exists in the list.");
    } else {
        alert("Model ID cannot be empty.");
    }
  };

  const handleRemoveModelId = (modelIdToRemove: string) => {
    if (initialDefaultSettings.availableGeminiModelIds.includes(modelIdToRemove)) {
      alert(`Cannot remove a core application model: ${modelIdToRemove}.`);
      return;
    }
    if (modelIdToRemove === defaultModelId) {
      alert("Cannot remove the currently selected default model. Please select a different default model first.");
      return;
    }
    setAvailableModelIds(prev => prev.filter(id => id !== modelIdToRemove));
  };
  
  const btnResetStyle = "btn btn--secondary btn--sm";
  const sectionSeparatorStyle: React.CSSProperties = {
    borderTop: `1px solid var(--border-primary)`,
    margin: 'var(--space-lg) 0',
  };

  return (
    <>
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-md)'}}>
            <h3 className="modal__title" style={{fontSize: '1rem', borderBottom: '1px solid var(--border-primary)', paddingBottom: 'var(--space-md)'}}>API Configuration</h3>
            <div className="form-group">
                <label htmlFor="geminiApiKey" className="form-label">Gemini API Key</label>
                <input
                    id="geminiApiKey"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="form-input"
                    placeholder="Enter your Gemini API Key"
                />
            </div>
        </div>
        
        <div style={sectionSeparatorStyle}></div>
        
        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)'}}>
            <h3 className="modal__title" style={{fontSize: '1rem', borderBottom: '1px solid var(--border-primary)', paddingBottom: 'var(--space-md)'}}>Gemini Model Configuration</h3>
            <div className="form-group">
                <div className="form-label">
                    <span>Default Gemini Model for API Calls</span>
                    <button onClick={handleResetModelConfig} className={btnResetStyle}>Reset Config</button>
                </div>
                <select
                    id="defaultModelId"
                    value={defaultModelId}
                    onChange={(e) => setDefaultModelId(e.target.value)}
                    className="form-select"
                >
                    {availableModelIds.map(id => (
                        <option key={id} value={id}>{id}</option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label htmlFor="newModelIdInput" className="form-label">Add New Model ID</label>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <input
                        id="newModelIdInput"
                        type="text"
                        value={newModelIdInput}
                        onChange={(e) => setNewModelIdInput(e.target.value)}
                        placeholder="e.g., gemini-2.0-pro-example"
                        className="form-input"
                        style={{flexGrow: 1}}
                    />
                    <button onClick={handleAddNewModelId} className="btn btn--secondary" type="button">
                        <PlusIcon className="icon" /> Add
                    </button>
                </div>
            </div>

            {availableModelIds.length > 0 && (
                <div className="form-group">
                    <label className="form-label">Manage Available Model IDs</label>
                    <ul style={{ listStyle: 'none', padding: 'var(--space-sm)', margin: 0, maxHeight: '150px', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)'}} className="custom-scrollbar">
                        {availableModelIds.map(id => (
                            <li key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm)', borderBottom: '1px solid var(--border-primary)' }}>
                                <span>{id} {id === defaultModelId && <strong style={{color: 'var(--accent-success)'}}>(Default)</strong>}</span>
                                {(!initialDefaultSettings.availableGeminiModelIds.includes(id) && id !== defaultModelId) && (
                                    <button onClick={() => handleRemoveModelId(id)} className="btn btn--ghost btn--icon btn--sm" title={`Remove ${id}`}>
                                        <DeleteIcon className="icon" style={{color: 'var(--accent-danger)'}}/>
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
        
        <div style={sectionSeparatorStyle}></div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)'}}>
            <h3 className="modal__title" style={{fontSize: '1rem', borderBottom: '1px solid var(--border-primary)', paddingBottom: 'var(--space-md)'}}>Gemini System Instructions</h3>
            <div className="form-group">
              <div className="form-label">
                <span>For Text Refinement</span>
                <button onClick={handleResetRefine} className={btnResetStyle}>Reset</button>
              </div>
              <textarea id="refineInstruction" value={refineInstruction} onChange={(e) => setRefineInstruction(e.target.value)} className="form-textarea" rows={4} />
            </div>

            <div className="form-group">
              <div className="form-label">
                <span>For Text Generation</span>
                <button onClick={handleResetGenerate} className={btnResetStyle}>Reset</button>
              </div>
              <textarea id="generateInstruction" value={generateInstruction} onChange={(e) => setGenerateInstruction(e.target.value)} className="form-textarea" rows={4} />
            </div>
            
            <div className="form-group">
              <div className="form-label">
                <span>For Tag Suggestion</span>
                <button onClick={handleResetTagSuggestion} className={btnResetStyle}>Reset</button>
              </div>
              <textarea id="tagSuggestionInstruction" value={tagSuggestionInstruction} onChange={(e) => setTagSuggestionInstruction(e.target.value)} className="form-textarea" rows={4} />
            </div>
        </div>
        
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Note: Changes to these instructions will affect how Gemini responds.
            
        </p>
    </div>
    <div className="modal__footer">
        <button type="button" onClick={onCancel} className="btn btn--secondary">
        Cancel
        </button>
        <button
        type="button"
        onClick={handleSave}
        className="btn btn--primary"
        >
        Save Settings
        </button>
    </div>
    </>
  );
};