import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mockFrom, createChainableMock, setupMockFrom, mockCtx } from '../setup';

const aiMocks = vi.hoisted(() => ({
  getServerAiConfig: vi.fn(),
  generateStructured: vi.fn(),
  generateNarrative: vi.fn(),
  uploadProviderFile: vi.fn(async () => 'provider-file-1'),
  deleteProviderFile: vi.fn(async () => undefined),
}));

vi.mock('../../backend/services/ai/aiClient', () => aiMocks);

const pipelineMocks = vi.hoisted(() => ({
  runReasoningPipeline: vi.fn(async () => ({
    snapshot: {},
    aiUsed: false,
    hypothesesCreated: [],
    contradictionsRecorded: 0,
  })),
  REASONING_PIPELINE_VERSION: '2.0.0',
}));

vi.mock('../../backend/services/reasoning/pipelineRunner', () => pipelineMocks);

import { labIngestionRouter } from '../../backend/trpc/routes/labs';
import { createTRPCRouter } from '../../backend/trpc/create-context';

const CONFIG = { apiKey: 'k', baseUrl: 'https://ai.example.com/v1', model: 'test-model', timeoutMs: 5000 };

function createTestCaller() {
  const router = createTRPCRouter({ labs: labIngestionRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { labs: any }).labs;
}

/** uploaded_documents chain: SELECT queries resolve empty; INSERT...single returns the doc row. */
function docsChain(selectRows: Record<string, unknown>[] = []) {
  const chain = createChainableMock({ data: selectRows });
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve({ data: selectRows, error: null, count: null }).then(resolve, reject);
  chain.single = vi.fn(async () => ({ data: { id: 'doc-1' }, error: null }));
  return chain;
}

const PASS1 = {
  ok: true as const,
  data: {
    biomarkers: [
      { name: 'Ferritin', value: 12, unit: 'ng/mL', referenceMin: 30, referenceMax: 400 },
      { name: 'TSH', value: 2.1, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.5 },
    ],
    reportDate: '2026-06-01',
    labCompany: 'Quest',
  },
  operationId: 'op-1',
  retries: 0,
};

const PASS2 = {
  ok: true as const,
  data: {
    biomarkers: [
      // pass2 "accidentally" changes the ferritin value — the route must restore pass1's number
      { name: 'Ferritin', value: 13, unit: 'ng/mL', referenceMin: 30, referenceMax: 400, functionalMin: 50, functionalMax: 150, status: 'critical' as const },
      { name: 'TSH', value: 2.1, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.5, functionalMin: 1, functionalMax: 2.5, status: 'optimal' as const },
    ],
    supplements: [{ name: 'Iron Bisglycinate', dose: '25 mg', timing: 'AM', reason: 'Low ferritin', mechanism: 'Repletes iron stores' }],
    herbs: [],
    priorityActions: ['Confirm with full iron panel'],
  },
  operationId: 'op-2',
  retries: 0,
};

describe('labs.capabilities', () => {
  beforeEach(() => vi.clearAllMocks());

  test('reports unconfigured when no server AI key is set', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(null);
    const caps = await createTestCaller().capabilities();
    expect(caps).toEqual({ serverAiConfigured: false, model: null });
  });

  test('reports the configured model', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(CONFIG);
    const caps = await createTestCaller().capabilities();
    expect(caps).toEqual({ serverAiConfigured: true, model: 'test-model' });
  });
});

describe('labs.extract', () => {
  beforeEach(() => vi.clearAllMocks());

  const input = {
    files: [{ base64: 'aGVsbG8=', mimeType: 'application/pdf' as const, fileName: 'labs.pdf' }],
  };

  test('fails closed when server AI is not configured', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(null);
    await expect(createTestCaller().extract(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  test('happy path: two-pass extraction with verbatim values winning, provenance stored, pipeline run', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(CONFIG);
    aiMocks.generateStructured.mockResolvedValueOnce(PASS1).mockResolvedValueOnce(PASS2);
    aiMocks.generateNarrative.mockResolvedValue({ ok: true, text: 'Narrative analysis', operationId: 'op-3' });

    const documents = docsChain([]);
    const labMarkers = createChainableMock({ data: [] });
    setupMockFrom({
      uploaded_documents: documents,
      lab_markers: labMarkers,
    });

    const result = await createTestCaller().extract(input);

    expect(result.duplicate).toBe(false);
    expect(result.documentId).toBe('doc-1');
    // Pass-1 verbatim value restored over pass-2's altered value
    const ferritin = result.biomarkers.find((b: { name: string }) => b.name === 'Ferritin');
    expect(ferritin.value).toBe(12);
    expect(ferritin.status).toBe('critical'); // enrichment kept
    expect(result.analysisText).toBe('Narrative analysis');
    expect(result.supplements[0].name).toBe('Iron Bisglycinate');

    // Provenance document written with dedupe hash + model
    expect(documents.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockCtx.user.id,
        mime_type: 'application/pdf',
        extraction_model: 'test-model',
        status: 'extracted',
        report_date: '2026-06-01',
        dedupe_hash: expect.any(String),
      })
    );
    // Structured markers carry the document reference and the REPORT date
    expect(labMarkers.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        marker_name: 'Ferritin',
        marker_value: 12,
        source: 'server_extraction:doc-1',
        collected_at: expect.stringContaining('2026-06-01'),
      })
    );
    // PDF uploaded to the provider then cleaned up; pipeline re-ran
    expect(aiMocks.uploadProviderFile).toHaveBeenCalled();
    expect(aiMocks.deleteProviderFile).toHaveBeenCalledWith(CONFIG, 'provider-file-1');
    expect(pipelineMocks.runReasoningPipeline).toHaveBeenCalledWith(
      expect.anything(),
      { id: mockCtx.user.id },
      mockCtx.user.id,
      'new_lab'
    );
    expect(result.pipelineRan).toBe(true);
  });

  test('duplicate uploads are detected and NOT rewritten', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(CONFIG);
    aiMocks.generateStructured.mockResolvedValueOnce(PASS1);

    const documents = docsChain([{ id: 'existing-doc', status: 'extracted', created_at: '2026-06-02T00:00:00Z' }]);
    const labMarkers = createChainableMock({ data: [] });
    setupMockFrom({ uploaded_documents: documents, lab_markers: labMarkers });

    const result = await createTestCaller().extract(input);

    expect(result).toMatchObject({ duplicate: true, existingDocumentId: 'existing-doc' });
    expect(documents.insert).not.toHaveBeenCalled();
    expect(labMarkers.insert).not.toHaveBeenCalled();
    expect(pipelineMocks.runReasoningPipeline).not.toHaveBeenCalled();
  });

  test('unreadable documents return a clear error', async () => {
    aiMocks.getServerAiConfig.mockReturnValue(CONFIG);
    aiMocks.generateStructured.mockResolvedValueOnce({ ok: false, error: 'bad json', operationId: null });
    setupMockFrom({ uploaded_documents: docsChain([]) });

    await expect(createTestCaller().extract(input)).rejects.toMatchObject({
      code: 'UNPROCESSABLE_CONTENT',
    });
    // Provider file still cleaned up on failure
    expect(aiMocks.deleteProviderFile).toHaveBeenCalled();
  });
});
