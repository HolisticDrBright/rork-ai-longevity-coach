import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Lab PDF ingestion tests.
 *
 * parse.ts is pure and tested directly on synthetic lab-report text (layout
 * variants, flags, unit verbatim-ness, disambiguation, junk rejection).
 * pdf-text.ts is exercised against real PDF bytes BUILT AT RUNTIME (offsets
 * computed, so the fixture is always a valid PDF). The upload route is tested
 * through Hono's request() with the clinical Supabase clients mocked; the
 * ingest/fail RPCs themselves are proven against the live project by
 * AI_DESKTOP_PRO/supabase/tests/lab_ingestion.sql.
 */

import { parseLabPages, extractLabMeta, normalize, fold } from '../backend/labs/parse';
import { looksLikePdf, extractPdfPages } from '../backend/labs/pdf-text';

/* ------------------------------------------------------------- pdf fixture */

/** Minimal valid one-page PDF with the given text lines (offsets computed). */
function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    'BT /F1 10 Tf 40 760 Td 14 TL ' +
    lines.map((l, i) => (i ? 'T* ' : '') + '(' + esc(l) + ') Tj ').join('') +
    'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const QUEST_PAGE = [
  'Quest Diagnostics',
  'Patient: DOE, JANE   DOB: 01/01/1980',
  'Collected: 07/01/2026',
  'Phone: 555-0100   Accession: QD-123456',
  'Test Name              Result   Flag   Units    Reference Range',
  'hs-CRP 2.8 H mg/L Reference Range: <1.0',
  'Ferritin 96 ng/mL 30-400',
  'HDL Cholesterol 58 mg/dL >39',
  'Cholesterol, Total 212 H mg/dL 100-199',
  'Cortisol 12.4 µg/dL 6.2-19.4',
  'Osmolality: 285 mOsm/kg 275-295',
  'Page 1 of 2',
].join('\n');

/* ------------------------------------------------------------------ parser */

