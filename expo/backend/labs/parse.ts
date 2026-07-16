/**
 * Deterministic lab-report text parser (no AI, no network).
 *
 * Input is the per-page text of an uploaded PDF; output is a list of candidate
 * markers with an explicit 0–1 extraction confidence. Design rules:
 *
 *  - NEVER invent: a marker is only emitted when an actual numeric value (or
 *    explicit text result) is present in the source text.
 *  - Names/units/reference intervals are passed through verbatim so the
 *    database keeps the original strings (original_* columns).
 *  - Confidence is a mechanical score of parse quality (alias match, unit
 *    match, range presence) — it is extraction confidence, not medical
 *    certainty. Anything below 0.70 lands in the review queue downstream.
 *  - Unknown-but-result-shaped lines are extracted at ≤0.60 confidence so a
 *    practitioner always verifies them; known markers anchor on an alias
 *    table so mangled PDF text layout still parses.
 */

export interface ParsedMarker {
  name: string;
  valueNumeric?: number;
  valueText?: string;
  unit?: string;
  referenceInterval?: string;
  flag?: 'H' | 'L' | 'HH' | 'LL';
  page: number;
  confidence: number;
  originalValue?: string;
}

export interface LabMeta {
  labCompany: string | null;
  labDate: string | null; // ISO yyyy-mm-dd
}

interface KnownMarker {
  canonical: string;
  aliases: string[];
  units: string[];
}

/**
 * Canonical names deliberately match biomarker_definitions.canonical_name in
 * the clinical schema/seed so ingest links definitions by name.
 */
export const KNOWN_MARKERS: KnownMarker[] = [
  { canonical: 'hs-CRP', aliases: ['hs-crp', 'hscrp', 'hs crp', 'c-reactive protein, high sensitivity', 'c-reactive protein hs', 'high sensitivity crp', 'crp, high sensitivity', 'cardio crp'], units: ['mg/l'] },
  { canonical: 'Vitamin D 25-OH', aliases: ['vitamin d, 25-oh', 'vitamin d 25-oh', '25-oh vitamin d', 'vitamin d, 25-hydroxy', '25-hydroxyvitamin d', 'vitamin d 25 hydroxy', 'vitamin d'], units: ['ng/ml', 'nmol/l'] },
  { canonical: 'TSH', aliases: ['tsh', 'thyroid stimulating hormone', 'thyrotropin'], units: ['miu/l', 'uiu/ml'] },
  { canonical: 'Ferritin', aliases: ['ferritin'], units: ['ng/ml', 'ug/l'] },
  { canonical: 'HbA1c', aliases: ['hba1c', 'hemoglobin a1c', 'a1c', 'glycohemoglobin'], units: ['%'] },
  { canonical: 'Glucose', aliases: ['glucose, fasting', 'fasting glucose', 'glucose'], units: ['mg/dl', 'mmol/l'] },
  { canonical: 'Total Cholesterol', aliases: ['cholesterol, total', 'total cholesterol', 'cholesterol'], units: ['mg/dl'] },
  { canonical: 'LDL-C', aliases: ['ldl cholesterol calc', 'ldl cholesterol', 'ldl-c', 'ldl chol calc (nih)', 'ldl'], units: ['mg/dl'] },
  { canonical: 'HDL-C', aliases: ['hdl cholesterol', 'hdl-c', 'hdl'], units: ['mg/dl'] },
  { canonical: 'Triglycerides', aliases: ['triglycerides'], units: ['mg/dl'] },
  { canonical: 'ApoB', aliases: ['apolipoprotein b', 'apob'], units: ['mg/dl'] },
  { canonical: 'Lp(a)', aliases: ['lipoprotein (a)', 'lipoprotein(a)', 'lp(a)'], units: ['nmol/l', 'mg/dl'] },
  { canonical: 'ALT', aliases: ['alt (sgpt)', 'alanine aminotransferase', 'alt'], units: ['u/l', 'iu/l'] },
  { canonical: 'AST', aliases: ['ast (sgot)', 'aspartate aminotransferase', 'ast'], units: ['u/l', 'iu/l'] },
  { canonical: 'Creatinine', aliases: ['creatinine'], units: ['mg/dl'] },
  { canonical: 'eGFR', aliases: ['egfr', 'estimated gfr', 'gfr estimated'], units: ['ml/min/1.73', 'ml/min/1.73m2'] },
  { canonical: 'Hemoglobin', aliases: ['hemoglobin', 'hgb'], units: ['g/dl'] },
  { canonical: 'WBC', aliases: ['white blood cell count', 'wbc'], units: ['x10e3/ul', 'k/ul', '10*3/ul'] },
  { canonical: 'Platelets', aliases: ['platelet count', 'platelets'], units: ['x10e3/ul', 'k/ul', '10*3/ul'] },
  { canonical: 'Vitamin B12', aliases: ['vitamin b12', 'cobalamin', 'b12'], units: ['pg/ml'] },
  { canonical: 'Folate', aliases: ['folate', 'folic acid'], units: ['ng/ml'] },
  { canonical: 'Iron', aliases: ['iron, serum', 'iron'], units: ['ug/dl', 'mcg/dl'] },
  { canonical: 'Insulin', aliases: ['insulin, fasting', 'fasting insulin', 'insulin'], units: ['uiu/ml'] },
  { canonical: 'Free T3', aliases: ['t3, free', 'free t3', 'ft3'], units: ['pg/ml'] },
  { canonical: 'Free T4', aliases: ['t4, free', 'free t4', 'ft4'], units: ['ng/dl'] },
  { canonical: 'Testosterone', aliases: ['testosterone, total', 'total testosterone', 'testosterone'], units: ['ng/dl'] },
  { canonical: 'Cortisol', aliases: ['cortisol'], units: ['ug/dl', 'mcg/dl'] },
  { canonical: 'DHEA-S', aliases: ['dhea-sulfate', 'dhea sulfate', 'dhea-s'], units: ['ug/dl', 'mcg/dl'] },
  { canonical: 'Magnesium', aliases: ['magnesium, rbc', 'magnesium'], units: ['mg/dl'] },
  { canonical: 'Homocysteine', aliases: ['homocysteine'], units: ['umol/l'] },
  { canonical: 'Sodium', aliases: ['sodium'], units: ['mmol/l', 'meq/l'] },
  { canonical: 'Potassium', aliases: ['potassium'], units: ['mmol/l', 'meq/l'] },
  { canonical: 'Uric Acid', aliases: ['uric acid'], units: ['mg/dl'] },
];

