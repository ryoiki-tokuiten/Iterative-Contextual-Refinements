import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { handleSandboxBackendRequest } from './Backend/sandboxToolBackend';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [{
      name: 'iterative-studio-sandbox-backend',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = new URL(req.url || '/', 'http://localhost').pathname;
          const basePath = server.config.base.replace(/\/$/, '');
          const isSandboxBackendRequest = pathname.startsWith('/api/sandbox/')
            || (basePath && pathname.startsWith(`${basePath}/api/sandbox/`));

          if (!isSandboxBackendRequest) {
            next();
            return;
          }

          const handled = await handleSandboxBackendRequest(req, res);
          if (!handled) next();
        });
      }
    }],
    define: {
      'process.env.AI_API_KEY': JSON.stringify(env.AI_API_KEY || env.GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.NVIDIA_API_KEY': JSON.stringify(env.NVIDIA_API_KEY),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
      'process.env.OPENROUTER_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    server: {
      proxy: {
        '/Iterative-Contextual-Refinements/api/nvidia': {
          target: 'https://integrate.api.nvidia.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/Iterative-Contextual-Refinements\/api\/nvidia/, ''),
        },
        '/api/nvidia': {
          target: 'https://integrate.api.nvidia.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/nvidia/, ''),
        }
      },
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
            if (id.includes('@anthropic-ai') || id.includes('@google/genai') || id.includes('node_modules/openai')) {
              return 'vendor-ai';
            }
            // LangChain ecosystem
            if (id.includes('langchain') || id.includes('langsmith')) {
              return 'vendor-langchain';
            }
            // PDF processing
            if (id.includes('pdfjs-dist')) {
              return 'vendor-pdf';
            }
            // React core
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'vendor-react';
            }
            // Markdown/math rendering
            if (id.includes('remark-') || id.includes('rehype-') || id.includes('unified') ||
              id.includes('katex') || id.includes('react-markdown') || id.includes('node_modules/marked')) {
              return 'vendor-markdown';
            }
            // Diff utilities
            if (id.includes('diff-match-patch') || id.includes('diff2html') || id.includes('node_modules/diff/')) {
              return 'vendor-diff';
            }
            // Syntax highlighting (Shiki)
            if (id.includes('shiki') || id.includes('@shikijs')) {
              return 'vendor-shiki';
            }
            // Other utilities
            if (id.includes('jszip') || id.includes('nanoid') || id.includes('fuzzball') || id.includes('fast-')) {
              return 'vendor-utils';
            }
          }
        }
      }
    }
  };
});