describe('parseLabPages', () => {
  test('extracts known markers with verbatim units, flags, and ranges', () => {
    const markers = parseLabPages([QUEST_PAGE]);
    const crp = markers.find((m) => m.name === 'hs-CRP');
    expect(crp).toBeDefined();
    expect(crp!.valueNumeric).toBe(2.8);
    expect(crp!.unit).toBe('mg/L'); // original casing, never lowercased
    expect(crp!.flag).toBe('H'); // flag between value and unit still parses
    expect(crp!.referenceInterval).toBe('<1.0');
    expect(crp!.page).toBe(1);
    expect(crp!.confidence).toBeGreaterThanOrEqual(0.9);

    const ferritin = markers.find((m) => m.name === 'Ferritin');
    expect(ferritin!.valueNumeric).toBe(96);
    expect(ferritin!.flag).toBeUndefined();
    expect(ferritin!.referenceInterval).toBe('30-400');
  });

  test('HDL Cholesterol does not get claimed by plain Cholesterol', () => {
    const markers = parseLabPages([QUEST_PAGE]);
    const hdl = markers.find((m) => m.name === 'HDL-C');
    const total = markers.find((m) => m.name === 'Total Cholesterol');
    expect(hdl!.valueNumeric).toBe(58);
    expect(total!.valueNumeric).toBe(212);
    expect(total!.flag).toBe('H');
  });

  test('µ units fold for matching but are stored verbatim', () => {
    const markers = parseLabPages([QUEST_PAGE]);
    const cortisol = markers.find((m) => m.name === 'Cortisol');
    expect(cortisol!.unit).toBe('µg/dL');
    // expected-unit bonus applied → above the base 0.8
    expect(cortisol!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('unknown result-shaped lines extract at ≤0.60 (always review-gated)', () => {
    const markers = parseLabPages([QUEST_PAGE]);
    const osmo = markers.find((m) => m.name === 'Osmolality');
    expect(osmo).toBeDefined();
    expect(osmo!.valueNumeric).toBe(285);
    expect(osmo!.unit).toBe('mOsm/kg');
    expect(osmo!.confidence).toBeLessThanOrEqual(0.6);
  });

  test('headers, patient lines, dates, and phone numbers are never markers', () => {
    const markers = parseLabPages([QUEST_PAGE]);
    const names = markers.map((m) => m.name.toLowerCase());
    for (const banned of ['patient', 'collected', 'phone', 'page', 'test name']) {
      expect(names.some((n) => n.includes(banned))).toBe(false);
    }
    // Nothing invented: exactly the 6 real results on the page.
    expect(markers).toHaveLength(6);
  });

  test('flag after the unit also parses', () => {
    const markers = parseLabPages([['TSH 6.1 mIU/L H 0.4-4.0'].join('\n')]);
    expect(markers[0].name).toBe('TSH');
    expect(markers[0].flag).toBe('H');
    expect(markers[0].referenceInterval).toBe('0.4-4.0');
  });

  test('layout-mangled single-line page still finds known markers, skips generic pass', () => {
    const mangled = 'Report Glucose 92 mg/dL 65-99 Ferritin 96 ng/mL 30-400 SomethingElse 42 xx/yy 1-2';
    const markers = parseLabPages([mangled]);
    expect(markers.find((m) => m.name === 'Glucose')!.valueNumeric).toBe(92);
    expect(markers.find((m) => m.name === 'Ferritin')!.valueNumeric).toBe(96);
    // no newline structure → the generic pass must not guess
    expect(markers.find((m) => m.name.includes('SomethingElse'))).toBeUndefined();
  });

  test('same marker on later pages is not duplicated', () => {
    const markers = parseLabPages(['a\nb\nc\nTSH 2.1 mIU/L 0.4-4.0', 'x\ny\nz\nTSH 2.1 mIU/L 0.4-4.0']);
    expect(markers.filter((m) => m.name === 'TSH')).toHaveLength(1);
  });

  test('a name with no numeric value is never emitted', () => {
    const markers = parseLabPages(['one\ntwo\nthree\nhs-CRP pending\nFerritin see note\n']);
    expect(markers).toHaveLength(0);
  });

  test('fold/normalize helpers', () => {
    expect(fold('MG/µL')).toBe('mg/ul');
    expect(fold('abc').length).toBe(3);
    expect(normalize('  Mg/dL  ')).toBe('mg/dl');
  });
});

describe('extractLabMeta', () => {
  test('finds lab company and collection date', () => {
    const meta = extractLabMeta([QUEST_PAGE]);
    expect(meta.labCompany).toBe('Quest Diagnostics');
    expect(meta.labDate).toBe('2026-07-01');
  });

  test('returns nulls when not clearly present', () => {
    const meta = extractLabMeta(['just some text']);
    expect(meta.labCompany).toBeNull();
    expect(meta.labDate).toBeNull();
  });
});

/* ---------------------------------------------------------------- pdf-text */

describe('pdf-text', () => {
  test('looksLikePdf checks magic bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.4 rest'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('PK zip'))).toBe(false);
  });

  test('extracts per-page text from real PDF bytes and parses end-to-end', async () => {
    const pages = await extractPdfPages(makePdf(QUEST_PAGE.split('\n')));
    expect(pages).toHaveLength(1);
    const markers = parseLabPages(pages);
    expect(markers.find((m) => m.name === 'hs-CRP')!.valueNumeric).toBe(2.8);
    expect(markers.find((m) => m.name === 'hs-CRP')!.unit).toBe('mg/L');
  });

  test('throws on non-PDF bytes', async () => {
    await expect(extractPdfPages(new TextEncoder().encode('not a pdf'))).rejects.toBeTruthy();
  });
});

/* -------------------------------------------------------------- upload route */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000b1', email: 'practitioner@example.test' },
  patient: { id: '20000000-0000-4000-8000-0000000000c2', organization_id: '30000000-0000-4000-8000-0000000000d3' } as
    | { id: string; organization_id: string }
    | null,
  insertError: null as { code: string } | null,
  uploadError: null as { message: string } | null,
  inserts: [] as Record<string, unknown>[],
  uploads: [] as { path: string; bytes: number }[],
  deletes: [] as string[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: {
    data: {
      document_id: 'doc-1',
      status: 'extracted',
      inserted: 6,
      matched: 5,
      low_confidence: 1,
      queue_item_id: 'q-1',
    },
    error: null as { code: string } | null,
  },
}));

vi.mock('../backend/clinical-supabase', () => ({
  createClinicalAnonClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === state.validToken
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } },
    },
  }),
  createClinicalUserClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'patient_profiles' ? { data: state.patient, error: null } : { data: null, error: null },
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return { data: null, error: state.insertError };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          state.deletes.push(id);
          return { data: null, error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          state.uploads.push({ path, bytes: bytes.length });
          return { data: { path }, error: state.uploadError };
        },
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === 'mark_lab_document_failed') return { data: { status: 'failed' }, error: null };
      return state.rpcResult;
    },
  }),
  createClinicalServiceClient: () => {
    throw new Error('service client must not be used by the upload route');
  },
}));

