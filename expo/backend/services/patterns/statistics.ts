/**
 * Statistical primitives for the pattern-discovery miner.
 *
 * All functions are pure and deterministic — no Supabase, no LLM calls.
 * Correlation coefficients follow the textbook definitions. P-values for
 * Spearman and Kendall use large-sample normal approximations, which is
 * fine for our cohort sizes (n ≥ 20). If we start mining very small cohorts
 * we should swap in permutation tests here.
 */

// ────────────────────────────────────────────────────────────
// Ranking + basic helpers
// ────────────────────────────────────────────────────────────

/** Fractional ranking — average rank for ties. */
export function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length).fill(0);

  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j + 2) / 2; // 1-indexed average
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * a);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * erf);
}

function twoTailedFromZ(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

// ────────────────────────────────────────────────────────────
// Correlation tests
// ────────────────────────────────────────────────────────────

export interface CorrelationResult {
  method: string;
  rho: number;
  n: number;
  pValue: number;
  ci95?: { lower: number; upper: number };
}

/** Spearman ρ with Fisher z-transform CI. Good for n ≥ 10. */
export function spearman(x: number[], y: number[]): CorrelationResult {
  if (x.length !== y.length) throw new Error('spearman: arrays differ in length');
  const n = x.length;
  const rx = rank(x);
  const ry = rank(y);
  const rho = pearson(rx, ry);

  // z = rho * sqrt(n-1), two-tailed
  const z = rho * Math.sqrt(n - 1);
  const pValue = twoTailedFromZ(z);

  // Fisher z CI
  let ci95: { lower: number; upper: number } | undefined;
  if (n > 3) {
    const zr = 0.5 * Math.log((1 + rho) / (1 - rho));
    const se = 1 / Math.sqrt(n - 3);
    const zl = zr - 1.96 * se;
    const zu = zr + 1.96 * se;
    ci95 = {
      lower: (Math.exp(2 * zl) - 1) / (Math.exp(2 * zl) + 1),
      upper: (Math.exp(2 * zu) - 1) / (Math.exp(2 * zu) + 1),
    };
  }

  return { method: 'spearman', rho, n, pValue, ci95 };
}

/** Kendall τ-b (handles ties). Large-sample normal approximation. */
export function kendall(x: number[], y: number[]): CorrelationResult {
  if (x.length !== y.length) throw new Error('kendall: arrays differ in length');
  const n = x.length;
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tiesX++;
      else if (dy === 0) tiesY++;
      else if (dx * dy > 0) concordant++;
      else discordant++;
    }
  }

  const totalPairs = (n * (n - 1)) / 2;
  const denom = Math.sqrt((totalPairs - tiesX) * (totalPairs - tiesY));
  const tau = denom === 0 ? 0 : (concordant - discordant) / denom;

  const varTau = (2 * (2 * n + 5)) / (9 * n * (n - 1));
  const z = tau / Math.sqrt(varTau);
  const pValue = twoTailedFromZ(z);

  return { method: 'kendall', rho: tau, n, pValue };
}

/** Point-biserial correlation: binary x (0/1) × continuous y. */
export function pointBiserial(binary: number[], continuous: number[]): CorrelationResult {
  if (binary.length !== continuous.length) throw new Error('pointBiserial: length mismatch');
  const n = binary.length;
  const groupA = continuous.filter((_, i) => binary[i] === 1);
  const groupB = continuous.filter((_, i) => binary[i] === 0);
  if (groupA.length === 0 || groupB.length === 0) {
    return { method: 'point_biserial', rho: 0, n, pValue: 1 };
  }
  const ma = mean(groupA);
  const mb = mean(groupB);
  const m = mean(continuous);
  const sd = Math.sqrt(continuous.reduce((s, v) => s + (v - m) ** 2, 0) / n);
  if (sd === 0) return { method: 'point_biserial', rho: 0, n, pValue: 1 };
  const p = groupA.length / n;
  const q = groupB.length / n;
  const rho = ((ma - mb) / sd) * Math.sqrt(p * q);

  const t = rho * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rho * rho));
  const z = t; // approximate for n > 30
  const pValue = twoTailedFromZ(z);
  return { method: 'point_biserial', rho, n, pValue };
}

// ────────────────────────────────────────────────────────────
// Mutual information (k-NN estimator — Kraskov simplified)
// ────────────────────────────────────────────────────────────

/**
 * Bucketed MI for two continuous variables. Discretizes both into equal-width
 * bins (default 10) and computes I(X;Y) in nats / log(2) to nats-to-bits.
 * Not as sensitive as the true Kraskov estimator but dependency-free and
 * adequate for screening.
 */
export function mutualInformation(x: number[], y: number[], bins = 10): CorrelationResult {
  const n = x.length;
  const bin = (arr: number[]) => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const span = max - min || 1;
    return arr.map(v => Math.min(bins - 1, Math.floor(((v - min) / span) * bins)));
  };
  const bx = bin(x);
  const by = bin(y);

  const joint = new Map<string, number>();
  const margX = new Map<number, number>();
  const margY = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = `${bx[i]}_${by[i]}`;
    joint.set(k, (joint.get(k) ?? 0) + 1);
    margX.set(bx[i], (margX.get(bx[i]) ?? 0) + 1);
    margY.set(by[i], (margY.get(by[i]) ?? 0) + 1);
  }

  let mi = 0;
  for (const [k, count] of joint) {
    const [xi, yi] = k.split('_').map(Number);
    const p = count / n;
    const px = (margX.get(xi) ?? 0) / n;
    const py = (margY.get(yi) ?? 0) / n;
    if (p > 0 && px > 0 && py > 0) mi += p * Math.log(p / (px * py));
  }
  // Approximate p-value: treat MI as chi-square with (bins-1)^2 dof
  // after 2*n*MI ~ chi2. We use normal-approx here for simplicity.
  const df = (bins - 1) * (bins - 1);
  const chi2 = 2 * n * mi;
  const z = (chi2 - df) / Math.sqrt(2 * df);
  const pValue = twoTailedFromZ(z);

  return { method: 'mutual_info', rho: mi, n, pValue };
}

