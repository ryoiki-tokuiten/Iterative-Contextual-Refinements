
export interface IdTextPair {
  id: string;
  text: string;
}

export interface PromptVersion {
  version: number;
  content: string;
  systemInstructions: string;
  rules: IdTextPair[];
  tags?: string[];
  updatedAt: string; // Timestamp of when this version was created
  temperature?: number;
  topP?: number;
  evaluation?: number; // 1-10 slider rating, now per version
}

export interface Prompt {
  id:string;
  projectId: string;
  title: string;
  content: string; // Supports Markdown-like **bold** text
  systemInstructions: string; 
  rules: IdTextPair[];
  tags?: string[]; // Added for tagging
  createdAt: string;
  updatedAt: string;
  versionHistory?: PromptVersion[]; // For versioning
  currentVersion?: number; // For versioning
  temperature?: number; // For current version
  topP?: number; // For current version
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type ModalType = 'project' | 'prompt' | 'globalSearch' | 'settings'; // Added settings
export type ModalMode = 'new' | 'edit' | 'view'; 

export interface ModalState {
  type: ModalType;
  mode: ModalMode;
  data?: Project | Prompt | AppSettings; // Data for editing, including AppSettings
  currentProjectId?: string; // For creating new prompt under a specific project
}

// For Notification System
export interface NotificationState {
  id:string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

// For Confirmation Modal
export interface ConfirmationModalState {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
}

// For Prompt Sorting
export interface PromptSortConfig {
  field: 'title' | 'createdAt' | 'updatedAt';
  direction: 'asc' | 'desc';
}

// For Global Search
export interface GlobalSearchResultItem {
  type: 'project' | 'prompt';
  item: Project | Prompt;
  // Optional: add a relevance score if implementing more complex search ranking
  // relevanceScore?: number; 
}

// For App Settings (Custom Gemini Instructions & Model Config)
export interface AppSettings {
  geminiApiKey: string;
  geminiRefineInstruction: string;
  geminiGenerateInstruction: string;
  geminiTagSuggestionInstruction: string; // New setting for tag suggestions
  defaultGeminiModelId: string; // Active model ID for Gemini calls
  availableGeminiModelIds: string[]; // List of available model IDs
}

// For transient file attachments
export interface AttachedFile {
  name: string;
  mimeType: string;
  data: string; // base64 encoded string
}