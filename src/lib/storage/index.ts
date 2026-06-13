import path from "node:path";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoredFile, PutOptions } from "./types";

let instance: StorageProvider | null = null;

/**
 * Retorna o StorageProvider configurado via env (STORAGE_DRIVER).
 * - "local"  → sistema de arquivos (dev/teste)
 * - "spaces" → Digital Ocean Spaces (a implementar antes do deploy)
 */
export function getStorage(): StorageProvider {
  if (instance) return instance;

  const driver = process.env.STORAGE_DRIVER ?? "local";

  switch (driver) {
    case "local": {
      const dir = process.env.STORAGE_LOCAL_DIR ?? "./.storage";
      instance = new LocalStorageProvider(path.resolve(process.cwd(), dir));
      return instance;
    }
    case "spaces":
      // TODO(Fase 7): implementar SpacesStorageProvider (S3-compatible).
      throw new Error('STORAGE_DRIVER="spaces" ainda não implementado.');
    default:
      throw new Error(`STORAGE_DRIVER desconhecido: ${driver}`);
  }
}