const MAX_MARKERS = 200;

/**
 * LENGTH-PRESERVING lowercase fold (µ→u) — used to FIND aliases while every
 * extracted string (unit, range, raw value) is sliced from the ORIGINAL text,
 * so stored values keep their source casing verbatim.
 */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[µμ]/g, 'u');
}

/** Collapsed-whitespace fold for comparing already-extracted short strings. */
export function normalize(s: string): string {
  return fold(s).replace(/\s+/g, ' ').trim();
}

const VALUE_RE = /(\d{1,6}(?:\.\d{1,4})?)/;
const RANGE_RE = /((?:[<>]=?\s*\d+(?:\.\d+)?)|(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?))/;
// Source-printed abnormal flags are uppercase; a lowercase "h" is prose.
const LEAD_FLAG_RE = /^\s*[(\[]?(HH|LL|H|L)[)\]]?(?=[\s]|$)/;
const FLAG_RE = /(?:^|[\s(])(HH|LL|H|L)(?:[\s).]|$)/;
// A unit must be % or contain a slash (mg/dL, x10E3/uL) — bare alpha tokens
// like "Reference" must never be mistaken for units.
const UNIT_RE = /^\s*(%|[a-zA-Zµμ][a-zA-Zµμ0-9^*.]*(?:\/[a-zA-Zµμ0-9^*.]+)+)/;

function clamp(n: number): number {
  return Math.max(0, Math.min(0.98, Math.round(n * 100) / 100));
}

