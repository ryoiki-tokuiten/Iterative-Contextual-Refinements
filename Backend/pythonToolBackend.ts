import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface SeedFile {
    name?: string;
    mimeType: string;
    base64: string;
}

interface PythonExecuteRequest {
    sessionId: string;
    code: string;
    files?: SeedFile[];
    timeoutMs?: number;
}

interface VisibleImage {
    filename: string;
    mimeType: string;
    size: number;
    url: string;
    base64?: string;
    modifiedMs: number;
}

type ImageSnapshot = Map<string, { size: number; modifiedMs: number }>;

interface PythonExecutionResult {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: string | null;
    durationMs: number;
    timedOut?: boolean;
    accessedImageFiles?: string[];
    writtenImageFiles?: string[];
}

interface PendingExecution {
    code: string;
    timeoutMs: number;
    resolve: (result: PythonExecutionResult) => void;
    reject: (error: Error) => void;
}

const BACKEND_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(BACKEND_DIR, 'Python_Environment', 'python_session_worker.py');
const VENV_PYTHON = process.platform === 'win32'
    ? path.join(BACKEND_DIR, 'Python_Environment', '.venv', 'Scripts', 'python.exe')
    : path.join(BACKEND_DIR, 'Python_Environment', '.venv', 'bin', 'python');
const VFS_ROOT = path.join(os.tmpdir(), 'iterative-studio-python-vfs');
const ARTIFACT_ROOT = path.join(os.tmpdir(), 'iterative-studio-python-artifacts');
const MAX_BODY_BYTES = 80 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const APP_BASE_PATH = '/Iterative-Contextual-Refinements';
const SESSION_IDLE_TTL_MS = 20 * 60_000;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, message: string) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(message);
}

function isSafeSessionId(sessionId: string): boolean {
    return /^[a-zA-Z0-9_-]{8,80}$/.test(sessionId);
}

function getWorkspacePath(sessionId: string): string {
    if (!isSafeSessionId(sessionId)) {
        throw new Error('Invalid Python tool session id.');
    }
    return path.join(VFS_ROOT, sessionId);
}

function getMimeType(filename: string): string | null {
    return IMAGE_MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? null;
}

function normalizeApiPathname(pathname: string): string {
    if (pathname.startsWith(`${APP_BASE_PATH}/api/python/`)) {
        return pathname.slice(APP_BASE_PATH.length);
    }
    return pathname;
}

function extensionForMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/gif':
            return '.gif';
        case 'image/webp':
            return '.webp';
        case 'image/bmp':
            return '.bmp';
        case 'image/tiff':
            return '.tiff';
        case 'image/png':
        default:
            return '.png';
    }
}

function sanitizeFilename(name: string | undefined, mimeType: string, index: number): string {
    const fallback = `uploaded-image-${index + 1}${extensionForMimeType(mimeType)}`;
    const base = path.basename(name || fallback).replace(/[^\w.\- ()]/g, '_');
    const withName = base || fallback;
    return path.extname(withName) ? withName : `${withName}${extensionForMimeType(mimeType)}`;
}

function safeJoin(workspace: string, relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error('Invalid virtual filesystem path.');
    }
    const resolved = path.resolve(workspace, normalized);
    const root = path.resolve(workspace);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error('Path escapes the virtual filesystem.');
    }
    return resolved;
}

async function fileExists(filename: string): Promise<boolean> {
    try {
        await access(filename);
        return true;
    } catch {
        return false;
    }
}

async function getPythonExecutable(): Promise<string> {
    if (process.env.ITERATIVE_STUDIO_PYTHON) {
        return process.env.ITERATIVE_STUDIO_PYTHON;
    }
    if (await fileExists(VENV_PYTHON)) {
        return VENV_PYTHON;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks: Buffer[] = [];

        req.on('data', chunk => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('Python tool request is too large.'));
                req.destroy();
                return;
            }
            chunks.push(buffer);
        });

        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function seedWorkspaceFiles(workspace: string, files: SeedFile[] | undefined) {
    if (!files?.length) return;

    await mkdir(workspace, { recursive: true });
    const usedNames = new Set<string>();

    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!file?.mimeType?.startsWith('image/') || !file.base64) continue;

        let filename = sanitizeFilename(file.name, file.mimeType, index);
        const ext = path.extname(filename);
        const stem = ext ? filename.slice(0, -ext.length) : filename;
        let suffix = 1;
        while (usedNames.has(filename)) {
            filename = `${stem}-${suffix}${ext}`;
            suffix++;
        }
        usedNames.add(filename);

        const destination = safeJoin(workspace, filename);
        if (await fileExists(destination)) continue;
        await writeFile(destination, Buffer.from(file.base64, 'base64'));
    }
}

