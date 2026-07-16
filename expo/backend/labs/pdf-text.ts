import { extractText, getDocumentProxy } from 'unpdf';

/**
 * PDF → per-page text via unpdf (serverless pdf.js build; no canvas, no
 * network). Throws on unreadable/encrypted input — the caller maps that to
 * the mark_lab_document_failed('unreadable_pdf') path.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(bytes);
  try {
    const { text } = await extractText(doc, { mergePages: false });
    return (Array.isArray(text) ? text : [String(text ?? '')]).map((t) => t ?? '');
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/** True when the buffer starts with the %PDF magic bytes. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}
