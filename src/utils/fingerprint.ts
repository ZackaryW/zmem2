import { createHash } from 'node:crypto';

/** SHA-256 of version tag followed by uint64-BE length framed bytes. */
export function fingerprint(parts: readonly Uint8Array[]): string {
  const hash = createHash('sha256').update('zmem-framed-v1\0');
  for (const part of parts) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(part.byteLength));
    hash.update(length).update(part);
  }
  return hash.digest('hex');
}