async function listImageFiles(
    workspace: string,
    sessionId: string,
    includeBase64: boolean,
    currentDir = workspace
): Promise<VisibleImage[]> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    const images: VisibleImage[] = [];

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        const relativePath = path.relative(workspace, absolutePath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            if (relativePath.split('/').length < 4) {
                images.push(...await listImageFiles(workspace, sessionId, includeBase64, absolutePath));
            }
            continue;
        }

        if (!entry.isFile()) continue;
        const mimeType = getMimeType(entry.name);
        if (!mimeType) continue;

        const fileStat = await stat(absolutePath);

        const item: VisibleImage = {
            filename: relativePath,
            mimeType,
            size: fileStat.size,
            modifiedMs: fileStat.mtimeMs,
            url: `/api/python/files/${encodeURIComponent(sessionId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`,
        };

        if (includeBase64) {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
                const stream = createReadStream(absolutePath);
                stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            item.base64 = Buffer.concat(chunks).toString('base64');
        }

        images.push(item);
    }

    return images.sort((a, b) => a.filename.localeCompare(b.filename));
}

function snapshotImages(images: VisibleImage[]): ImageSnapshot {
    return new Map(images.map(image => [image.filename, { size: image.size, modifiedMs: image.modifiedMs }]));
}

function getChangedImages(before: ImageSnapshot, after: VisibleImage[]): VisibleImage[] {
    return after.filter(image => {
        const previous = before.get(image.filename);
        if (!previous) return true;
        return previous.size !== image.size || Math.abs(previous.modifiedMs - image.modifiedMs) > 1;
    });
}

function getAccessedImages(accessedFilenames: string[] | undefined, images: VisibleImage[]): VisibleImage[] {
    if (!accessedFilenames?.length) return [];

    const requested = new Set(accessedFilenames.map(filename => filename.replace(/\\/g, '/')));
    return images.filter(image => requested.has(image.filename));
}

