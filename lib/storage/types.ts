export interface PutInput { key: string; body: Buffer; contentType: string }

/** The single storage interface (spec 3.4). Route handlers never call SDKs directly. */
export interface StorageDriver {
  put(input: PutInput): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /** Server-side copy, so a forwarded attachment owns its own object and outlives the original (A73). */
  copy(sourceKey: string, destinationKey: string): Promise<{ key: string }>;
  /** Removes every object under a key prefix (a company's folder when the company is deleted). */
  deletePrefix(prefix: string): Promise<void>;
}
