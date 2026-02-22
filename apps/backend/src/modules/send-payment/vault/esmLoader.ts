/**
 * Load ESM module at runtime from CJS. Uses Function so SWC does not rewrite
 * dynamic import() to require() (which fails for ESM-only packages like privacycash).
 */
export function importEsm<T = unknown>(spec: string): Promise<T> {
  return new Function('spec', 'return import(spec)')(spec) as Promise<T>;
}