function mergeImages(...groups: VisibleImage[][]): VisibleImage[] {
    const merged = new Map<string, VisibleImage>();
    groups.flat().forEach(image => {
        merged.set(image.filename, image);
    });
    return [...merged.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

async function snapshotImagesForTranscript(workspace: string, images: VisibleImage[]): Promise<VisibleImage[]> {
    if (images.length === 0) return [];

    const artifactId = randomUUID();
    const artifactWorkspace = path.join(ARTIFACT_ROOT, artifactId);

    return Promise.all(images.map(async image => {
        const source = safeJoin(workspace, image.filename);
        const destination = safeJoin(artifactWorkspace, image.filename);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);

        return {
            ...image,
            url: `/api/python/artifacts/${encodeURIComponent(artifactId)}/${image.filename.split('/').map(encodeURIComponent).join('/')}`,
        };
    }));
}

class PythonSession {
    private child: ChildProcessWithoutNullStreams | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    private queue: PendingExecution[] = [];
    private active: PendingExecution | null = null;
    private activeTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private closed = false;

    constructor(
        private readonly sessionId: string,
        private readonly workspace: string,
        private readonly python: string,
        private readonly onDispose: (sessionId: string, session: PythonSession) => void
    ) {}

    execute(code: string, timeoutMs: number): Promise<PythonExecutionResult> {
        if (this.closed) {
            return Promise.reject(new Error('Python session has already closed.'));
        }

        return new Promise((resolve, reject) => {
            this.queue.push({
                code,
                timeoutMs: Math.max(1_000, Math.min(timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)),
                resolve,
                reject,
            });
            void this.processQueue();
        });
    }

    dispose() {
        this.closed = true;
        this.clearIdleTimer();
        this.clearActiveTimer();

        const error = new Error('Python session was closed.');
        if (this.active) {
            this.active.reject(error);
            this.active = null;
        }
        while (this.queue.length > 0) {
            this.queue.shift()?.reject(error);
        }

        if (this.child && !this.child.killed) {
            this.child.kill('SIGKILL');
        }
        this.child = null;
        this.onDispose(this.sessionId, this);
    }

    private async processQueue() {
        if (this.active || this.closed || this.queue.length === 0) return;

        this.active = this.queue.shift() ?? null;
        if (!this.active) return;

        try {
            await this.ensureStarted();
            this.stderrBuffer = '';
            this.startActiveTimer(this.active);
            this.child!.stdin.write(JSON.stringify({ code: this.active.code }) + '\n');
        } catch (error) {
            const active = this.active;
            this.active = null;
            active.reject(error instanceof Error ? error : new Error('Failed to run Python code.'));
            void this.processQueue();
        }
    }

    private async ensureStarted() {
        this.clearIdleTimer();
        if (this.child && !this.child.killed) return;

        await mkdir(this.workspace, { recursive: true });
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.child = spawn(this.python, [RUNNER_PATH], {
            cwd: this.workspace,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                HOME: this.workspace,
                VIRTUAL_FS_ROOT: this.workspace,
                MPLBACKEND: 'Agg',
                MPLCONFIGDIR: path.join(this.workspace, '.matplotlib'),
                PYTHONUNBUFFERED: '1',
            },
        });

        this.child.stdout.on('data', chunk => this.handleStdout(chunk.toString()));
        this.child.stderr.on('data', chunk => { this.stderrBuffer += chunk.toString(); });
        this.child.on('error', error => this.failActive(error));
        this.child.on('close', () => {
            this.child = null;
            if (this.closed) return;
            this.failActive(new Error(this.stderrBuffer.trim() || 'Python session process exited unexpectedly.'));
        });
    }

    private handleStdout(chunk: string) {
        this.stdoutBuffer += chunk;

        while (true) {
            const newlineIndex = this.stdoutBuffer.indexOf('\n');
            if (newlineIndex === -1) return;

            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
            if (!line) continue;
            this.resolveActiveLine(line);
        }
    }

    private resolveActiveLine(line: string) {
        const active = this.active;
        if (!active) return;

        this.clearActiveTimer();
        this.active = null;

        try {
            active.resolve(JSON.parse(line) as PythonExecutionResult);
        } catch {
            active.resolve({
                ok: false,
                exitCode: 1,
                stdout: '',
                stderr: this.stderrBuffer,
                error: 'Python runner returned invalid JSON.',
                durationMs: 0,
            });
        }

        this.armIdleTimer();
        void this.processQueue();
    }

    private failActive(error: Error) {
        const active = this.active;
        this.clearActiveTimer();
        this.active = null;

        if (active) {
            active.resolve({
                ok: false,
                exitCode: 1,
                stdout: '',
                stderr: this.stderrBuffer,
                error: error.message,
                durationMs: 0,
            });
        }

        if (this.queue.length > 0) {
            const queued = this.queue.splice(0);
            queued.forEach(item => item.reject(new Error('Python session ended before queued execution could run.')));
        }

        this.dispose();
    }

    private startActiveTimer(active: PendingExecution) {
        this.clearActiveTimer();
        this.activeTimer = setTimeout(() => {
            const timedOutExecution = this.active;
            this.active = null;
            timedOutExecution?.resolve({
                ok: false,
                exitCode: 124,
                stdout: '',
                stderr: this.stderrBuffer,
                error: `Python execution timed out after ${Math.round(active.timeoutMs / 1000)} seconds. The agent Python session was restarted, so Python variables/imports from that session were cleared; virtual filesystem image files remain.`,
                timedOut: true,
                durationMs: active.timeoutMs,
            });
            this.dispose();
        }, active.timeoutMs);
    }

    private armIdleTimer() {
        this.clearIdleTimer();
        if (this.queue.length > 0 || this.active || this.closed) return;
        this.idleTimer = setTimeout(() => this.dispose(), SESSION_IDLE_TTL_MS);
    }

    private clearActiveTimer() {
        if (this.activeTimer) {
            clearTimeout(this.activeTimer);
            this.activeTimer = null;
        }
    }

    private clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}

const pythonSessions = new Map<string, PythonSession>();