import { labsUploadApp } from '../backend/labs/upload-route';

function uploadRequest(opts: { token?: string; file?: File; patientId?: string }) {
  const form = new FormData();
  if (opts.patientId) form.set('patientId', opts.patientId);
  if (opts.file) form.set('file', opts.file);
  return labsUploadApp.request('/upload', {
    method: 'POST',
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    body: form,
  });
}

const PATIENT_ID = '20000000-0000-4000-8000-0000000000c2';
const pdfFile = (bytes: Uint8Array, name = 'panel.pdf') =>
  new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' });

describe('POST /api/clinical/labs/upload', () => {
  beforeEach(() => {
    state.inserts = [];
    state.uploads = [];
    state.deletes = [];
    state.rpcCalls = [];
    state.insertError = null;
    state.uploadError = null;
    state.patient = { id: PATIENT_ID, organization_id: '30000000-0000-4000-8000-0000000000d3' };
  });

  test('rejects a missing bearer with 401', async () => {
    const res = await uploadRequest({ file: pdfFile(makePdf(['x'])), patientId: PATIENT_ID });
    expect(res.status).toBe(401);
  });

  test('rejects non-PDF bytes with 400', async () => {
    const res = await uploadRequest({
      token: state.validToken,
      file: pdfFile(new TextEncoder().encode('hello')),
      patientId: PATIENT_ID,
    });
    expect(res.status).toBe(400);
  });

  test('rejects an invisible patient with 403 and writes nothing', async () => {
    state.patient = null;
    const res = await uploadRequest({
      token: state.validToken,
      file: pdfFile(makePdf(['x'])),
      patientId: PATIENT_ID,
    });
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
    expect(state.uploads).toHaveLength(0);
  });

  test('happy path: insert under RLS → storage → ingest RPC → summary', async () => {
    const res = await uploadRequest({
      token: state.validToken,
      file: pdfFile(makePdf(QUEST_PAGE.split('\n'))),
      patientId: PATIENT_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe('extracted');
    expect(body.data.inserted).toBe(6);
    expect(body.data.lowConfidence).toBe(1);

    expect(state.inserts).toHaveLength(1);
    const doc = state.inserts[0];
    expect(doc.patient_id).toBe(PATIENT_ID);
    expect(doc.processing_status).toBe('uploaded');
    expect(String(doc.storage_path)).toMatch(
      /^30000000-0000-4000-8000-0000000000d3\/20000000-0000-4000-8000-0000000000c2\/[0-9a-f-]{36}\.pdf$/,
    );
    expect(state.uploads[0].path).toBe(doc.storage_path);

    const ingest = state.rpcCalls.find((r) => r.name === 'ingest_lab_extraction')!;
    expect(ingest).toBeDefined();
    const markers = ingest.args._markers as Array<Record<string, unknown>>;
    expect(markers.length).toBe(6);
    expect(markers.find((m) => m.name === 'hs-CRP')!.unit).toBe('mg/L');
    expect(ingest.args._lab_company).toBe('Quest Diagnostics');
    expect(ingest.args._lab_date).toBe('2026-07-01');
  });

  test('storage failure rolls the document row back with 502', async () => {
    state.uploadError = { message: 'boom' };
    const res = await uploadRequest({
      token: state.validToken,
      file: pdfFile(makePdf(QUEST_PAGE.split('\n'))),
      patientId: PATIENT_ID,
    });
    expect(res.status).toBe(502);
    expect(state.deletes).toHaveLength(1);
    expect(state.rpcCalls).toHaveLength(0);
  });

  test('a PDF with no extractable markers becomes an honest failed document', async () => {
    const res = await uploadRequest({
      token: state.validToken,
      file: pdfFile(makePdf(['Nothing resembling results here', 'still nothing', 'more prose', 'even more'])),
      patientId: PATIENT_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe('failed');
    expect(body.data.failureReason).toBe('no_markers_found');
    const failed = state.rpcCalls.find((r) => r.name === 'mark_lab_document_failed')!;
    expect(failed.args._reason).toBe('no_markers_found');
    // the PDF stays stored for manual review — no delete
    expect(state.deletes).toHaveLength(0);
  });
});
