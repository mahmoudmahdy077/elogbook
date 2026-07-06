'use client';

import { useEffect, useRef, useState } from 'react';

export default function ApiDocsPage() {
  const swaggerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;

    // Load Swagger UI bundle from CDN
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';
    script.async = true;
    script.onload = () => {
      setLoaded(true);
    };
    script.onerror = () => {
      setError('Failed to load Swagger UI. Check your internet connection.');
    };
    document.body.appendChild(script);

    // Load Swagger UI CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(link);

    return () => {
      // Cleanup
      document.body.removeChild(script);
      document.head.removeChild(link);
    };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !swaggerRef.current) return;
    if ((window as any).SwaggerUIBundle) {
      (window as any).SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          (window as any).SwaggerUIBundle.presets.apis,
          (window as any).SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: 'BaseLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true,
      });
    }
  }, [loaded]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">API Documentation</h1>
          <p className="text-red-400">{error}</p>
          <a
            href="/openapi.yaml"
            className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Download openapi.yaml directly
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              E-Logbook Enterprise API
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              OpenAPI 3.0 — Interactive documentation
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/openapi.yaml"
              download
              className="text-sm px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Download YAML
            </a>
            <a
              href="https://elogbook.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              elogbook.dev
            </a>
          </div>
        </div>
      </header>

      {/* Loading state */}
      {!loaded && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              Loading API documentation…
            </p>
          </div>
        </div>
      )}

      {/* Swagger UI container */}
      <div
        id="swagger-ui"
        ref={swaggerRef}
        className={loaded ? '' : 'hidden'}
        style={{ minHeight: 'calc(100vh - 56px)' }}
      />

      <style jsx global>{`
        /* Dark theme overrides for Swagger UI */
        .dark #swagger-ui {
          --swagger-color: #3b82f6;
        }
        .dark .swagger-ui .topbar { display: none; }
        .dark .swagger-ui .info .title { color: #f3f4f6 !important; }
        .dark .swagger-ui .info { margin: 20px 0; }
        .dark .swagger-ui .info a { color: #60a5fa; }
        .dark .swagger-ui .info p,
        .dark .swagger-ui .info li,
        .dark .swagger-ui .info table { color: #d1d5db; }
        .dark .swagger-ui .scheme-container { background: #1f2937; box-shadow: none; border: 1px solid #374151; }
        .dark .swagger-ui .opblock-tag { border-bottom: 1px solid #374151; color: #e5e7eb; }
        .dark .swagger-ui .opblock-tag:hover { background: rgba(55, 65, 81, 0.5); }
        .dark .swagger-ui .opblock { border: none; background: #111827; border-radius: 8px; overflow: hidden; }
        .dark .swagger-ui .opblock .opblock-summary { border-bottom: 1px solid #1f2937; }
        .dark .swagger-ui .opblock .opblock-summary-description { color: #9ca3af; }
        .dark .swagger-ui .opblock .opblock-summary-method { border-radius: 4px; }
        .dark .swagger-ui .opblock .opblock-section-header { background: #1f2937; border: none; }
        .dark .swagger-ui .opblock .opblock-section-header h4 { color: #e5e7eb; }
        .dark .swagger-ui .opblock-description-wrapper p { color: #d1d5db; }
        .dark .swagger-ui .opblock .parameter__name { color: #e5e7eb; }
        .dark .swagger-ui .opblock .parameter__type { color: #9ca3af; }
        .dark .swagger-ui .opblock .parameter__in { color: #6b7280; }
        .dark .swagger-ui table thead tr td, .dark .swagger-ui table thead tr th { border-bottom: 1px solid #374151; color: #9ca3af; }
        .dark .swagger-ui .response-col_status { color: #e5e7eb; }
        .dark .swagger-ui .response-col_description { color: #d1d5db; }
        .dark .swagger-ui .responses-inner h4, .dark .swagger-ui .responses-inner h5 { color: #e5e7eb; }
        .dark .swagger-ui .btn { border-color: #4b5563; color: #e5e7eb; }
        .dark .swagger-ui .btn:hover { background: #374151; }
        .dark .swagger-ui .btn.execute { background: #2563eb; border-color: #2563eb; }
        .dark .swagger-ui .btn.execute:hover { background: #1d4ed8; }
        .dark .swagger-ui select { background: #1f2937; color: #e5e7eb; border-color: #4b5563; }
        .dark .swagger-ui textarea { background: #1f2937; color: #e5e7eb; border-color: #4b5563; }
        .dark .swagger-ui input[type=text] { background: #1f2937; color: #e5e7eb; border-color: #4b5563; }
        .dark .swagger-ui .model-box { background: #1f2937; border-radius: 4px; }
        .dark .swagger-ui .model { color: #e5e7eb; }
        .dark .swagger-ui .model-title { color: #e5e7eb; }
        .dark .swagger-ui .model-toggle { color: #9ca3af; }
        .dark .swagger-ui .markdown p, .dark .swagger-ui .markdown li { color: #d1d5db; }
        .dark .swagger-ui .prop-type { color: #60a5fa; }
        .dark .swagger-ui .response table { background: transparent; }
        .dark .swagger-ui .response th { color: #9ca3af; }
        .dark .swagger-ui .response td { color: #d1d5db; }
        .swagger-ui .topbar { display: none; }
      `}</style>
    </div>
  );
}
