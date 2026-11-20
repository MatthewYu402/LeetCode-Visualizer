/// <reference types="vite/client" />

/** The app's version from package.json ("1.0.0-beta.1"), put in by vite.config.ts at build time. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** The API's origin when the page is served from another host (api/client.ts); unset in development. */
  readonly VITE_API_BASE?: string;
}
