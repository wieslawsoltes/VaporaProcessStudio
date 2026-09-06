/** Numerical primitives. All thermodynamic calculations use IEEE-754 binary64. */
export class SimulationError extends Error {
  constructor(message, code = 'NUMERICAL_ERROR', details = {}) {
    super(message); this.name = 'SimulationError'; this.code = code; this.details = details;
  }
}
export function invariant(condition, message, code = 'INVALID_INPUT', details = {}) {
  if (!condition) throw new SimulationError(message, code, details);
}
export function finite(value, name) {
  invariant(typeof value === 'number' && Number.isFinite(value), `${name} must be a finite number.`);
  return value;
}
/** Compensated accumulation, including signed energy sums. */
export function sum(values) {
  let s = 0, c = 0;
  for (const v of values) { const y = v - c, t = s + y; c = (t - s) - y; s = t; }
  return s;
}
export const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export function normalize(z) {
  invariant(Array.isArray(z) && z.length > 0 && z.every(x => Number.isFinite(x) && x >= 0), 'Composition must contain finite, nonnegative fractions.');
  const s = sum(z); invariant(s > 0, 'Composition cannot be all zero.');
  return z.map(x => x / s);
}
/** Bracketed, bounded root solve. A residual check prevents false convergence at discontinuities. */
export function bisect(f, lo, hi, { fTol = 1e-10, xTol = 1e-10, maxIterations = 160 } = {}) {
  let a = lo, b = hi, fa = f(a), fb = f(b);
  finite(fa, 'Lower residual'); finite(fb, 'Upper residual');
  if (Math.abs(fa) <= fTol) return { x: a, residual: fa, iterations: 0 };
  if (Math.abs(fb) <= fTol) return { x: b, residual: fb, iterations: 0 };
  invariant(fa * fb < 0, `Root is not bracketed on [${lo}, ${hi}].`, 'UNBRACKETED_ROOT', { lo, hi, fa, fb });
  for (let i = 1; i <= maxIterations; i++) {
    const m = (a + b) / 2, fm = f(m); finite(fm, 'Root residual');
    if (Math.abs(fm) <= fTol) return { x: m, residual: fm, iterations: i };
    if (b - a < xTol || m === a || m === b) {
      invariant(Math.abs(fm) <= Math.max(fTol * 100, 1e-7), 'Root interval collapsed with a nonzero residual.', 'DISCONTINUOUS_ROOT', { x: m, residual: fm });
      return { x: m, residual: fm, iterations: i };
    }
    if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  throw new SimulationError('Root solver exceeded its iteration limit.', 'ROOT_LIMIT');
}
/** Safeguarded Newton solve of the strictly decreasing Rachford–Rice equation. */
export function rachfordRice(z, K) {
  invariant(z.length === K.length && K.every(k => k > 0 && Number.isFinite(k)), 'Invalid equilibrium ratios.');
  const rr = b => sum(z.map((v, i) => v * (K[i] - 1) / (1 + b * (K[i] - 1))));
  const r0 = rr(0), r1 = rr(1);
  if (r0 <= 1e-13) return { beta: 0, residual: 0, stability: Math.max(0, r0), iterations: 0 };
  if (r1 >= -1e-13) return { beta: 1, residual: 0, stability: Math.max(0, -r1), iterations: 0 };
  let lo = 0, hi = 1, b = 0.5;
  for (let i = 0; i < 100; i++) {
    const r = rr(b);
    if (Math.abs(r) < 1e-13) return { beta: b, residual: r, stability: 0, iterations: i + 1 };
    if (r > 0) lo = b; else hi = b;
    const dr = -sum(z.map((v, j) => v * ((K[j] - 1) / (1 + b * (K[j] - 1))) ** 2));
    const n = b - r / dr;
    b = Number.isFinite(n) && n > lo && n < hi ? n : (lo + hi) / 2;
  }
  throw new SimulationError('Rachford–Rice did not converge.', 'FLASH_LIMIT');
}
