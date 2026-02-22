/**
 * Base path for ZK circuit files (transaction2.wasm and transaction2.zkey).
 * Prefer in-repo apps/backend/circuit2/ (so we can build from it); then env override; then node_modules.
 */
import * as path from 'path';
import * as fs from 'fs';

/** Candidate in-repo paths: from dist (__dirname) and from cwd (run from apps/backend or repo root). */
function getInRepoCircuitCandidates(): string[] {
  const candidates: string[] = [];
  const fromDist = path.join(__dirname, '..', '..', '..', '..', '..', 'circuit2', 'transaction2');
  candidates.push(path.resolve(fromDist));
  candidates.push(path.resolve(process.cwd(), 'circuit2', 'transaction2'));
  candidates.push(path.resolve(process.cwd(), 'apps', 'backend', 'circuit2', 'transaction2'));
  return candidates;
}

function findExistingCircuitBasePath(): string | null {
  for (const base of getInRepoCircuitCandidates()) {
    if (fs.existsSync(`${base}.wasm`) && fs.existsSync(`${base}.zkey`)) {
      return base;
    }
  }
  return null;
}

export function getCircuitBasePath(): string {
  const envPath = process.env.PRIVACYCASH_CIRCUIT_BASE_PATH;
  if (envPath?.trim()) {
    return path.resolve(envPath.trim());
  }
  const inRepo = findExistingCircuitBasePath();
  if (inRepo) {
    return inRepo;
  }
  try {
    const packagePath = require.resolve('privacycash/package.json');
    const privacycashRoot = path.dirname(packagePath);
    return path.join(privacycashRoot, 'circuit2', 'transaction2');
  } catch {
    return path.join(process.cwd(), 'node_modules', 'privacycash', 'circuit2', 'transaction2');
  }
}

let cachedPath: string | null = null;
export function getCircuitBasePathCached(): string {
  if (!cachedPath) cachedPath = getCircuitBasePath();
  return cachedPath;
}

/** Throw a clear error if circuit files are missing (npm package does not ship them). */
export function assertCircuitFilesExist(basePath: string): void {
  const wasm = `${basePath}.wasm`;
  const zkey = `${basePath}.zkey`;
  if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) {
    throw new Error(
      `Privacy Cash ZK circuit files not found. Expected ${wasm} and ${zkey}. ` +
        'Put transaction2.wasm and transaction2.zkey in apps/backend/circuit2/ (see that folder README), or set PRIVACYCASH_CIRCUIT_BASE_PATH to their base path (e.g. /path/to/circuit2/transaction2).',
    );
  }
}