/** Parse the ORIGINAL-text window that follows a marker name. */
function parseWindow(window: string): {
  value: number;
  valueEnd: number;
  unit?: string;
  range?: string;
  flag?: ParsedMarker['flag'];
  raw: string;
} | null {
  const valueMatch = VALUE_RE.exec(window);
  if (!valueMatch || valueMatch.index > 24) return null; // value must be near the name
  const value = Number(valueMatch[1]);
  if (!Number.isFinite(value)) return null;

  let after = window.slice(valueMatch.index + valueMatch[1].length);

  // Layouts print the flag either right after the value ("2.8 H mg/L") or
  // after the unit ("2.8 mg/L H") — accept both.
  let flag: ParsedMarker['flag'] | undefined;
  const lead = LEAD_FLAG_RE.exec(after);
  if (lead) {
    flag = lead[1] as ParsedMarker['flag'];
    after = after.slice(lead[0].length);
  }

  let unit: string | undefined;
  const unitMatch = UNIT_RE.exec(after);
  if (unitMatch) {
    unit = unitMatch[1];
    after = after.slice(unitMatch[0].length);
  }

  if (!flag) {
    const flagMatch = FLAG_RE.exec(after.slice(0, 30));
    if (flagMatch) flag = flagMatch[1] as ParsedMarker['flag'];
  }

  const rangeMatch = RANGE_RE.exec(after.slice(0, 60));
  const range = rangeMatch ? rangeMatch[1].replace(/\s+/g, ' ').trim() : undefined;

  return {
    value,
    valueEnd: valueMatch.index + valueMatch[1].length,
    unit,
    range,
    flag,
    raw: valueMatch[1],
  };
}

interface AliasEntry {
  alias: string;
  marker: KnownMarker;
}

// Global longest-first alias list so "HDL Cholesterol" claims its span before
// plain "Cholesterol" can anchor inside it.
const ALIAS_ENTRIES: AliasEntry[] = KNOWN_MARKERS.flatMap((marker) =>
  marker.aliases.map((alias) => ({ alias: fold(alias), marker })),
).sort((a, b) => b.alias.length - a.alias.length);

/** Alias-anchored pass over one page. Windows come from the ORIGINAL text. */
function knownPass(pageText: string, page: number, consumed: Set<string>): ParsedMarker[] {
  const out: ParsedMarker[] = [];
  const folded = fold(pageText);
  const claimed: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && e > cs);

  for (const { alias, marker } of ALIAS_ENTRIES) {
    if (consumed.has(marker.canonical)) continue;

    let idx = folded.indexOf(alias);
    while (idx !== -1) {
      const end = idx + alias.length;
      // Word-ish boundaries so "iron" can't hit inside "environmental".
      const before = idx === 0 ? ' ' : folded[idx - 1];
      const afterCh = end >= folded.length ? ' ' : folded[end];
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(afterCh) || overlaps(idx, end)) {
        idx = folded.indexOf(alias, idx + 1);
        continue;
      }

      const window = pageText.slice(end, end + 90);
      const parsed = parseWindow(window);
      if (!parsed) {
        idx = folded.indexOf(alias, idx + 1);
        continue;
      }

      let conf = 0.8;
      if (parsed.unit && marker.units.includes(normalize(parsed.unit))) conf += 0.1;
      if (parsed.range) conf += 0.05;
      if (parsed.flag) conf += 0.03;
      if (!parsed.unit) conf -= 0.1;

      out.push({
        name: marker.canonical,
        valueNumeric: parsed.value,
        unit: parsed.unit,
        referenceInterval: parsed.range,
        flag: parsed.flag,
        page,
        confidence: clamp(conf),
        originalValue: parsed.raw,
      });
      consumed.add(marker.canonical);
      claimed.push([idx, end + parsed.valueEnd]);
      break;
    }
  }
  return out;
}

const NON_RESULT_LINE =
  /^(page|date|dob|patient|name|phone|fax|address|specimen|collect|received|reported|accession|ordering|physician|provider|npi|clia|director|lab(oratory)?\b|test\b|results?\b|units?\b|reference|interval|range|flag|comments?|notes?|methodology|performed|fasting\b|final|status)/i;

