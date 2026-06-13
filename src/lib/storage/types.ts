// Abstração de storage de arquivos.
// Permite trocar o backend (local agora → Digital Ocean Spaces depois)
// sem alterar o código da aplicação que faz upload/download.

export interface PutOptions {
  contentType?: string;
}

export interface StoredFile {
  /** Chave/caminho lógico do arquivo dentro do storage. */
  key: string;
  size: number;
}

export interface StorageProvider {
  /** Salva um arquivo e retorna sua chave. */
  put(key: string, data: Buffer | Uint8Array, opts?: PutOptions): Promise<StoredFile>;
  /** Lê o conteúdo de um arquivo. */
  get(key: string): Promise<Buffer>;
  /** Remove um arquivo. */
  delete(key: string): Promise<void>;
  /** Verifica se um arquivo existe. */
  exists(key: string): Promise<boolean>;
}
