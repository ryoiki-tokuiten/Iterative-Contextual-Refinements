import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { WarningIcon } from './icons';

interface ImportOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'replace' | 'append') => void;
}

export const ImportOptionsModal: React.FC<ImportOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [selectedMode, setSelectedMode] = useState<'replace' | 'append'>('replace');

  useEffect(() => {
    if (isOpen) {
      setSelectedMode('replace');
    }
  }, [isOpen]);

  const handleConfirmClick = () => {
    onConfirm(selectedMode);
  };
  
  const radioLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    cursor: 'pointer',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    transition: 'background-color var(--transition-fast) ease-in-out',
    border: '1px solid var(--border-primary)',
    backgroundColor: 'var(--bg-secondary)',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Data Options" size="md">
        <div className="modal__body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
              <p>Choose how to import the data from the selected file:</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <label style={radioLabelStyle} onMouseEnter={e=>e.currentTarget.style.backgroundColor='var(--surface-primary)'} onMouseLeave={e=>e.currentTarget.style.backgroundColor='var(--bg-secondary)'}>
                  <input
                    type="radio"
                    name="importModeInternal"
                    value="replace"
                    checked={selectedMode === 'replace'}
                    onChange={() => setSelectedMode('replace')}
                    style={{marginRight:'var(--space-md)', marginTop:'5px', height:'1rem', width:'1rem', accentColor: 'var(--accent-primary)', flexShrink: 0}}
                  />
                  <span>
                    <strong style={{color: 'var(--text-primary)'}}>Replace existing data</strong>
                    <br/>
                    <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Clears all current projects, prompts, and settings before importing.</span>
                  </span>
                </label>
                <label style={radioLabelStyle} onMouseEnter={e=>e.currentTarget.style.backgroundColor='var(--surface-primary)'} onMouseLeave={e=>e.currentTarget.style.backgroundColor='var(--bg-secondary)'}>
                  <input
                    type="radio"
                    name="importModeInternal"
                    value="append"
                    checked={selectedMode === 'append'}
                    onChange={() => setSelectedMode('append')}
                    style={{marginRight:'var(--space-md)', marginTop:'5px', height:'1rem', width:'1rem', accentColor: 'var(--accent-primary)', flexShrink: 0}}
                  />
                   <span>
                    <strong style={{color: 'var(--text-primary)'}}>Append to existing data</strong>
                    <br/>
                    <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Adds new projects and prompts. Skips items with duplicate IDs. Current app settings are preserved.</span>
                  </span>
                </label>
              </div>

                <div style={{display:'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', backgroundColor: 'rgba(251, 191, 36, 0.1)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-warning)'}}>
                    <WarningIcon style={{ width: '1.25rem', height: '1.25rem', color: 'var(--accent-warning)', flexShrink: 0, marginTop:'3px' }} /> 
                    <p style={{ fontSize: '0.9rem', color: 'var(--accent-warning)', margin: 0 }}>
                        This action might be irreversible. Please ensure you have a backup if needed.
                    </p>
              </div>
            </div>
        </div>
        <div className="modal__footer">
          <button type="button" onClick={onClose} className="btn btn--secondary">
            Cancel
          </button>
          <button type="button" onClick={handleConfirmClick} className="btn btn--primary">
            Proceed with Import
          </button>
        </div>
    </Modal>
  );
};