import { createHash } from 'node:crypto';

/**
 * Fixture-local audio object store + content validation.
 *
 * In fixture mode chunks are staged here (never on disk paths derived from
 * client input — the storage object key is SERVER-issued by begin_recording).
 * Content is validated before processing (Milestone 1, req 3): declared
 * content type must match the actual container magic bytes, sizes are capped
 * by the capture authorization, and completion recomputes the SHA-256
 * server-side rather than trusting the client's digest.
 */

export interface StagedObject {
  chunks: Buffer[];
  totalBytes: number;
  contentType: string | null;
}

const MAGIC: Array<{ type: string; test: (b: Buffer) => boolean }> = [
  { type: 'audio/webm', test: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { type: 'audio/ogg', test: (b) => b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'OggS' },
  {
    type: 'audio/wav',
    test: (b) =>
      b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE',
  },
  {
    type: 'audio/mp4',
    test: (b) => b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp',
  },
  {
    type: 'audio/mpeg',
    test: (b) =>
      (b.length >= 3 && b.subarray(0, 3).toString('latin1') === 'ID3') ||
      (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  },
];

/** Identify the audio container from leading bytes; null = unrecognized. */
export function sniffAudioContainer(head: Buffer): string | null {
  for (const m of MAGIC) if (m.test(head)) return m.type;
  return null;
}

export class FixtureAudioStore {
  private objects = new Map<string, StagedObject>();

  appendChunk(objectKey: string, bytes: Buffer, contentType: string, maxBytes: number): { totalBytes: number } {
    const existing = this.objects.get(objectKey) ?? { chunks: [], totalBytes: 0, contentType };
    if (existing.totalBytes + bytes.length > maxBytes) {
      throw new Error('staged object exceeds the authorized maximum size');
    }
    existing.chunks.push(bytes);
    existing.totalBytes += bytes.length;
    existing.contentType = contentType;
    this.objects.set(objectKey, existing);
    return { totalBytes: existing.totalBytes };
  }

  has(objectKey: string): boolean {
    return this.objects.has(objectKey);
  }

  size(objectKey: string): number {
    return this.objects.get(objectKey)?.totalBytes ?? 0;
  }

  /** Recompute the digest server-side — the client's claim is never trusted. */
  sha256(objectKey: string): string | null {
    const obj = this.objects.get(objectKey);
    if (!obj) return null;
    const h = createHash('sha256');
    for (const c of obj.chunks) h.update(c);
    return h.digest('hex');
  }

  head(objectKey: string): Buffer | null {
    const obj = this.objects.get(objectKey);
    if (!obj || obj.chunks.length === 0) return null;
    return obj.chunks[0].subarray(0, 16);
  }

  /**
   * Deletion (deletion-worker 'local' target). Idempotent: deleting an
   * already-absent object still returns a confirmation — the outcome (object
   * not present) is what the workflow certifies.
   */
  delete(objectKey: string): { confirmation: string } {
    this.objects.delete(objectKey);
    return { confirmation: `local-purge:${createHash('sha256').update(objectKey).digest('hex').slice(0, 16)}` };
  }

  clear(): void {
    this.objects.clear();
  }
}

/** Process-wide store instance (fixture mode only). */
export const fixtureAudioStore = new FixtureAudioStore();
