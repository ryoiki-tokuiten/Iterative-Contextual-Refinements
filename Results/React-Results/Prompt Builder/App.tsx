import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Project, Prompt, ModalState, IdTextPair, NotificationState, ConfirmationModalState, PromptSortConfig, GlobalSearchResultItem, AppSettings, PromptVersion, AttachedFile } from './types';
import { Modal } from './components/Modal';
import { ProjectForm } from './components/ProjectForm';
import { PromptForm } from './components/PromptForm';
import { GeminiRefineModal } from './components/GeminiRefineModal';
import { GeminiGenerateModal } from './components/GeminiGenerateModal';
import { GeminiSuggestTagsModal } from './components/GeminiSuggestTagsModal';
import { ConfirmationModal } from './components/ConfirmationModal';
import { NotificationContainer } from './components/NotificationToast';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { SettingsModal } from './components/SettingsModal';
import { ImportOptionsModal } from './components/ImportOptionsModal';
import { PromptListItem } from './components/PromptListItem';
import { PromptBuilder } from './components/PromptBuilder';
import { SaveWorkflowModal } from './components/PromptBuilder/SaveWorkflowModal';
import { PlusIcon, EditIcon, DeleteIcon, ArchiveIcon, FileSearchIcon, SearchIcon, ExportIcon, ImportIcon, FilterIcon, SortAscendingIcon, SortDescendingIcon, XCircleIcon, CogIcon, SparklesIcon } from './components/icons';

const DEFAULT_GEMINI_REFINE_INSTRUCTION = "You are an expert prompt engineer. Refine the following user-provided text to be clearer, more effective, concise, and optimally structured. Preserve the original intent and any specific constraints mentioned. Output only the refined text. If files are provided, use them as context for refinement.";
const DEFAULT_GEMINI_GENERATE_INSTRUCTION = "You are an expert prompt engineer. Generate content based on the user's request and any provided context or files. Output only the generated text.";
const DEFAULT_GEMINI_TAG_SUGGESTION_INSTRUCTION = "You are an expert in categorizing and tagging information. Based on the following prompt title, content, and system instructions, suggest 3 to 7 relevant, concise, comma-separated tags. Prioritize single-word tags where possible. If multiple words are necessary for a tag, use lowercase and hyphens (e.g., 'multi-word-tag'). Output ONLY the comma-separated list of tags. Do not include any other explanatory text. Example output: code-generation,python,data-analysis,web-dev";

const GUIDELINE_DEFAULT_MODEL_ID = 'gemini-2.5-flash-preview-04-17';
const APP_INITIAL_DEFAULT_MODEL_ID = 'gemini-2.5-flash-preview-04-17';
const OTHER_INITIAL_AVAILABLE_MODELS = ['gemini-pro'];

const initialAppSettings: AppSettings = {
  geminiApiKey: '',
  geminiRefineInstruction: DEFAULT_GEMINI_REFINE_INSTRUCTION,
  geminiGenerateInstruction: DEFAULT_GEMINI_GENERATE_INSTRUCTION,
  geminiTagSuggestionInstruction: DEFAULT_GEMINI_TAG_SUGGESTION_INSTRUCTION,
  defaultGeminiModelId: APP_INITIAL_DEFAULT_MODEL_ID,
  availableGeminiModelIds: Array.from(new Set([
    GUIDELINE_DEFAULT_MODEL_ID, 
    APP_INITIAL_DEFAULT_MODEL_ID, 
    ...OTHER_INITIAL_AVAILABLE_MODELS
  ])).filter(Boolean).sort(),
};

export const renderFormattedText = (text: string): React.ReactNode => {
  if (!text) return '';
  const segments = text.split(/(\*\*.*?\*\*|\n)/g);
  return segments.map((segment, index) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={index} className="text-strong">{segment.slice(2, -2)}</strong>;
    }
    if (segment === '\n') {
      return <br key={index} />;
    }
    return segment;
  });
};

