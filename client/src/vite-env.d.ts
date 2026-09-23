/// <reference types="vite/client" />

/**
 * Typed view of the client's environment.
 *
 * Only `VITE_`-prefixed variables are inlined into the bundle, so everything
 * here is public by definition - never add a secret. Declaring the shape means
 * a typo in a variable name is a compile error rather than `undefined` at
 * runtime.
 */
interface ImportMetaEnv {
  /**
   * Socket.io endpoint. Points straight at the API origin, because a Vercel
   * rewrite cannot proxy a WebSocket upgrade. Falls back to the current
   * origin, which is correct in dev where Vite proxies /socket.io.
   */
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
