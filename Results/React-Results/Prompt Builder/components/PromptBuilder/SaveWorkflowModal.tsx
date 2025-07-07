import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Project } from '../../types';
import { SaveIcon } from '../icons';

interface SaveWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (title: string, projectId: string | 'new', newProjectName?: string) => void;
  projects: Project[];
}

export const SaveWorkflowModal: React.FC<SaveWorkflowModalProps> = ({ isOpen, onClose, onSave, projects }) => {
  const [title, setTitle] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setNewProjectName('');
      // Pre-select the first project if available
      if (projects.length > 0) {
        setSelectedProjectId(projects[0].id);
      } else {
        setSelectedProjectId('new');
      }
    }
  }, [isOpen, projects]);

  const handleSaveClick = () => {
    if (!title.trim()) {
        alert("Prompt title cannot be empty.");
        return;
    }
    if (selectedProjectId === 'new' && !newProjectName.trim()) {
        alert("New project name cannot be empty.");
        return;
    }
    if (!selectedProjectId && projects.length > 0) {
        alert("Please select a project.");
        return;
    }
    onSave(title, selectedProjectId, newProjectName);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Save Workflow as Prompt" size="lg">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        <div className="form-group">
          <label htmlFor="promptTitle" className="form-label">Prompt Title</label>
          <input
            id="promptTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input"
            placeholder="Enter a title for your new prompt"
            required
            autoFocus
          />
        </div>
        
        <div className="form-group">
            <label htmlFor="projectSelect" className="form-label">Project</label>
            <select
                id="projectSelect"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="form-select"
                disabled={projects.length === 0}
            >
                {projects.length > 0 ? (
                    projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                ) : (
                    <option value="" disabled>No projects exist. Create a new one.</option>
                )}
                <option value="new">-- Create a new project --</option>
            </select>
        </div>

        {selectedProjectId === 'new' && (
            <div className="form-group">
                <label htmlFor="newProjectName" className="form-label">New Project Name</label>
                <input
                    id="newProjectName"
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="form-input"
                    placeholder="Enter name for the new project"
                    required
                />
            </div>
        )}
      </div>
      <div className="modal__footer">
        <button type="button" onClick={onClose} className="btn btn--secondary">Cancel</button>
        <button type="button" onClick={handleSaveClick} className="btn btn--primary">
          <SaveIcon className="icon" /> Save Prompt
        </button>
      </div>
    </Modal>
  );
};