// ────────────────────────────────────────────────────────────
// Categorical: chi-square + Fisher's exact (2×2)
// ────────────────────────────────────────────────────────────

export function chiSquare(table: number[][]): CorrelationResult {
  const rowTotals = table.map(r => r.reduce((a, b) => a + b, 0));
  const colTotals = table[0].map((_, j) => table.reduce((a, r) => a + r[j], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);
  if (grandTotal === 0) return { method: 'chi_square', rho: 0, n: 0, pValue: 1 };

  let chi2 = 0;
  for (let i = 0; i < table.length; i++) {
    for (let j = 0; j < table[0].length; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / grandTotal;
      if (expected > 0) chi2 += ((table[i][j] - expected) ** 2) / expected;
    }
  }
  const df = (table.length - 1) * (table[0].length - 1);
  // Effect size via Cramér's V
  const cramersV = Math.sqrt(chi2 / (grandTotal * Math.min(table.length - 1, table[0].length - 1)));
  const z = (chi2 - df) / Math.sqrt(2 * df);
  return { method: 'chi_square', rho: cramersV, n: grandTotal, pValue: twoTailedFromZ(z) };
}

/** Fisher's exact test for a 2x2 contingency table. */
export function fisherExact(a: number, b: number, c: number, d: number): CorrelationResult {
  const n = a + b + c + d;
  const logFact = (k: number) => {
    let s = 0;
    for (let i = 2; i <= k; i++) s += Math.log(i);
    return s;
  };
  const logHyperProb = (a: number, b: number, c: number, d: number) =>
    logFact(a + b) + logFact(c + d) + logFact(a + c) + logFact(b + d)
    - logFact(a) - logFact(b) - logFact(c) - logFact(d) - logFact(a + b + c + d);
  const observed = logHyperProb(a, b, c, d);

  let pValue = 0;
  const rowTotal = a + b;
  const colTotal = a + c;
  const minA = Math.max(0, colTotal - (b + d));
  const maxA = Math.min(rowTotal, colTotal);
  for (let k = minA; k <= maxA; k++) {
    const newA = k;
    const newB = rowTotal - k;
    const newC = colTotal - k;
    const newD = n - newA - newB - newC;
    if (newB < 0 || newC < 0 || newD < 0) continue;
    const p = logHyperProb(newA, newB, newC, newD);
    if (p <= observed + 1e-9) pValue += Math.exp(p);
  }

  const oddsRatio = (a * d) / Math.max(1e-9, b * c);
  return {
    method: 'fisher',
    rho: Math.log(oddsRatio), // log-OR as effect size
    n,
    pValue: Math.min(1, pValue),
  };
}

// ────────────────────────────────────────────────────────────
// Benjamini-Hochberg FDR correction
// ────────────────────────────────────────────────────────────

/** Returns q-values for a list of p-values under BH FDR. */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length;
  if (n === 0) return [];
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const qSorted: number[] = new Array(n);
  let minSoFar = Infinity;
  for (let rank = n; rank >= 1; rank--) {
    const { p } = indexed[rank - 1];
    const q = Math.min(minSoFar, (p * n) / rank);
    qSorted[rank - 1] = q;
    minSoFar = q;
  }

  const result = new Array(n).fill(0);
  for (let r = 0; r < n; r++) result[indexed[r].i] = Math.min(1, qSorted[r]);
  return result;
}

// ────────────────────────────────────────────────────────────
// Bootstrap helpers (used by effectiveness engine)
// ────────────────────────────────────────────────────────────

export function bootstrapMeanCi(values: number[], iters = 1000, alpha = 0.05): { mean: number; lower: number; upper: number } {
  if (values.length === 0) return { mean: 0, lower: 0, upper: 0 };
  const means: number[] = [];
  for (let k = 0; k < iters; k++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) {
      s += values[Math.floor(Math.random() * values.length)];
    }
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  const lower = means[Math.floor(iters * (alpha / 2))];
  const upper = means[Math.floor(iters * (1 - alpha / 2))];
  return { mean: mean(values), lower, upper };
}

/** Hedges g — standardized mean difference with small-sample correction. */
export function hedgesG(baseline: number[], response: number[]): number {
  const n1 = baseline.length;
  const n2 = response.length;
  if (n1 < 2 || n2 < 2) return 0;
  const m1 = mean(baseline);
  const m2 = mean(response);
  const v1 = baseline.reduce((s, v) => s + (v - m1) ** 2, 0) / (n1 - 1);
  const v2 = response.reduce((s, v) => s + (v - m2) ** 2, 0) / (n2 - 1);
  const pooled = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  if (pooled === 0) return 0;
  const d = (m2 - m1) / pooled;
  const j = 1 - 3 / (4 * (n1 + n2) - 9);
  return d * j;
}
