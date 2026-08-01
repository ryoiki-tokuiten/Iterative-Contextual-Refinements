import { globalState } from '../../../Core/State';
import { getEncoding } from 'js-tiktoken';
import { FileData } from '../../../Core/Types';

interface FileTypeConfig {
    icon: string;
    color: string;
    label: string;
}

const FILE_TYPE_CONFIG: Record<string, FileTypeConfig> = {
    'image/png': { icon: 'image', color: '#10b981', label: 'PNG' },
    'image/jpeg': { icon: 'image', color: '#10b981', label: 'JPG' },
    'image/gif': { icon: 'gif', color: '#8b5cf6', label: 'GIF' },
    'image/webp': { icon: 'image', color: '#10b981', label: 'WEBP' },
    'text/plain': { icon: 'description', color: '#6b7280', label: 'TXT' },
    'text/markdown': { icon: 'article', color: '#64748b', label: 'MD' },
    'text/html': { icon: 'code', color: '#f97316', label: 'HTML' },
    'text/csv': { icon: 'table_chart', color: '#22c55e', label: 'CSV' },
    'text/x-python': { icon: 'code', color: '#3776ab', label: 'PY' },
    'application/x-python': { icon: 'code', color: '#3776ab', label: 'PY' },
    'text/javascript': { icon: 'javascript', color: '#f7df1e', label: 'JS' },
    'application/javascript': { icon: 'javascript', color: '#f7df1e', label: 'JS' },
    'text/x-c++src': { icon: 'code', color: '#00599c', label: 'CPP' },
    'application/json': { icon: 'data_object', color: '#6b7280', label: 'JSON' },
};

/**
 * Source, markup, data, and configuration formats are all handled as UTF-8
 * text. Keeping this explicit makes the picker useful while also letting us
 * validate drag-and-drop, where the browser's `accept` hint is bypassed.
 */
const TEXT_FILE_EXTENSIONS = [
    '.txt', '.md', '.mdx', '.markdown', '.rst', '.adoc', '.asciidoc', '.log',
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.tex', '.bib',
    '.csv', '.tsv', '.json', '.jsonc', '.json5', '.ipynb', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.env', '.gitignore',
    '.py', '.pyi', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
    '.c', '.h', '.cc', '.cp', '.cpp', '.cxx', '.c++', '.hpp', '.hxx',
    '.rs', '.go', '.java', '.kt', '.kts', '.swift', '.cs', '.fs', '.fsx', '.vb',
    '.php', '.rb', '.rake', '.pl', '.pm', '.r', '.lua', '.dart', '.ex', '.exs',
    '.erl', '.hrl', '.hs', '.lhs', '.clj', '.cljs', '.cljc', '.scala', '.sc', '.groovy',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
    '.proto', '.sol', '.vue', '.svelte', '.astro', '.prisma', '.tf', '.hcl', '.dockerfile',
    '.asm', '.s', '.v', '.sv', '.vhd', '.vhdl', '.make', '.mk'
] as const;

const TEXT_EXTENSION_SET = new Set<string>(TEXT_FILE_EXTENSIONS);
const TEXT_FILE_NAMES = new Set(['dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile', 'jenkinsfile']);
const REMOVED_BINARY_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.mp4', '.m4v', '.mov', '.webm', '.avi', '.mkv', '.wmv', '.flv', '.mpeg', '.mpg', '.3gp',
    '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma', '.aiff', '.opus',
]);
const REMOVED_BINARY_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
    '.json': 'application/json',
    '.jsonc': 'application/json',
    '.json5': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.md': 'text/markdown',
    '.mdx': 'text/markdown',
    '.markdown': 'text/markdown',
    '.py': 'text/x-python',
    '.pyi': 'text/x-python',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.cjs': 'text/javascript',
    '.jsx': 'text/javascript',
    '.cpp': 'text/x-c++src',
    '.cc': 'text/x-c++src',
    '.cp': 'text/x-c++src',
    '.cxx': 'text/x-c++src',
    '.c++': 'text/x-c++src',
};

export const ACCEPTED_FILES = ['image/*', 'text/*', ...TEXT_FILE_EXTENSIONS].join(',');

const SIZE_WARNING_THRESHOLD = 15 * 1024 * 1024;
export const DIRECT_CONTEXT_TOKEN_LIMIT = 50_000;
export const DIRECT_CONTEXT_MEDIA_LIMITS = {
    images: 20,
} as const;

