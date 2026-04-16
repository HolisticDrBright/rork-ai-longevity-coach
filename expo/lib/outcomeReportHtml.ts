/**
 * HTML generator for the outcome report.
 *
 * Produces a self-contained, print-ready HTML string. On native this is
 * handed to Share / expo-print (when added); on web it opens in a new tab.
 * This stays a pure function so we don't need a PDF dependency yet.
 */

interface DeltaLike {
  label: string;
  unit?: string;
  baseline?: number;
  current?: number;
  deltaPercent?: number;
  direction: 'improved' | 'declined' | 'stable' | 'unknown';
  summary?: string;
  missing?: boolean;
}

interface Report {
  generatedAt: string;
  dataCompletenessPct: number;
  biologicalAge: {
    baselineTruAge?: number;
    currentTruAge?: number;
    deltaYears?: number;
    direction: string;
    organs?: { organ: string; delta?: number }[];
  };
  inflammation: Record<string, DeltaLike | undefined>;
  wearables: Record<string, DeltaLike | undefined>;
  bodyComp: Record<string, DeltaLike | undefined>;
  labShifts: {
    nutrEval?: { correctedDeficiencies: string[]; remainingDeficiencies: string[] };
    dutch?: { baselineCortisolRhythm?: string; currentCortisolRhythm?: string; normalized?: boolean };
    giMap?: { resolvedMarkers?: string[]; persistentMarkers?: string[] };
  };
  adherence: {
    overallPct?: number;
    supplementPct?: number; peptidePct?: number; fastingPct?: number; exercisePct?: number;
  };
  patientReported?: {
    energy?: { baseline: number; current: number; delta: number };
    sleepQuality?: { baseline: number; current: number; delta: number };
    cognitiveFunction?: { baseline: number; current: number; delta: number };
    complaintsResolution?: { complaint: string; status: string }[];
  };
  narrative: { topWins: string[]; topGaps: string[]; maintenanceRecommendation: string };
}

