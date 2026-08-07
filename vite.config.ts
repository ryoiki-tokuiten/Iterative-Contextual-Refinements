import path from 'path';
import { defineConfig, loadEnv, type PreviewServer, type ViteDevServer } from 'vite';
import { handleOpenAICompatibleProxyRequest } from './Backend/openAICompatibleProxy';
import { handleSandboxBackendRequest } from './Backend/sandboxToolBackend';

function installBackendMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (req, res, next) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const basePath = server.config.base.replace(/\/$/, '');
    const isOpenAICompatibleRequest = pathname.startsWith('/api/openai-compatible/')
      || (basePath && pathname.startsWith(`${basePath}/api/openai-compatible/`));
    const isSandboxBackendRequest = pathname.startsWith('/api/sandbox/')
      || (basePath && pathname.startsWith(`${basePath}/api/sandbox/`));

    if (isOpenAICompatibleRequest) {
      const handled = await handleOpenAICompatibleProxyRequest(req, res, basePath);
      if (handled) return;
    }

    if (isSandboxBackendRequest) {
      const handled = await handleSandboxBackendRequest(req, res);
      if (handled) return;
    }

    next();
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [{
      name: 'iterative-studio-sandbox-backend',
      configureServer(server) {
        installBackendMiddleware(server);
      },
      configurePreviewServer(server) {
        installBackendMiddleware(server);
      },
    }],
    define: {
      'process.env.AI_API_KEY': JSON.stringify(env.AI_API_KEY || env.GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    server: {
      watch: {
        ignored: [
          '**/Forest-Fire-Detection/**',
          '**/.venv/**',
          '**/__pycache__/**',
          '**/*.pyc',
        ],
      },
    },
    base: '/Iterative-Contextual-Refinements/',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) {
              return; // Let app code be handled by default splitting
            }


            // AI Provider SDKs
            if (id.includes('@anthropic-ai') || id.includes('@google/genai') || id.includes('node_modules/openai')
              || id.includes('@ai-sdk') || id.includes('node_modules/ai')) {
                return 'vendor-ai';
            }
            // LangChain ecosystem
            if (id.includes('langchain') || id.includes('langsmith')) {
              return 'vendor-langchain';
            }
            // React core
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'vendor-react';
            }
            // Markdown/math rendering
            if (id.includes('remark-') || id.includes('rehype-') || id.includes('unified') ||
              id.includes('katex') || id.includes('react-markdown')) {
              return 'vendor-markdown';
            }
            // Diff utilities
            if (id.includes('diff2html') || id.includes('node_modules/diff/')) {
              return 'vendor-diff';
            }
            // Syntax highlighting (Shiki)
            if (id.includes('shiki') || id.includes('@shikijs')) {
              return 'vendor-shiki';
            }
            // Other utilities
            if (id.includes('nanoid')) {
              return 'vendor-utils';
            }
          }
        }
      }
    }
  };
});