function getFileExtension(fileName: string): string {
    const normalized = fileName.trim().toLowerCase();
    const lastDot = normalized.lastIndexOf('.');
    return lastDot >= 0 ? normalized.slice(lastDot) : '';
}

export function getFileConfig(mimeType: string, fileName = ''): FileTypeConfig {
    const configured = FILE_TYPE_CONFIG[mimeType];
    const extension = getFileExtension(fileName);
    if (configured && !(mimeType === 'text/plain' && extension && extension !== '.txt')) return configured;
    if (isImage(mimeType)) return { icon: 'image', color: '#10b981', label: getFileExtension(fileName).slice(1).toUpperCase() || 'IMAGE' };
    if (isText(mimeType)) return { icon: 'code', color: '#64748b', label: getFileExtension(fileName).slice(1).toUpperCase() || 'TEXT' };
    return { icon: 'insert_drive_file', color: '#6b7280', label: 'FILE' };
}

export function isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

export function isText(mimeType: string): boolean {
    return mimeType.startsWith('text/') || mimeType === 'application/json';
}

function isSupportedUploadFile(file: Pick<File, 'name' | 'type'>): boolean {
    const normalizedName = file.name.trim().toLowerCase();
    const extension = getFileExtension(normalizedName);
    if (file.type.startsWith('video/') || file.type.startsWith('audio/') || REMOVED_BINARY_MIME_TYPES.has(file.type) || REMOVED_BINARY_EXTENSIONS.has(extension)) {
        return false;
    }
    return file.type.startsWith('image/')
        || file.type.startsWith('text/')
        || TEXT_EXTENSION_SET.has(extension)
        || TEXT_FILE_NAMES.has(normalizedName);
}

function getNormalizedUploadMimeType(file: File): string {
    if (file.type.startsWith('image/')) return file.type;
    const extension = getFileExtension(file.name);
    if (file.type.startsWith('text/')) return file.type;
    if (TEXT_EXTENSION_SET.has(extension)) {
        return TEXT_MIME_BY_EXTENSION[extension] || 'text/plain';
    }
    return file.type;
}

/** Count text exactly; images use an explicit item limit instead of an estimate. */
export function countFileTokens(files: FileData[]): number {
    const encoding = getEncoding('cl100k_base');
    // js-tiktoken is pure JavaScript. Unlike the WASM tiktoken bindings it
    // does not expose a `free()` method.
    return files.reduce((total, file) => (
        isText(file.mimeType) ? total + encoding.encode(decodeBase64Content(file.base64)).length : total
    ), 0);
}

export function getMediaCounts(files: FileData[]) {
    return files.reduce((counts, file) => {
        if (isImage(file.mimeType)) counts.images++;
        return counts;
    }, { images: 0 });
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function calculateTotalSize(files: FileData[]): number {
    return files.reduce((sum, f) => sum + f.size, 0);
}

export function isSizeWarning(totalSize: number): boolean {
    return totalSize > SIZE_WARNING_THRESHOLD;
}

export function decodeBase64Content(base64: string): string {
    try {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch {
        return 'Unable to decode file content';
    }
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
        return {
            mimeType: matches[1],
            base64: matches[2],
        };
    }
    return null;
}

function createFileData(mimeType: string, base64: string, name: string, size: number): FileData {
    return { mimeType, base64, name, size };
}

function processFile(file: File): Promise<FileData> {
    if (!isSupportedUploadFile(file)) {
        return Promise.reject(new Error(`Unsupported file type: ${file.name}`));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            const parsed = parseDataUrl(result);
            if (parsed) {
                const fileData = createFileData(getNormalizedUploadMimeType(file), parsed.base64, file.name, file.size);
                resolve(fileData);
            } else {
                reject(new Error('Invalid file format'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

export function processFiles(fileList: FileList | File[]): Promise<FileData[]> {
    const promises = Array.from(fileList).map(file => processFile(file));
    return Promise.all(promises);
}

export function updateGlobalStateWithFiles(directFiles: FileData[], filesystemFiles: FileData[] = globalState.filesystemContextFiles): void {
    globalState.directContextFiles = directFiles;
    globalState.filesystemContextFiles = filesystemFiles;
}

export function clearGlobalStateFiles(): void {
    globalState.directContextFiles = [];
    globalState.filesystemContextFiles = [];
}

export function resetFileInput(inputRef: React.RefObject<HTMLInputElement | null>): void {
    if (inputRef.current) {
        inputRef.current.value = '';
    }
}
