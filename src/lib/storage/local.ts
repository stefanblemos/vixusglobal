import { promises as fs } from "node:fs";
import path from "node:path";
import type { PutOptions, StorageProvider, StoredFile } from "./types";

/**
 * Storage em sistema de arquivos local — para desenvolvimento/teste.
 * Em produção será substituído pelo provider de Digital Ocean Spaces (S3).
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    // Impede path traversal: normaliza e garante que fica dentro de baseDir.
    const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
    const full = path.join(this.baseDir, safe);
    if (!full.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`Chave de storage inválida: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer | Uint8Array, _opts?: PutOptions): Promise<StoredFile> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.writeFile(full, buf);
    return { key, size: buf.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