async function runPython(
    sessionId: string,
    workspace: string,
    code: string,
    timeoutMs: number
): Promise<PythonExecutionResult> {
    const python = await getPythonExecutable();
    let session = pythonSessions.get(sessionId);

    if (!session) {
        session = new PythonSession(sessionId, workspace, python, (disposedSessionId, disposedSession) => {
            if (pythonSessions.get(disposedSessionId) === disposedSession) {
                pythonSessions.delete(disposedSessionId);
            }
        });
        pythonSessions.set(sessionId, session);
    }

    return session.execute(code, timeoutMs);
}

async function handleExecute(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
        return;
    }

    const rawBody = await readRequestBody(req);
    const payload = JSON.parse(rawBody) as PythonExecuteRequest;
    const workspace = getWorkspacePath(payload.sessionId);

    await mkdir(workspace, { recursive: true });
    await seedWorkspaceFiles(workspace, payload.files);

    const beforeImages = snapshotImages(await listImageFiles(workspace, payload.sessionId, false));
    const execution = await runPython(payload.sessionId, workspace, payload.code, payload.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const imagesAfterExecution = await listImageFiles(workspace, payload.sessionId, true);
    const visibleFiles = await listImageFiles(workspace, payload.sessionId, false);
    const changedImages = getChangedImages(beforeImages, imagesAfterExecution);
    const writtenImages = getAccessedImages(execution.writtenImageFiles, imagesAfterExecution);
    const viewedImages = getAccessedImages(execution.accessedImageFiles, imagesAfterExecution);
    const generatedImages = mergeImages(changedImages, writtenImages);
    const generatedTranscriptImages = await snapshotImagesForTranscript(workspace, generatedImages);
    const viewedTranscriptImages = await snapshotImagesForTranscript(workspace, viewedImages);

    sendJson(res, 200, {
        ...execution,
        sessionId: payload.sessionId,
        images: generatedTranscriptImages,
        viewedImages: viewedTranscriptImages,
        visibleFiles,
    });
}

async function handleFileRequest(pathname: string, res: ServerResponse) {
    const prefix = '/api/python/files/';
    const encodedRest = pathname.slice(prefix.length);
    const slashIndex = encodedRest.indexOf('/');

    if (slashIndex === -1) {
        sendText(res, 404, 'Image file not found.');
        return;
    }

    const sessionId = decodeURIComponent(encodedRest.slice(0, slashIndex));
    const relativePath = encodedRest
        .slice(slashIndex + 1)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
    const workspace = getWorkspacePath(sessionId);
    const absolutePath = safeJoin(workspace, relativePath);
    const mimeType = getMimeType(absolutePath);

    if (!mimeType || !(await fileExists(absolutePath))) {
        sendText(res, 404, 'Image file not found.');
        return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', mimeType);
    res.setHeader('cache-control', 'no-store');
    createReadStream(absolutePath).pipe(res);
}

async function handleArtifactRequest(pathname: string, res: ServerResponse) {
    const prefix = '/api/python/artifacts/';
    const encodedRest = pathname.slice(prefix.length);
    const slashIndex = encodedRest.indexOf('/');

    if (slashIndex === -1) {
        sendText(res, 404, 'Image artifact not found.');
        return;
    }

    const artifactId = decodeURIComponent(encodedRest.slice(0, slashIndex));
    if (!isSafeSessionId(artifactId)) {
        sendText(res, 404, 'Image artifact not found.');
        return;
    }

    const relativePath = encodedRest
        .slice(slashIndex + 1)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
    const artifactWorkspace = path.join(ARTIFACT_ROOT, artifactId);
    const absolutePath = safeJoin(artifactWorkspace, relativePath);
    const mimeType = getMimeType(absolutePath);

    if (!mimeType || !(await fileExists(absolutePath))) {
        sendText(res, 404, 'Image artifact not found.');
        return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', mimeType);
    res.setHeader('cache-control', 'no-store');
    createReadStream(absolutePath).pipe(res);
}

export async function handlePythonBackendRequest(
    req: IncomingMessage,
    res: ServerResponse
): Promise<boolean> {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = normalizeApiPathname(parsedUrl.pathname);

    try {
        if (pathname === '/api/python/execute') {
            await handleExecute(req, res);
            return true;
        }

        if (pathname.startsWith('/api/python/files/')) {
            await handleFileRequest(pathname, res);
            return true;
        }

        if (pathname.startsWith('/api/python/artifacts/')) {
            await handleArtifactRequest(pathname, res);
            return true;
        }

        return false;
    } catch (error) {
        sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : 'Python backend error.',
        });
        return true;
    }
}