function esc(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function deltaRow(d: DeltaLike | undefined): string {
  if (!d) return '';
  if (d.missing) {
    return `<div class="row muted"><span class="label">${esc(d.label)}</span><span>not measured</span></div>`;
  }
  const color =
    d.direction === 'improved' ? 'color:#047857' :
    d.direction === 'declined' ? 'color:#B91C1C' : 'color:#6B7280';
  const arrow = d.direction === 'improved' ? '↑' : d.direction === 'declined' ? '↓' : '→';
  const unit = d.unit ? ` ${esc(d.unit)}` : '';
  const pct = d.deltaPercent != null ? ` (${d.deltaPercent >= 0 ? '+' : ''}${d.deltaPercent.toFixed(1)}%)` : '';
  return `<div class="row"><span class="label">${esc(d.label)}</span>
    <span class="values">${d.baseline?.toFixed(1) ?? '—'}${unit} ${arrow} <b style="${color}">${d.current?.toFixed(1) ?? '—'}${unit}</b>${pct}</span>
  </div>`;
}

export function buildOutcomeReportHtml(report: Report, patientName: string = 'Patient'): string {
  const ba = report.biologicalAge;
  const heroDelta = ba.deltaYears != null
    ? `<div class="hero-delta">${ba.deltaYears < 0 ? '−' : '+'}${Math.abs(ba.deltaYears).toFixed(1)} years</div>`
    : '';
  const heroColor =
    ba.direction === 'improved' ? '#10B981' :
    ba.direction === 'declined' ? '#EF4444' : '#6B7280';

  const organRows = (ba.organs ?? [])
    .map(o => `<span class="chip">${esc(o.organ)}: ${o.delta == null ? '—' : (o.delta < 0 ? '' : '+') + o.delta.toFixed(1)}</span>`)
    .join('');

  const adh = report.adherence;
  const pr = report.patientReported ?? {};

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Longevity Outcome Report · ${esc(patientName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1A2B2B; margin:0; padding:0; background:#fff; }
  .page { padding:32px; page-break-after:always; }
  .page:last-child { page-break-after:auto; }
  h1 { font-size:24px; margin:0 0 4px 0; }
  h2 { font-size:16px; margin:24px 0 8px 0; color:#0D5C63; border-bottom:2px solid #E0E8E8; padding-bottom:4px; }
  .sub { color:#5A6B6B; font-size:12px; }
  .hero { background:linear-gradient(135deg, ${heroColor}, ${heroColor}cc); color:#fff; border-radius:14px; padding:28px; margin:16px 0; text-align:center; }
  .hero-kicker { font-size:11px; letter-spacing:1.5px; opacity:0.8; }
  .hero-ages { display:flex; justify-content:center; gap:40px; margin:12px 0; }
  .hero-age { text-align:center; }
  .hero-age-num { font-size:44px; font-weight:800; letter-spacing:-1px; }
  .hero-age-label { font-size:11px; opacity:0.8; text-transform:uppercase; }
  .hero-delta { font-size:20px; font-weight:700; margin-top:8px; background:rgba(255,255,255,0.2); display:inline-block; padding:6px 16px; border-radius:20px; }
  .chip { background:rgba(255,255,255,0.2); color:#fff; padding:4px 10px; border-radius:8px; font-size:11px; margin-right:6px; display:inline-block; margin-top:6px; }
  .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #EEF3F3; font-size:13px; }
  .row.muted { opacity:0.5; }
  .label { font-weight:600; }
  .values { color:#1A2B2B; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .card { background:#F8FAFB; border:1px solid #E0E8E8; border-radius:10px; padding:14px; }
  .card h3 { margin:0 0 6px 0; font-size:13px; color:#0D5C63; }
  .kpi { font-size:28px; font-weight:800; color:#0D5C63; }
  .tag { display:inline-block; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:700; margin:2px; }
  .tag-positive { background:#D1FAE5; color:#047857; }
  .tag-negative { background:#FEE2E2; color:#B91C1C; }
  .tag-neutral { background:#F3F4F6; color:#6B7280; }
  .wins li, .gaps li { font-size:13px; line-height:1.6; margin:4px 0; }
  .wins { color:#047857; }
  .gaps { color:#92400E; }
  .footer { font-size:10px; color:#8A9A9A; margin-top:32px; border-top:1px solid #EEF3F3; padding-top:8px; }
  .completeness { font-size:11px; color:#5A6B6B; margin-top:4px; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .page { padding:24px; }
  }
</style>
</head>
<body>

<!-- PAGE 1: Hero -->
<div class="page">
  <h1>Longevity Outcome Report</h1>
  <div class="sub">${esc(patientName)} · Generated ${new Date(report.generatedAt).toLocaleDateString()}</div>
  <div class="completeness">Report built from ${report.dataCompletenessPct}% of expected data</div>

  <div class="hero">
    <div class="hero-kicker">BIOLOGICAL AGE</div>
    <div class="hero-ages">
      <div class="hero-age">
        <div class="hero-age-num">${ba.baselineTruAge?.toFixed(1) ?? '—'}</div>
        <div class="hero-age-label">Baseline</div>
      </div>
      <div class="hero-age">
        <div class="hero-age-num">${ba.currentTruAge?.toFixed(1) ?? '—'}</div>
        <div class="hero-age-label">Month 6</div>
      </div>
    </div>
    ${heroDelta}
    <div style="margin-top:12px;">${organRows}</div>
  </div>

  <h2>Top wins</h2>
  <ul class="wins">${report.narrative.topWins.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
</div>

<!-- PAGE 2: Wearables & Body composition -->
<div class="page">
  <h2>Wearables (14-day average)</h2>
  ${Object.values(report.wearables).filter(Boolean).map(d => deltaRow(d as DeltaLike)).join('')}

  <h2>Body composition</h2>
  ${Object.values(report.bodyComp).filter(Boolean).map(d => deltaRow(d as DeltaLike)).join('')}

  <h2>Patient-reported</h2>
  ${pr.energy ? `<div class="row"><span class="label">Energy (1-10)</span><span>${pr.energy.baseline} → <b>${pr.energy.current}</b></span></div>` : ''}
  ${pr.sleepQuality ? `<div class="row"><span class="label">Sleep quality (1-10)</span><span>${pr.sleepQuality.baseline} → <b>${pr.sleepQuality.current}</b></span></div>` : ''}
  ${pr.cognitiveFunction ? `<div class="row"><span class="label">Cognitive function (1-10)</span><span>${pr.cognitiveFunction.baseline} → <b>${pr.cognitiveFunction.current}</b></span></div>` : ''}
  ${(pr.complaintsResolution ?? []).map(c => `
    <div class="row"><span class="label">${esc(c.complaint)}</span>
      <span class="tag ${c.status === 'resolved' ? 'tag-positive' : c.status === 'worsened' ? 'tag-negative' : 'tag-neutral'}">${c.status}</span>
    </div>
  `).join('')}
</div>

<!-- PAGE 3: Lab shifts & Inflammation -->
<div class="page">
  <h2>Inflammation</h2>
  ${Object.values(report.inflammation).filter(Boolean).map(d => deltaRow(d as DeltaLike)).join('')}

  <h2>Functional lab shifts</h2>
  ${report.labShifts.nutrEval ? `
    <div class="card">
      <h3>NutrEval</h3>
      <div style="font-size:12px;"><b>Corrected:</b> ${report.labShifts.nutrEval.correctedDeficiencies.map(esc).join(', ') || 'none yet'}</div>
      <div style="font-size:12px; margin-top:4px;"><b>Remaining:</b> ${report.labShifts.nutrEval.remainingDeficiencies.map(esc).join(', ') || 'none'}</div>
    </div>
  ` : ''}
  ${report.labShifts.dutch ? `
    <div class="card" style="margin-top:8px;">
      <h3>DUTCH</h3>
      <div style="font-size:12px;">Cortisol rhythm: ${esc(report.labShifts.dutch.baselineCortisolRhythm)} → ${esc(report.labShifts.dutch.currentCortisolRhythm)}${report.labShifts.dutch.normalized ? ' <span class="tag tag-positive">normalized</span>' : ''}</div>
    </div>
  ` : ''}
  ${report.labShifts.giMap ? `
    <div class="card" style="margin-top:8px;">
      <h3>GI-MAP</h3>
      <div style="font-size:12px;">Resolved: ${(report.labShifts.giMap.resolvedMarkers ?? []).length} · Persistent: ${(report.labShifts.giMap.persistentMarkers ?? []).length}</div>
    </div>
  ` : ''}

  <h2>Adherence</h2>
  <div class="grid">
    <div class="card"><h3>Overall</h3><div class="kpi">${adh.overallPct != null ? adh.overallPct + '%' : '—'}</div></div>
    <div class="card"><h3>Supplements</h3><div class="kpi">${adh.supplementPct != null ? adh.supplementPct + '%' : '—'}</div></div>
    <div class="card"><h3>Peptides</h3><div class="kpi">${adh.peptidePct != null ? adh.peptidePct + '%' : '—'}</div></div>
    <div class="card"><h3>Fasting</h3><div class="kpi">${adh.fastingPct != null ? adh.fastingPct + '%' : '—'}</div></div>
  </div>
</div>

<!-- PAGE 4: Narrative -->
<div class="page">
  <h2>Focus areas</h2>
  <ul class="gaps">${report.narrative.topGaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul>

  <h2>Maintenance recommendation</h2>
  <p style="font-size:13px; line-height:1.6;">${esc(report.narrative.maintenanceRecommendation)}</p>

  <div class="footer">
    This report is educational and informational, not medical advice.
    Generated by AI Longevity Pro — report completeness ${report.dataCompletenessPct}%.
  </div>
</div>

</body></html>`;
}