const migratePromptData = (p: any): Prompt => {
  let migratedPrompt = { ...p };
  migratedPrompt.id = String(migratedPrompt.id || self.crypto.randomUUID());
  migratedPrompt.projectId = String(migratedPrompt.projectId || '');
  migratedPrompt.title = String(migratedPrompt.title || 'Untitled Prompt');
  migratedPrompt.content = String(migratedPrompt.content || '');

  if (Array.isArray(migratedPrompt.systemInstructions)) {
    migratedPrompt.systemInstructions = migratedPrompt.systemInstructions.map((si: any) => String(si.text || '')).join('\n\n');
  } else {
    migratedPrompt.systemInstructions = String(migratedPrompt.systemInstructions || '');
  }

  migratedPrompt.tags = Array.isArray(migratedPrompt.tags)
    ? migratedPrompt.tags.map((tag: any) => String(tag || '').trim().toLowerCase()).filter(Boolean)
    : [];
  migratedPrompt.tags = Array.from(new Set(migratedPrompt.tags));
  
  delete migratedPrompt.isFavorite;
  const topLevelEvaluation = typeof p.evaluation === 'number' && p.evaluation >= 1 && p.evaluation <= 10 ? p.evaluation : undefined;
  delete migratedPrompt.evaluation;

  migratedPrompt.temperature = typeof migratedPrompt.temperature === 'number' ? migratedPrompt.temperature : 1.0;
  migratedPrompt.topP = typeof migratedPrompt.topP === 'number' ? migratedPrompt.topP : 0.95;


  migratedPrompt.rules = Array.isArray(migratedPrompt.rules)
    ? migratedPrompt.rules.map((r: any) => ({
        id: String(r.id || self.crypto.randomUUID()),
        text: String(r.text || '')
      })).filter(r => r.id)
    : [];

  const isValidDateString = (str: any) => typeof str === 'string' && !isNaN(new Date(str).getTime());
  const now = new Date().toISOString();
  migratedPrompt.createdAt = isValidDateString(migratedPrompt.createdAt) ? migratedPrompt.createdAt : now;
  migratedPrompt.updatedAt = isValidDateString(migratedPrompt.updatedAt) ? migratedPrompt.updatedAt : now;

  migratedPrompt.versionHistory = Array.isArray(migratedPrompt.versionHistory) ? migratedPrompt.versionHistory : [];

  if (migratedPrompt.versionHistory.length === 0) {
    migratedPrompt.currentVersion = 1;
    migratedPrompt.versionHistory = [{
      version: 1,
      content: migratedPrompt.content,
      systemInstructions: migratedPrompt.systemInstructions,
      rules: migratedPrompt.rules,
      tags: migratedPrompt.tags,
      updatedAt: migratedPrompt.updatedAt,
      temperature: migratedPrompt.temperature,
      topP: migratedPrompt.topP,
      evaluation: topLevelEvaluation,
    }];
  } else {
    let currentVersionInHistoryHasEval = false;
    migratedPrompt.versionHistory = migratedPrompt.versionHistory.map((v: any, index: number) => {
      const versionRules = Array.isArray(v.rules)
        ? v.rules.map((r: any) => ({
            id: String(r.id || self.crypto.randomUUID()),
            text: String(r.text || '')
          })).filter(r => r.id)
        : [];
      const versionTags = Array.isArray(v.tags)
        ? v.tags.map((tag: any) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
      let versionSystemInstructions = '';
      if (Array.isArray(v.systemInstructions)) {
        versionSystemInstructions = v.systemInstructions.map((si: any) => String(si.text || '')).join('\n\n');
      } else {
        versionSystemInstructions = String(v.systemInstructions || '');
      }

      const versionEvaluation = typeof v.evaluation === 'number' && v.evaluation >= 1 && v.evaluation <= 10 ? v.evaluation : undefined;
      
      if(v.version === p.currentVersion && versionEvaluation !== undefined) {
          currentVersionInHistoryHasEval = true;
      }

      return {
        version: typeof v.version === 'number' && v.version > 0 ? v.version : index + 1,
        content: String(v.content || ''),
        systemInstructions: versionSystemInstructions,
        rules: versionRules,
        tags: Array.from(new Set(versionTags)),
        updatedAt: isValidDateString(v.updatedAt) ? v.updatedAt : migratedPrompt.updatedAt,
        temperature: typeof v.temperature === 'number' ? v.temperature : 1.0,
        topP: typeof v.topP === 'number' ? v.topP : 0.95,
        evaluation: versionEvaluation
      };
    }).sort((a: PromptVersion, b: PromptVersion) => a.version - b.version);
    
    if (topLevelEvaluation !== undefined && !currentVersionInHistoryHasEval) {
        migratedPrompt.versionHistory = migratedPrompt.versionHistory.map((v: PromptVersion) => {
            if (v.version === p.currentVersion) {
                return {...v, evaluation: topLevelEvaluation};
            }
            return v;
        });
    }
  }

  let maxVersionInHistory = 0;
  if (migratedPrompt.versionHistory.length > 0) {
    maxVersionInHistory = Math.max(0, ...migratedPrompt.versionHistory.map((v: PromptVersion) => v.version));
  }

  if (typeof migratedPrompt.currentVersion !== 'number' ||
      migratedPrompt.currentVersion < 1 ||
      !migratedPrompt.versionHistory.some((v: PromptVersion) => v.version === migratedPrompt.currentVersion)) {
    migratedPrompt.currentVersion = maxVersionInHistory > 0 ? maxVersionInHistory : 1;
  }

  const currentVersionData = migratedPrompt.versionHistory.find((v:PromptVersion) => v.version === migratedPrompt.currentVersion);
  if (currentVersionData) {
    migratedPrompt.content = currentVersionData.content;
    migratedPrompt.systemInstructions = currentVersionData.systemInstructions;
    migratedPrompt.rules = currentVersionData.rules;
    migratedPrompt.tags = currentVersionData.tags;
    migratedPrompt.temperature = currentVersionData.temperature ?? 1.0;
    migratedPrompt.topP = currentVersionData.topP ?? 0.95;
  } else if (migratedPrompt.versionHistory.length > 0) {
     const latestVersionInHistory = migratedPrompt.versionHistory.reduce((latest, current) => current.version > latest.version ? current : latest);
     migratedPrompt.currentVersion = latestVersionInHistory.version;
     migratedPrompt.content = latestVersionInHistory.content;
     migratedPrompt.systemInstructions = latestVersionInHistory.systemInstructions;
     migratedPrompt.rules = latestVersionInHistory.rules;
     migratedPrompt.tags = latestVersionInHistory.tags;
     migratedPrompt.temperature = latestVersionInHistory.temperature ?? 1.0;
     migratedPrompt.topP = latestVersionInHistory.topP ?? 0.95;
  }
  return migratedPrompt as Prompt;
};


const App: React.FC = () => {
  const [view, setView] = useState<'organizer' | 'builder'>('builder');

  const [projects, setProjects] = useState<Project[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  const [promptSearchTerm, setPromptSearchTerm] = useState('');

  const [notifications, setNotifications] = useState<NotificationState[]>([]);
  const [confirmationModal, setConfirmationModal] = useState<ConfirmationModalState | null>(null);

  const [refineModalConfig, setRefineModalConfig] = useState<{
    initialText: string;
    onApplyCallback: (refinedText: string) => void;
    fieldLabel: string;
  } | null>(null);

  const [generateModalConfig, setGenerateModalConfig] = useState<{
    onApplyCallback: (generatedText: string, mode: 'replace' | 'append') => void;
    fieldLabel: string;
    initialContextText?: string;
  } | null>(null);

  const [suggestTagsModalConfig, setSuggestTagsModalConfig] = useState<{
    promptTitle: string;
    promptContent: string;
    systemInstructions: string;
    currentTags: string[];
    onApplyTagsCallback: (newTags: string[]) => void;
  } | null>(null);


  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [promptSortConfig, setPromptSortConfig] = useState<PromptSortConfig>({ field: 'updatedAt', direction: 'desc' });

  const [appSettings, setAppSettings] = useState<AppSettings>(initialAppSettings);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [pendingImportData, setPendingImportData] = useState<any | null>(null);
  const [isImportOptionsModalOpen, setIsImportOptionsModalOpen] = useState(false);

  const [selectedHistoricalVersionNumber, setSelectedHistoricalVersionNumber] = useState<number | null>(null);

  // New state for builder features
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [saveWorkflowModalState, setSaveWorkflowModalState] = useState<{ isOpen: boolean; livePrompt: string } | null>(null);


  const showNotification = useCallback((message: string, type: NotificationState['type'] = 'info', duration = 3000) => {
    const id = self.crypto.randomUUID();
    setNotifications(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    try {
        const storedProjects = localStorage.getItem('promptAppProjects');
        if (storedProjects) setProjects(JSON.parse(storedProjects));

        const storedPrompts = localStorage.getItem('promptAppPrompts');
        if (storedPrompts) {
            let parsedPrompts: any[] = JSON.parse(storedPrompts);
            parsedPrompts = parsedPrompts.map(p => migratePromptData(p));
            setPrompts(parsedPrompts as Prompt[]);
        }

        const storedAppSettings = localStorage.getItem('promptAppSettings');
        if (storedAppSettings) {
            const parsedSettings = JSON.parse(storedAppSettings);
            const migratedSettings: AppSettings = {
                ...initialAppSettings, 
                ...parsedSettings,    
                geminiApiKey: parsedSettings.geminiApiKey || '',
                defaultGeminiModelId: parsedSettings.defaultGeminiModelId || initialAppSettings.defaultGeminiModelId,
                availableGeminiModelIds: Array.isArray(parsedSettings.availableGeminiModelIds) && parsedSettings.availableGeminiModelIds.length > 0
                    ? Array.from(new Set([...parsedSettings.availableGeminiModelIds, ...initialAppSettings.availableGeminiModelIds])).filter(Boolean).sort()
                    : initialAppSettings.availableGeminiModelIds,
            };
            
            if (!migratedSettings.availableGeminiModelIds.includes(migratedSettings.defaultGeminiModelId) && migratedSettings.defaultGeminiModelId) {
                migratedSettings.availableGeminiModelIds.push(migratedSettings.defaultGeminiModelId);
            }
             if (!migratedSettings.availableGeminiModelIds.includes(GUIDELINE_DEFAULT_MODEL_ID) && GUIDELINE_DEFAULT_MODEL_ID) { // Ensure guideline model is always available
                migratedSettings.availableGeminiModelIds.push(GUIDELINE_DEFAULT_MODEL_ID);
            }
            migratedSettings.availableGeminiModelIds = Array.from(new Set(migratedSettings.availableGeminiModelIds)).filter(Boolean).sort();


            setAppSettings(migratedSettings);
        } else {
             setAppSettings(initialAppSettings);
        }

    } catch (error) {
        console.error("Error loading data from localStorage:", error);
        showNotification("Error loading saved data. It might be corrupted. Resetting to defaults.", "error", 5000);
        localStorage.removeItem('promptAppProjects');
        localStorage.removeItem('promptAppPrompts');
        localStorage.removeItem('promptAppSettings');
        setProjects([]);
        setPrompts([]);
        setAppSettings(initialAppSettings);
    }
  }, [showNotification]);

  useEffect(() => {
    localStorage.setItem('promptAppProjects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('promptAppPrompts', JSON.stringify(prompts));
  }, [prompts]);

  useEffect(() => {
    localStorage.setItem('promptAppSettings', JSON.stringify(appSettings));
  }, [appSettings]);

  const currentPromptObject = useMemo(() => {
      if (!expandedPromptId) return null;
      return prompts.find(p => p.id === expandedPromptId);
  }, [prompts, expandedPromptId]);

  const displayedPromptData = useMemo(() => {
    if (!expandedPromptId) return null;
    const prompt = prompts.find(p => p.id === expandedPromptId);
    if (!prompt) return null;

    let versionNumberToDisplay = selectedHistoricalVersionNumber;
    if (versionNumberToDisplay === null) {
      versionNumberToDisplay = prompt.currentVersion || null;
    }

    if (versionNumberToDisplay !== null) {
        return prompt.versionHistory?.find(v => v.version === versionNumberToDisplay) || null;
    }
    
    // Fallback for prompts that might not have a version history or currentVersion somehow after migration
    return prompt.versionHistory?.[prompt.versionHistory.length - 1] || null;

  }, [prompts, expandedPromptId, selectedHistoricalVersionNumber]);


  const handleOpenModal = (state: ModalState) => setModalState(state);
  const handleCloseModal = () => {
    setModalState(null);
  }

  const handleSaveProject = (project: Project) => {
    const isEditing = projects.some(p => p.id === project.id);
    setProjects(prev => {
      if (isEditing) return prev.map(p => (p.id === project.id ? project : p));
      return [...prev, project].sort((a,b) => a.name.localeCompare(b.name));
    });
    showNotification(`Project "${project.name}" ${isEditing ? 'updated' : 'created'} successfully.`, 'success');
    handleCloseModal();
  };

  const confirmDeleteProject = (projectId: string, projectName: string) => {
    setConfirmationModal({
        isOpen: true,
        title: "Delete Project",
        message: <>Are you sure you want to delete the project <strong>"{projectName}"</strong> and all its prompts? This action cannot be undone.</>,
        confirmText: "Delete Project",
        onConfirm: () => handleDeleteProject(projectId),
    });
  };

  const handleDeleteProject = (projectId: string) => {
    const projectToDelete = projects.find(p => p.id === projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    setPrompts(prev => prev.filter(p => p.projectId !== projectId));
    if (selectedProjectId === projectId) setSelectedProjectId(null);
    showNotification(`Project "${projectToDelete?.name}" and its prompts deleted.`, 'success');
  };

  const handleSavePrompt = (promptDataFromForm: Prompt) => {
    const now = new Date().toISOString();
    const isEditing = prompts.some(p => p.id === promptDataFromForm.id);

    if (isEditing) {
        let newVersionNumberToSelect: number | null = null;
        
        const updatedPrompts = prompts.map(p => {
            if (p.id === promptDataFromForm.id) {
                const currentVersionNumber = p.currentVersion || (p.versionHistory && p.versionHistory.length > 0 ? Math.max(...p.versionHistory.map(v => v.version)) : 0);
                const newVersionNumber = currentVersionNumber + 1;
                newVersionNumberToSelect = newVersionNumber; // Capture the new version number

                const previousVersionData = p.versionHistory?.find(v => v.version === p.currentVersion);

                const newVersion: PromptVersion = {
                    version: newVersionNumber,
                    content: promptDataFromForm.content,
                    systemInstructions: promptDataFromForm.systemInstructions,
                    rules: promptDataFromForm.rules,
                    tags: promptDataFromForm.tags,
                    updatedAt: now,
                    temperature: promptDataFromForm.temperature,
                    topP: promptDataFromForm.topP,
                    evaluation: previousVersionData?.evaluation,
                };
                const updatedVersionHistory = [...(p.versionHistory || []), newVersion].sort((a,b) => a.version - b.version);

                return {
                    ...p,
                    title: promptDataFromForm.title,
                    content: promptDataFromForm.content,
                    systemInstructions: promptDataFromForm.systemInstructions,
                    rules: promptDataFromForm.rules,
                    tags: promptDataFromForm.tags,
                    temperature: promptDataFromForm.temperature,
                    topP: promptDataFromForm.topP,
                    updatedAt: now,
                    currentVersion: newVersionNumber,
                    versionHistory: updatedVersionHistory,
                };
            }
            return p;
        });
        
        setPrompts(updatedPrompts);
        
        // If the edited prompt is the one that's currently expanded,
        // update the view to show the new, current version.
        if (promptDataFromForm.id === expandedPromptId && newVersionNumberToSelect !== null) {
            setSelectedHistoricalVersionNumber(newVersionNumberToSelect);
        }

    } else { // This is for creating a new prompt
        const newPrompt: Prompt = {
            id: promptDataFromForm.id || self.crypto.randomUUID(),
            projectId: promptDataFromForm.projectId,
            title: promptDataFromForm.title,
            content: promptDataFromForm.content,
            systemInstructions: promptDataFromForm.systemInstructions,
            rules: promptDataFromForm.rules,
            tags: promptDataFromForm.tags,
            temperature: promptDataFromForm.temperature,
            topP: promptDataFromForm.topP,
            createdAt: now,
            updatedAt: now,
            currentVersion: 1,
            versionHistory: [{
                version: 1,
                content: promptDataFromForm.content,
                systemInstructions: promptDataFromForm.systemInstructions,
                rules: promptDataFromForm.rules,
                tags: promptDataFromForm.tags,
                updatedAt: now,
                temperature: promptDataFromForm.temperature,
                topP: promptDataFromForm.topP,
            }],
        };
        setPrompts(prev => [...prev, newPrompt]);
    }

    showNotification(`Prompt "${promptDataFromForm.title}" ${isEditing ? 'updated' : 'created'} successfully.`, 'success');
    handleCloseModal();
  };

  const confirmDeletePrompt = (promptId: string, promptTitle: string) => {
    setConfirmationModal({
        isOpen: true,
        title: "Delete Prompt",
        message: <>Are you sure you want to delete the prompt <strong>"{promptTitle}"</strong>? This action cannot be undone.</>,
        confirmText: "Delete Prompt",
        onConfirm: () => handleDeletePrompt(promptId),
    });
  };

  const handleDeletePrompt = (promptId: string) => {
    const promptToDelete = prompts.find(p => p.id === promptId);
    setPrompts(prev => prev.filter(p => p.id !== promptId));
    if (expandedPromptId === promptId) setExpandedPromptId(null);
    showNotification(`Prompt "${promptToDelete?.title}" deleted.`, 'success');
  };

  const confirmDeleteVersion = (promptId: string, promptTitle: string, versionNumber: number) => {
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) return;
    if (prompt.versionHistory && prompt.versionHistory.length <= 1) {
        showNotification("Cannot delete the only version of a prompt.", "error");
        return;
    }
    if (prompt.currentVersion === versionNumber) {
        showNotification("Cannot delete the active version. Please restore another version first.", "error");
        return;
    }

    setConfirmationModal({
        isOpen: true,
        title: "Delete Prompt Version",
        message: <>Are you sure you want to permanently delete <strong>Version {versionNumber}</strong> of the prompt <strong>"{promptTitle}"</strong>? This action cannot be undone.</>,
        confirmText: "Delete Version",
        onConfirm: () => handleDeleteVersion(promptId, versionNumber),
    });
  };

  const handleDeleteVersion = (promptId: string, versionNumber: number) => {
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) return;

    if (selectedHistoricalVersionNumber === versionNumber) {
        setSelectedHistoricalVersionNumber(prompt.currentVersion || null);
    }
    
    setPrompts(prevPrompts =>
        prevPrompts.map(p => {
            if (p.id === promptId) {
                if (!p.versionHistory || p.versionHistory.length <= 1 || p.currentVersion === versionNumber) {
                    return p;
                }
                const updatedHistory = p.versionHistory.filter(v => v.version !== versionNumber);
                return {
                    ...p,
                    versionHistory: updatedHistory,
                    updatedAt: new Date().toISOString(),
                };
            }
            return p;
        })
    );
    showNotification(`Version ${versionNumber} of prompt "${prompt.title}" deleted successfully.`, 'success');
  };

  const handleUpdateEvaluation = (promptId: string, versionNumber: number, evaluation: number) => {
    setPrompts(prevPrompts =>
        prevPrompts.map(p => {
            if (p.id === promptId) {
                const updatedVersionHistory = p.versionHistory?.map(v =>
                    v.version === versionNumber ? { ...v, evaluation, updatedAt: new Date().toISOString() } : v
                );
                return { ...p, versionHistory: updatedVersionHistory, updatedAt: new Date().toISOString() };
            }
            return p;
        })
    );
};


  const handleCopyText = useCallback((text: string, successMessage: string) => {
    navigator.clipboard.writeText(text)
      .then(() => showNotification(successMessage, 'success'))
      .catch(err => {
        console.error('Failed to copy: ', err);
        showNotification('Failed to copy text.', 'error');
      });
  }, [showNotification]);


  const handleCopyPromptContent = useCallback((prompt: Prompt) => {
    const versionDetailsToUse = displayedPromptData;
    const contentToCopy = versionDetailsToUse ? versionDetailsToUse.content : prompt.content;
    handleCopyText(contentToCopy, 'Prompt content copied!');
  }, [handleCopyText, displayedPromptData]);


  const handleCopyFullPrompt = useCallback((prompt: Prompt) => {
    const data = displayedPromptData || prompt;

    let fullPromptText = "";
    if (data.systemInstructions && data.systemInstructions.trim()) {
      fullPromptText += `System Instructions:\n${data.systemInstructions.trim()}\n\n`;
    }
    if (data.rules && data.rules.length > 0) {
      fullPromptText += "Rules:\n" + data.rules.map(rule => `- ${rule.text}`).join("\n") + "\n\n";
    }
    if (data.tags && data.tags.length > 0) {
        fullPromptText += "Tags: " + data.tags.join(', ') + "\n\n";
    }
    fullPromptText += `Prompt Content:\n${data.content}`;
    handleCopyText(fullPromptText.trim(), 'Full prompt copied!');
  }, [handleCopyText, displayedPromptData]);

  const filteredProjects = useMemo(() => {
    if (!projectSearchTerm.trim()) return projects.sort((a,b) => a.name.localeCompare(b.name));
    return projects.filter(project =>
      project.name.toLowerCase().includes(projectSearchTerm.toLowerCase()) ||
      (project.description && project.description.toLowerCase().includes(projectSearchTerm.toLowerCase()))
    ).sort((a,b) => a.name.localeCompare(b.name));
  }, [projects, projectSearchTerm]);

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);

  const uniqueTagsInProject = useMemo(() => {
    if (!selectedProjectId) return [];
    const tagsSet = new Set<string>();
    prompts
      .filter(p => p.projectId === selectedProjectId)
      .forEach(p => (p.tags || []).forEach(tag => tagsSet.add(tag)));
    return Array.from(tagsSet).sort((a,b) => a.localeCompare(b));
  }, [prompts, selectedProjectId]);

  const toggleTagFilter = (tag: string) => {
    setActiveTagFilters(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const currentProjectPrompts = useMemo(() => {
    if (!selectedProjectId) return [];

    let projectPrompts = prompts.filter(p => p.projectId === selectedProjectId);

    if (promptSearchTerm.trim()) {
      const searchTermLower = promptSearchTerm.toLowerCase();
      projectPrompts = projectPrompts.filter(prompt =>
        prompt.title.toLowerCase().includes(searchTermLower) ||
        prompt.content.toLowerCase().includes(searchTermLower) ||
        (prompt.tags && prompt.tags.some(tag => tag.toLowerCase().includes(searchTermLower)))
      );
    }

    if (activeTagFilters.length > 0) {
      projectPrompts = projectPrompts.filter(prompt =>
        activeTagFilters.every(filterTag => (prompt.tags || []).includes(filterTag))
      );
    }

    return projectPrompts.sort((a, b) => {
      const sortField = promptSortConfig.field;
      let valueA_any = a[sortField as keyof Prompt];
      let valueB_any = b[sortField as keyof Prompt];

      let valueA = typeof valueA_any === 'string' ? valueA_any : String(valueA_any || '');
      let valueB = typeof valueB_any === 'string' ? valueB_any : String(valueB_any || '');

      let comparison = 0;

      if (sortField === 'title') {
        comparison = valueA.localeCompare(valueB);
      } else {
        const dateA = new Date(valueA);
        const dateB = new Date(valueB);
        const aIsInvalid = isNaN(dateA.getTime());
        const bIsInvalid = isNaN(dateB.getTime());

        if (aIsInvalid && bIsInvalid) comparison = 0;
        else if (aIsInvalid) comparison = 1;
        else if (bIsInvalid) comparison = -1;
        else comparison = dateA.getTime() - dateB.getTime();
      }
      return promptSortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [prompts, selectedProjectId, promptSearchTerm, activeTagFilters, promptSortConfig]);

  useEffect(() => {
    if (view === 'organizer') {
        setActiveTagFilters([]);
        setPromptSearchTerm('');
        const currentExpandedPrompt = prompts.find(p => p.id === expandedPromptId);
        if (currentExpandedPrompt && currentExpandedPrompt.projectId !== selectedProjectId) {
            setExpandedPromptId(null);
            setSelectedHistoricalVersionNumber(null);
        } else {
            setSelectedHistoricalVersionNumber(null);
        }
    }
  }, [selectedProjectId, expandedPromptId, prompts, view]);

  const togglePromptExpand = (promptId: string) => {
    setExpandedPromptId(prevId => {
      const newExpandedId = prevId === promptId ? null : promptId;
      if (newExpandedId) {
          const prompt = prompts.find(p => p.id === newExpandedId);
          setSelectedHistoricalVersionNumber(prompt?.currentVersion || null);
      } else {
          setSelectedHistoricalVersionNumber(null);
      }
      return newExpandedId;
    });
  };

  const handleOpenRefineModal = (config: NonNullable<typeof refineModalConfig>) => {
    setRefineModalConfig(config);
  };
  const handleCloseRefineModal = () => setRefineModalConfig(null);

  const handleOpenGenerateModal = (config: NonNullable<typeof generateModalConfig>) => {
    setGenerateModalConfig(config);
  };
  const handleCloseGenerateModal = () => setGenerateModalConfig(null);

  const handleOpenSuggestTagsModal = (config: NonNullable<typeof suggestTagsModalConfig>) => {
    setSuggestTagsModalConfig(config);
  };
  const handleCloseSuggestTagsModal = () => setSuggestTagsModalConfig(null);


  const handleApplyRefinedPromptToList = (promptId: string, refinedContent: string) => {
    const promptToUpdate = prompts.find(p => p.id === promptId);
    if (promptToUpdate) {
        handleSavePrompt({
            ...promptToUpdate, 
            content: refinedContent, 
        });

        showNotification("Prompt content refined and new version created.", "success");
    } else {
        showNotification("Error: Could not find prompt to refine.", "error");
    }
};

  const handleExportData = () => {
    const dataToExport = { projects, prompts, appSettings };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(dataToExport, null, 2))}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = `prompt_organizer_backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification("Data exported successfully.", "success");
  };

  const handleAppendImportedData = (importedData: any) => {
    let appendedProjectsCount = 0;
    let skippedProjectsCount = 0;
    let appendedPromptsCount = 0;
    let skippedPromptsByIdCount = 0;
    let skippedPromptsByOrphanedCount = 0;
    let migrationFailedPromptsCount = 0;

    const projectsToAppend: Project[] = [];
    const allProjectIdsForPromptCheck = new Set(projects.map(p => p.id));

    (importedData.projects || []).forEach((importedProject: Project) => {
        if (!allProjectIdsForPromptCheck.has(importedProject.id)) {
            projectsToAppend.push(importedProject);
            allProjectIdsForPromptCheck.add(importedProject.id);
            appendedProjectsCount++;
        } else {
            skippedProjectsCount++;
        }
    });
    if (projectsToAppend.length > 0) {
        setProjects(prev => [...prev, ...projectsToAppend].sort((a, b) => a.name.localeCompare(b.name)));
    }

    const currentPromptIds = new Set(prompts.map(p => p.id));
    const promptsToAppend: Prompt[] = [];
    (importedData.prompts || []).forEach((importedPromptData: any) => {
        if (currentPromptIds.has(importedPromptData.id)) {
            skippedPromptsByIdCount++;
            return;
        }
        if (!allProjectIdsForPromptCheck.has(importedPromptData.projectId)) {
            skippedPromptsByOrphanedCount++;
            return;
        }
        try {
            const migrated = migratePromptData(importedPromptData);
            promptsToAppend.push(migrated);
            appendedPromptsCount++;
        } catch (migrationError) {
            console.error("Error migrating an appended prompt:", migrationError, importedPromptData);
            showNotification(`Error processing an imported prompt (ID: ${importedPromptData.id || 'unknown'}) during append. It has been skipped.`, "error", 5000);
            migrationFailedPromptsCount++;
        }
    });

    if (promptsToAppend.length > 0) {
        setPrompts(prev => [...prev, ...promptsToAppend]);
    }

    let summaryMessage = `Data appended: ${appendedProjectsCount} projects and ${appendedPromptsCount} prompts added.`;
    if (skippedProjectsCount > 0) summaryMessage += ` Skipped ${skippedProjectsCount} projects (ID existed).`;
    if (skippedPromptsByIdCount > 0) summaryMessage += ` Skipped ${skippedPromptsByIdCount} prompts (ID existed).`;
    if (skippedPromptsByOrphanedCount > 0) summaryMessage += ` Skipped ${skippedPromptsByOrphanedCount} prompts (parent project not found).`;
    if (migrationFailedPromptsCount > 0) summaryMessage += ` Failed to migrate ${migrationFailedPromptsCount} prompts.`;
    showNotification(summaryMessage, 'success', 7000);
    showNotification("Current application settings were preserved.", 'info');
    setPendingImportData(null);
};

const handleReplaceImportedData = (importedData: any) => {
    let migrationFailedPromptsCount = 0;
    const migratedImportedPrompts = (importedData.prompts || []).map((p: any) => {
        try {
            return migratePromptData(p);
        } catch (migrationError) {
            console.error("Error migrating an imported prompt for replacement:", migrationError, p);
            showNotification(`Error processing an imported prompt (ID: ${p.id || 'unknown'}) for replacement. It may be corrupted or skipped.`, "error", 5000);
            migrationFailedPromptsCount++;
            return null;
        }
    }).filter(Boolean); 

    setProjects(importedData.projects || []);
    setPrompts(migratedImportedPrompts as Prompt[]);

    if (importedData.appSettings) {
        const importedAppSettings = importedData.appSettings;
        const newAppSettings: AppSettings = {
            ...initialAppSettings, 
            ...importedAppSettings, 
            defaultGeminiModelId: importedAppSettings.defaultGeminiModelId || initialAppSettings.defaultGeminiModelId,
            availableGeminiModelIds: Array.isArray(importedAppSettings.availableGeminiModelIds) && importedAppSettings.availableGeminiModelIds.length > 0
                ? Array.from(new Set([...importedAppSettings.availableGeminiModelIds, ...initialAppSettings.availableGeminiModelIds])).filter(Boolean).sort()
                : initialAppSettings.availableGeminiModelIds,
        };
        
        if (!newAppSettings.availableGeminiModelIds.includes(newAppSettings.defaultGeminiModelId) && newAppSettings.defaultGeminiModelId) {
            newAppSettings.availableGeminiModelIds.push(newAppSettings.defaultGeminiModelId);
        }
        if (!newAppSettings.availableGeminiModelIds.includes(GUIDELINE_DEFAULT_MODEL_ID) && GUIDELINE_DEFAULT_MODEL_ID) {
             newAppSettings.availableGeminiModelIds.push(GUIDELINE_DEFAULT_MODEL_ID);
        }
        newAppSettings.availableGeminiModelIds = Array.from(new Set(newAppSettings.availableGeminiModelIds)).filter(Boolean).sort();
        setAppSettings(newAppSettings);
    } else {
        setAppSettings(initialAppSettings); 
    }

    setSelectedProjectId(null);
    setExpandedPromptId(null);
    setActiveTagFilters([]);
    let successMessage = "Data imported successfully! All previous data has been replaced.";
    if (migrationFailedPromptsCount > 0) {
        successMessage += ` Note: ${migrationFailedPromptsCount} prompts failed to migrate and were skipped.`;
    }
    showNotification(successMessage, migrationFailedPromptsCount > 0 ? 'warning' : 'success', 7000);
    setPendingImportData(null);
};

const handleConfirmImportWithOptions = (mode: 'replace' | 'append') => {
    if (!pendingImportData) return;
    if (mode === 'append') {
        handleAppendImportedData(pendingImportData);
    } else { 
        handleReplaceImportedData(pendingImportData);
    }
    setIsImportOptionsModalOpen(false);
};

const closeImportOptionsModal = () => {
    setIsImportOptionsModalOpen(false);
    setPendingImportData(null);
};


  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const importedData = JSON.parse(text);

        if (importedData && typeof importedData === 'object' &&
            (Array.isArray(importedData.projects) || Array.isArray(importedData.prompts) || typeof importedData.appSettings === 'object')) {
            setPendingImportData(importedData);
            setIsImportOptionsModalOpen(true);
        } else {
          showNotification("Invalid file format. The JSON structure is not recognized. Ensure it contains 'projects', 'prompts', or 'appSettings' keys.", "error", 5000);
        }
      } catch (error) {
        console.error("Error importing data:", error);
        showNotification("Failed to import data. The file might be corrupted or not in the correct JSON format.", "error", 5000);
      } finally {
        if (importFileRef.current) {
            importFileRef.current.value = "";
        }
      }
    };
    reader.readAsText(file);
  };

  const triggerImportFile = () => {
    importFileRef.current?.click();
  }

  const handleSaveAppSettings = (newSettingsFromModal: AppSettings) => {
    const finalAvailableModels = Array.from(new Set([
        ...newSettingsFromModal.availableGeminiModelIds, 
        newSettingsFromModal.defaultGeminiModelId, 
        GUIDELINE_DEFAULT_MODEL_ID 
    ])).filter(Boolean).sort();
    
    let finalDefaultModelId = newSettingsFromModal.defaultGeminiModelId;
    if (!finalAvailableModels.includes(finalDefaultModelId) || !finalDefaultModelId) {
        finalDefaultModelId = initialAppSettings.defaultGeminiModelId; 
    }
    
    setAppSettings({
        ...newSettingsFromModal,
        defaultGeminiModelId: finalDefaultModelId,
        availableGeminiModelIds: finalAvailableModels,
    });
    showNotification("Application settings saved successfully.", "success");
  };

  const scrollToPrompt = (promptId: string) => {
    setTimeout(() => {
        const element = document.getElementById(`prompt-card-${promptId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          console.warn(`Element with id prompt-card-${promptId} not found for scrolling.`);
        }
    }, 100);
  };

  const handleGlobalSearchResultSelect = (item: Project | Prompt) => {
    setIsGlobalSearchOpen(false);
    setView('organizer'); // Switch to organizer view on selection
    if ('projectId' in item) {
        const promptItem = item as Prompt;
        setSelectedProjectId(promptItem.projectId);
        setExpandedPromptId(promptItem.id);
        setSelectedHistoricalVersionNumber(promptItem.currentVersion || null);
        setPromptSearchTerm('');
        setActiveTagFilters([]);
        scrollToPrompt(promptItem.id);
    } else {
        setSelectedProjectId(item.id);
        setExpandedPromptId(null);
        setSelectedHistoricalVersionNumber(null);
        setPromptSearchTerm('');
        setActiveTagFilters([]);
    }
  };

  const handleRestoreVersion = (promptId: string, versionToRestore: PromptVersion) => {
    const promptToUpdate = prompts.find(p => p.id === promptId);
    if (!promptToUpdate) {
        showNotification("Error: Could not find prompt to restore.", "error");
        return;
    }

    const now = new Date().toISOString();
    const currentMaxVersion = promptToUpdate.versionHistory && promptToUpdate.versionHistory.length > 0
        ? Math.max(...promptToUpdate.versionHistory.map(v => v.version))
        : 0;
    const newVersionNumberForRestored = currentMaxVersion + 1;

    const newRestoredVersionEntry: PromptVersion = {
        ...versionToRestore, // Bring all fields from the old version
        version: newVersionNumberForRestored,
        updatedAt: now,
    };

    const updatedVersionHistory = [...(promptToUpdate.versionHistory || []), newRestoredVersionEntry].sort((a,b)=> a.version - b.version);

    const updatedPrompt: Prompt = {
        ...promptToUpdate,
        title: promptToUpdate.title,
        content: newRestoredVersionEntry.content,
        systemInstructions: newRestoredVersionEntry.systemInstructions,
        rules: newRestoredVersionEntry.rules,
        tags: newRestoredVersionEntry.tags,
        temperature: newRestoredVersionEntry.temperature,
        topP: newRestoredVersionEntry.topP,
        updatedAt: now,
        currentVersion: newVersionNumberForRestored,
        versionHistory: updatedVersionHistory,
    };

    setPrompts(prevPrompts =>
      prevPrompts.map(p => (p.id === promptId ? updatedPrompt : p))
    );
    setSelectedHistoricalVersionNumber(newVersionNumberForRestored);
    showNotification(`Prompt restored from Version ${versionToRestore.version} (now active as Version ${newVersionNumberForRestored}).`, 'success');
  };

  const handleOpenSaveWorkflowModal = (livePrompt: string) => {
    if (!livePrompt.trim()) {
        showNotification("Cannot save an empty workflow.", "warning");
        return;
    }
    setSaveWorkflowModalState({ isOpen: true, livePrompt });
  };

  const handleCloseSaveWorkflowModal = () => {
    setSaveWorkflowModalState(null);
  };

  const handleSaveWorkflowAsPrompt = (title: string, projectId: string | 'new', newProjectName?: string) => {
      if (!saveWorkflowModalState || !saveWorkflowModalState.livePrompt) return;

      let finalProjectId = projectId;
      let newProjectCreated = false;

      if (projectId === 'new' && newProjectName?.trim()) {
          const newProject: Project = {
              id: self.crypto.randomUUID(),
              name: newProjectName.trim(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
          };
          // This doesn't use the existing handleSaveProject to avoid its side effects like closing modals.
          setProjects(prev => [...prev, newProject].sort((a,b) => a.name.localeCompare(b.name)));
          finalProjectId = newProject.id;
          newProjectCreated = true;
      } else if (projectId === 'new' && !newProjectName?.trim()) {
          showNotification("New project name cannot be empty.", "error");
          return;
      }

      if (!finalProjectId || finalProjectId === 'new') {
          showNotification("Invalid project selected.", "error");
          return;
      }
      
      const promptDataFromWorkflow: Prompt = {
          id: self.crypto.randomUUID(), // New prompt, so generate ID
          projectId: finalProjectId,
          title: title.trim(),
          content: saveWorkflowModalState.livePrompt,
          systemInstructions: '', // Workflows don't map to this yet
          rules: [],
          tags: ['workflow-builder'],
          temperature: 1.0,
          topP: 0.95,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
      };
      
      // We call handleSavePrompt with a new prompt object
      handleSavePrompt(promptDataFromWorkflow);
      
      showNotification(`Prompt "${title}" saved to project "${newProjectCreated ? newProjectName : projects.find(p => p.id === finalProjectId)?.name}".`, 'success');
      
      handleCloseSaveWorkflowModal();
  };

  const renderOrganizerView = () => (
     <main className="app-main custom-scrollbar">
        {!selectedProject ? (
          <div className="app-main__placeholder">
            <ArchiveIcon className="icon" />
            <h2>Select a project</h2>
            <p>or create a new one to start organizing prompts.</p>
          </div>
        ) : (
          <>
            <header className="app-main__header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{minWidth: 0}}>
                  <h2 style={{ fontSize:'2rem', color: 'var(--text-primary)'}} title={selectedProject.name}>{selectedProject.name}</h2>
                  {selectedProject.description && <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', margin: 'var(--space-xs) 0 0 0' }} title={selectedProject.description}>{selectedProject.description}</p>}
                </div>
                <button
                    onClick={() => handleOpenModal({ type: 'prompt', mode: 'new', currentProjectId: selectedProject.id })}
                    className="btn btn--primary"
                    aria-label="Create New Prompt in this Project"
                  >
                    <PlusIcon className="icon" /> New Prompt
                  </button>
              </div>
               <div className="input-group" style={{marginTop: 'var(--space-lg)'}}>
                <SearchIcon className="icon" />
                <input
                  type="search"
                  placeholder={`Search in ${selectedProject.name.substring(0,20)}${selectedProject.name.length > 20 ? "..." : ""}...`}
                  value={promptSearchTerm}
                  onChange={(e) => setPromptSearchTerm(e.target.value)}
                  className="form-input"
                />
              </div>
            </header>

            <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-sm)'}}>
                <FilterIcon style={{color: 'var(--text-secondary)'}} />
                <label className="form-label" style={{marginBottom: 0, color: 'var(--text-secondary)', whiteSpace:'nowrap'}}>Filter by Tags:</label>
                {activeTagFilters.length > 0 && (
                  <button
                    onClick={() => setActiveTagFilters([])}
                    className="btn btn--icon btn--ghost btn--sm"
                    title="Clear all tag filters"
                  >
                    <XCircleIcon />
                  </button>
                )}
              </div>

              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-sm)'}}>
                <label htmlFor="sortField" className="form-label" style={{marginBottom:0, color: 'var(--text-secondary)', whiteSpace: 'nowrap'}}>
                    Sort by:
                </label>
                <select
                  id="sortField"
                  value={promptSortConfig.field}
                  onChange={(e) => setPromptSortConfig(prev => ({ ...prev, field: e.target.value as PromptSortConfig['field'] }))}
                  className="form-select"
                  style={{minWidth: '150px'}}
                >
                  <option value="updatedAt">Last Updated</option>
                  <option value="createdAt">Date Created</option>
                  <option value="title">Title</option>
                </select>
                <button
                  onClick={() => setPromptSortConfig(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                  className="btn btn--icon btn--ghost"
                  title={`Sort ${promptSortConfig.direction === 'asc' ? 'Descending' : 'Ascending'}`}
                >
                  {promptSortConfig.direction === 'asc' ? <SortAscendingIcon /> : <SortDescendingIcon />}
                </button>
              </div>
            </div>

            {uniqueTagsInProject.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                  {uniqueTagsInProject.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTagFilter(tag)}
                      className={`tag-btn ${activeTagFilters.includes(tag) ? 'active' : ''}`}
                      aria-pressed={activeTagFilters.includes(tag)}
                    >
                      {tag}
                    </button>
                  ))}
              </div>
            )}

            {currentProjectPrompts.length === 0 && (
              <div className="app-main__placeholder" style={{padding: 'var(--space-xl)'}}>
                  <FileSearchIcon className="icon" />
                  <h2>{promptSearchTerm || activeTagFilters.length > 0 ? 'No Prompts Found' : 'No Prompts Yet'}</h2>
                  <p>{promptSearchTerm || activeTagFilters.length > 0 ? 'Try adjusting your search or filter criteria.' : 'Click "New Prompt" to get started!'}</p>
               </div>
            )}

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
              {currentProjectPrompts.map(prompt => {
                const isExpanded = expandedPromptId === prompt.id;
                const dataForDisplay = (isExpanded && displayedPromptData)
                    ? displayedPromptData
                    : (prompt.versionHistory?.find(v => v.version === prompt.currentVersion) || prompt as any);

                return (
                    <PromptListItem
                        key={prompt.id}
                        prompt={prompt}
                        isExpanded={isExpanded}
                        displayedData={dataForDisplay}
                        currentPromptObject={isExpanded ? currentPromptObject : null}
                        selectedHistoricalVersionNumber={selectedHistoricalVersionNumber}
                        onToggleExpand={togglePromptExpand}
                        onUpdateEvaluation={handleUpdateEvaluation}
                        onRefine={(p, data) => {
                            const contentToRefine = data?.content || '';
                            handleOpenRefineModal({
                                initialText: contentToRefine,
                                onApplyCallback: (refinedText) => handleApplyRefinedPromptToList(p.id, refinedText),
                                fieldLabel: "Prompt Content",
                            });
                        }}
                        onCopyFullPrompt={handleCopyFullPrompt}
                        onCopyContent={handleCopyPromptContent}
                        onEdit={(p) => handleOpenModal({ type: 'prompt', mode: 'edit', data: p, currentProjectId: selectedProject.id })}
                        onDelete={confirmDeletePrompt}
                        onSelectHistoricalVersion={setSelectedHistoricalVersionNumber}
                        onRestoreVersion={handleRestoreVersion}
                        onDeleteVersion={confirmDeleteVersion}
                        renderFormattedText={renderFormattedText}
                    />
                );
              })}
            </ul>
          </>
        )}
      </main>
  );

  return (
    <div className={`app-container ${view === 'builder' && isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
      <aside className="app-sidebar custom-scrollbar">
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
             <button
              onClick={() => setView(view === 'organizer' ? 'builder' : 'organizer')}
              className="btn btn--secondary"
              style={{flex: 1}}
              aria-label={view === 'organizer' ? 'Switch to Builder View' : 'Switch to Organizer View'}
            >
              <SparklesIcon className="icon" /> {view === 'organizer' ? 'Build' : 'Organize'}
            </button>
            <button
              onClick={() => handleOpenModal({ type: 'project', mode: 'new' })}
              className="btn btn--primary"
              style={{flexGrow: 1}}
              aria-label="Create New Project"
            >
              <PlusIcon className="icon" /> New Project
            </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <button
              onClick={() => setIsGlobalSearchOpen(true)}
              className="btn btn--icon btn--ghost"
              title="Global Search"
              aria-label="Open Global Search"
            >
              <SearchIcon className="icon" />
            </button>
            <button
                onClick={triggerImportFile}
                className="btn btn--icon btn--ghost"
                aria-label="Import Data"
                title="Import Data"
            >
                <ImportIcon className="icon" />
            </button>
            <input type="file" ref={importFileRef} onChange={handleImportData} accept=".json" style={{ display: 'none' }} />
            <button
                onClick={handleExportData}
                className="btn btn--icon btn--ghost"
                aria-label="Export All Data"
                title="Export All Data"
            >
                <ExportIcon className="icon" />
            </button>
            <button
              onClick={() => handleOpenModal({ type: 'settings', mode: 'edit', data: appSettings })}
              className="btn btn--icon btn--ghost"
              title="Application Settings"
              aria-label="Open Application Settings"
            >
              <CogIcon className="icon" />
            </button>
        </div>
        
        {view === 'organizer' && (
            <>
                <div className="input-group">
                    <SearchIcon className="icon" />
                    <input
                        type="search"
                        placeholder="Search projects..."
                        value={projectSearchTerm}
                        onChange={(e) => setProjectSearchTerm(e.target.value)}
                        className="form-input"
                    />
                </div>
                <ul className="project-list custom-scrollbar">
                {filteredProjects.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0', color: 'var(--text-secondary)'}}>
                    <p>{projectSearchTerm ? 'No projects match your search.' : 'No projects yet.'}</p>
                    </div>
                )}
                {filteredProjects.map(project => (
                    <li key={project.id}
                        className={`project-list-item ${selectedProjectId === project.id ? 'selected' : ''}`}
                        onClick={() => setSelectedProjectId(project.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedProjectId(project.id);}}
                        tabIndex={0}
                        role="button"
                        aria-pressed={selectedProjectId === project.id}
                    >
                    <div className="project-list-item__header">
                        <span className="project-list-item__title" title={project.name}>{project.name}</span>
                        <div className="project-list-item__actions">
                        <button onClick={(e) => { e.stopPropagation(); handleOpenModal({ type: 'project', mode: 'edit', data: project }); }}
                                className="btn btn--ghost btn--icon btn--sm" title="Edit Project" aria-label={`Edit project ${project.name}`}>
                            <EditIcon className="icon"/>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); confirmDeleteProject(project.id, project.name); }}
                                className="btn btn--ghost btn--icon btn--sm" title="Delete Project" aria-label={`Delete project ${project.name}`}>
                            <DeleteIcon className="icon"/>
                        </button>
                        </div>
                    </div>
                    {project.description && <p className="project-list-item__description" title={project.description}>{project.description}</p>}
                    </li>
                ))}
                </ul>
            </>
        )}
         {view === 'builder' && (
            <div style={{flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', color: 'var(--text-secondary)', padding: 'var(--space-md)'}}>
                <SparklesIcon className="icon" style={{width: '2.5rem', height: '2.5rem', color: 'var(--accent-primary)', marginBottom: 'var(--space-md)'}} />
                <h3 style={{color: 'var(--text-primary)'}}>Builder Mode</h3>
                <p style={{margin: 0}}>Visually construct and test prompt workflows on the main canvas.</p>
            </div>
        )}
      </aside>

      {view === 'organizer' ? renderOrganizerView() : <PromptBuilder appSettings={appSettings} showNotification={showNotification} onSaveRequest={handleOpenSaveWorkflowModal} onToggleSidebar={() => setIsSidebarCollapsed(p => !p)} isSidebarCollapsed={isSidebarCollapsed} />}

      {modalState && (
        <Modal
          isOpen={!!modalState}
          onClose={handleCloseModal}
          title={
            modalState.type === 'settings' ? 'Application Settings' :
            modalState.mode === 'edit'
            ? `Edit ${modalState.type.charAt(0).toUpperCase() + modalState.type.slice(1)}`
            : `New ${modalState.type.charAt(0).toUpperCase() + modalState.type.slice(1)}`
          }
          size={
            modalState.type === 'prompt' ? '5xl' :
            modalState.type === 'settings' ? '2xl' : 'lg'
          }
        >
          {modalState.type === 'project' && (
            <ProjectForm
              project={modalState.data as Project | undefined}
              onSave={handleSaveProject}
              onCancel={handleCloseModal}
            />
          )}
          {modalState.type === 'prompt' && modalState.currentProjectId && (
            <PromptForm
              prompt={modalState.data as Prompt | undefined}
              projectId={modalState.currentProjectId}
              onSave={handleSavePrompt}
              onCancel={handleCloseModal}
              showNotification={showNotification}
              onRefineRequest={(fieldKey, currentText, onFormApplyCallback) => {
                handleOpenRefineModal({
                  initialText: currentText,
                  onApplyCallback: onFormApplyCallback,
                  fieldLabel: fieldKey === 'content' ? 'Prompt Content' : 'System Instructions',
                });
              }}
              onGenerateRequest={(fieldKey, onFormApplyCallback, currentTextFromForm) => {
                handleOpenGenerateModal({
                    onApplyCallback: onFormApplyCallback,
                    fieldLabel: fieldKey === 'content' ? 'Prompt Content' : 'System Instructions',
                    initialContextText: currentTextFromForm,
                });
              }}
              onSuggestTagsRequest={(title, content, systemInstructions, currentTags, onFormApplyTagsCallback) => {
                handleOpenSuggestTagsModal({
                    promptTitle: title,
                    promptContent: content,
                    systemInstructions: systemInstructions,
                    currentTags: currentTags,
                    onApplyTagsCallback: onFormApplyTagsCallback
                });
              }}
            />
          )}
           {modalState.type === 'settings' && (
            <SettingsModal
              currentSettings={appSettings}
              onSaveSettings={(newSettings) => {
                handleSaveAppSettings(newSettings);
                handleCloseModal();
              }}
              onCancel={handleCloseModal}
              initialDefaultSettings={initialAppSettings} 
              guidelineDefaultModelId={GUIDELINE_DEFAULT_MODEL_ID}
            />
          )}
        </Modal>
      )}
      {refineModalConfig && (
         <GeminiRefineModal
            isOpen={true}
            onClose={handleCloseRefineModal}
            originalText={refineModalConfig.initialText}
            onApply={(refinedText) => {
              refineModalConfig.onApplyCallback(refinedText);
              handleCloseRefineModal();
            }}
            modelId={appSettings.defaultGeminiModelId}
            contextLabel={refineModalConfig.fieldLabel}
            systemInstruction={appSettings.geminiRefineInstruction}
            showNotification={showNotification}
            geminiApiKey={appSettings.geminiApiKey}
        />
      )}
       {generateModalConfig && (
         <GeminiGenerateModal
            isOpen={true}
            onClose={handleCloseGenerateModal}
            onApplyGeneratedContent={(generatedText, mode) => { 
              generateModalConfig.onApplyCallback(generatedText, mode); 
              handleCloseGenerateModal();
              showNotification(`${generateModalConfig.fieldLabel} generated. Use "Save Prompt" in the form to persist changes.`, 'info', 4000);
            }}
            modelId={appSettings.defaultGeminiModelId}
            contextLabel={generateModalConfig.fieldLabel}
            systemInstruction={appSettings.geminiGenerateInstruction}
            initialContextText={generateModalConfig.initialContextText}
            showNotification={showNotification}
            geminiApiKey={appSettings.geminiApiKey}
        />
      )}
      {suggestTagsModalConfig && (
        <GeminiSuggestTagsModal
            isOpen={true}
            onClose={handleCloseSuggestTagsModal}
            promptTitle={suggestTagsModalConfig.promptTitle}
            promptContent={suggestTagsModalConfig.promptContent}
            systemInstructions={suggestTagsModalConfig.systemInstructions}
            currentTags={suggestTagsModalConfig.currentTags}
            onApplyTags={(newTags) => {
                suggestTagsModalConfig.onApplyTagsCallback(newTags);
                handleCloseSuggestTagsModal();
                showNotification('Tags updated with suggestions. Save prompt to apply changes.', 'info');
            }}
            modelId={appSettings.defaultGeminiModelId}
            tagSuggestionInstruction={appSettings.geminiTagSuggestionInstruction}
            geminiApiKey={appSettings.geminiApiKey}
        />
      )}
      {isGlobalSearchOpen && (
        <GlobalSearchModal
            isOpen={isGlobalSearchOpen}
            onClose={() => setIsGlobalSearchOpen(false)}
            projects={projects}
            prompts={prompts}
            onSelectResult={handleGlobalSearchResultSelect}
        />
      )}
      {isImportOptionsModalOpen && pendingImportData && (
        <ImportOptionsModal
          isOpen={isImportOptionsModalOpen}
          onClose={closeImportOptionsModal}
          onConfirm={handleConfirmImportWithOptions}
        />
      )}
       {saveWorkflowModalState?.isOpen && (
        <SaveWorkflowModal
            isOpen={true}
            onClose={handleCloseSaveWorkflowModal}
            onSave={handleSaveWorkflowAsPrompt}
            projects={projects}
        />
      )}
      {confirmationModal && confirmationModal.isOpen && (
        <ConfirmationModal
            key={confirmationModal.title} 
            isOpen={confirmationModal.isOpen}
            onClose={() => {
                setConfirmationModal(null);
            }}
            onConfirm={() => {
                if (confirmationModal.onConfirm) confirmationModal.onConfirm();
                setConfirmationModal(null);
            }}
            title={confirmationModal.title}
            message={confirmationModal.message}
            confirmButtonText={confirmationModal.confirmText}
            cancelButtonText={confirmationModal.cancelText}
        />
      )}
    </div>
  );
};

export default App;