/**
 * Generic pass: unknown-but-result-shaped LINES only (needs real newline
 * structure). Capped at 0.60 confidence → always review-gated downstream.
 */
function genericPass(pageText: string, page: number, seenNames: Set<string>): ParsedMarker[] {
  const lines = pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return []; // no usable line structure — skip, never guess
  const out: ParsedMarker[] = [];

  for (const line of lines) {
    if (line.length < 6 || line.length > 160) continue;
    if (NON_RESULT_LINE.test(line)) continue;

    const m = /^([A-Za-z][A-Za-z0-9 ,().%+\-\/]{2,48}?)[:\s]\s*(\d{1,6}(?:\.\d{1,4})?)(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/[\s:.,]+$/, '').trim();
    if (name.length < 3) continue;
    const nameNorm = normalize(name);
    if (seenNames.has(nameNorm)) continue;
    // Skip anything the alias table already covers — the known pass owns those.
    if (KNOWN_MARKERS.some((k) => k.aliases.some((a) => nameNorm === a || nameNorm.startsWith(a + ' ')))) continue;
    // A date is not a result.
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue;

    const rest = m[3] ?? '';
    const unitMatch = UNIT_RE.exec(rest);
    const unit = unitMatch && !/^(HH|LL|H|L)$/i.test(unitMatch[1]) ? unitMatch[1] : undefined;
    const rangeMatch = RANGE_RE.exec(rest);
    const range = rangeMatch ? rangeMatch[1].replace(/\s+/g, ' ').trim() : undefined;
    // Result-shaped means: a unit or a reference range accompanies the number.
    if (!unit && !range) continue;
    const flagMatch = FLAG_RE.exec(rest.slice(0, 40));

    out.push({
      name,
      valueNumeric: Number(m[2]),
      unit,
      referenceInterval: range,
      flag: flagMatch ? (flagMatch[1] as ParsedMarker['flag']) : undefined,
      page,
      confidence: clamp(Math.min(0.6, 0.5 + (unit ? 0.05 : 0) + (range ? 0.05 : 0))),
      originalValue: m[2],
    });
    seenNames.add(nameNorm);
  }
  return out;
}

/** Parse all pages. Deterministic; returns at most MAX_MARKERS candidates. */
export function parseLabPages(pages: string[]): ParsedMarker[] {
  const consumed = new Set<string>(); // canonical names already found
  const seenNames = new Set<string>(); // generic-pass dedupe
  const out: ParsedMarker[] = [];

  pages.forEach((pageText, i) => {
    if (!pageText || out.length >= MAX_MARKERS) return;
    const page = i + 1;
    out.push(...knownPass(pageText, page, consumed));
    out.push(...genericPass(pageText, page, seenNames));
  });

  return out.slice(0, MAX_MARKERS);
}

const LAB_COMPANIES: [RegExp, string][] = [
  [/quest diagnostics/i, 'Quest Diagnostics'],
  [/laboratory corporation of america|labcorp/i, 'Labcorp'],
  [/vibrant america/i, 'Vibrant America'],
  [/boston heart/i, 'Boston Heart Diagnostics'],
  [/cleveland heartlab/i, 'Cleveland HeartLab'],
  [/genova diagnostics/i, 'Genova Diagnostics'],
  [/access med(ical)? labs?/i, 'Access Medical Labs'],
];

/** Best-effort lab company + collection date. Null when not clearly present. */
export function extractLabMeta(pages: string[]): LabMeta {
  const head = pages.slice(0, 2).join('\n');
  let labCompany: string | null = null;
  for (const [re, label] of LAB_COMPANIES) {
    if (re.test(head)) {
      labCompany = label;
      break;
    }
  }

  let labDate: string | null = null;
  const dm =
    /collect(?:ed|ion)(?:\s*date)?\s*[:\s]\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(head);
  if (dm) {
    const raw = dm[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      labDate = raw;
    } else {
      const [mo, da, yr] = raw.split('/').map(Number);
      const year = yr < 100 ? 2000 + yr : yr;
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && year >= 1990 && year <= 2100) {
        labDate = `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
      }
    }
  }

  return { labCompany, labDate };
}
