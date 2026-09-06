import { bisect, rachfordRice, normalize, sum, dot, finite, invariant, clamp, SimulationError } from './numerics.js';
import { resolveComponents } from './components.js';
export const R = 8.31446261815324, TREF = 298.15, PREF = 101325;
export const METHODS = ['IDEAL-RAOULT', 'IDEAL-GAS'];
export class Thermodynamics {
  constructor(componentIds, method = 'IDEAL-RAOULT', { strictRange = false } = {}) {
    invariant(METHODS.includes(method), `Unsupported property method: ${method}.`);
    this.components = resolveComponents(componentIds); this.method = method; this.strictRange = strictRange;
    this.Tmin = 200; this.Tmax = method === 'IDEAL-GAS' ? 1000 : Math.min(600, ...this.components.map(c => c.Tc - 0.5));
  }
  validate(T, P, z) {
    finite(T, 'Temperature'); finite(P, 'Pressure');
    invariant(T >= this.Tmin && T <= this.Tmax, `Temperature ${T.toFixed(3)} K is outside the numerical domain ${this.Tmin}–${this.Tmax} K.`, 'THERMO_DOMAIN');
    invariant(P >= 1000 && P <= 1e7, 'Absolute pressure must be between 0.01 and 100 bar.', 'THERMO_DOMAIN');
    invariant(Array.isArray(z) && z.length === this.components.length && z.every(v => Number.isFinite(v) && v >= 0) && Math.abs(sum(z) - 1) < 1e-8, 'Mole fractions must be nonnegative and sum to 1.', 'COMPOSITION');
  }
  psat(i, T) { const { A, B, C } = this.components[i].antoine; return 1e5 * 10 ** (A - B / (T + C)); }
  hL(i, T, P = PREF) { const c = this.components[i]; return c.cpL * (T - TREF) + c.MW / c.rhoL * (P - PREF); }
  hV(i, T) { const c = this.components[i]; return c.cpL * (c.Tb - TREF) + c.HvapB + c.cpV * (T - c.Tb); }
  rangeWarnings(T, P, z) {
    const warnings = [];
    if (this.method === 'IDEAL-RAOULT') {
      this.components.forEach((c, i) => {
        if (z[i] > 1e-12 && (T < c.antoine.Tmin || T > c.antoine.Tmax)) warnings.push(`${c.name}: Antoine extrapolation at ${T.toFixed(2)} K (published interval ${c.antoine.Tmin}–${c.antoine.Tmax} K).`);
      });
      if (this.strictRange && warnings.length) throw new SimulationError(warnings.join(' '), 'PROPERTY_RANGE');
      if (P > 5e5) warnings.push('Pressure exceeds 5 bar; ideal-vapor and neglected Poynting corrections may be inaccurate.');
      if (this.components.some((c, i) => ['water', 'methanol', 'ethanol'].includes(c.id) && z[i] > 1e-10) && z.filter(v => v > 1e-10).length > 1) warnings.push('Polar mixture: ideal liquid approximation; no activity coefficients, azeotropes, or liquid–liquid equilibrium.');
    } else if (T < 250 || T > 600) warnings.push('Constant heat capacities extrapolated outside the nominal 250–600 K caloric range.');
    return warnings;
  }
  state(F, z, T, P, beta, x, y, extra = {}, checkRange = true) {
    finite(F, 'Molar flow'); invariant(F >= 0, 'Negative material flow is not permitted.');
    const hL = dot(x, this.components.map((_, i) => this.hL(i, T, P))), hV = dot(y, this.components.map((_, i) => this.hV(i, T)));
    const h = (1 - beta) * hL + beta * hV;
    const MW = dot(z, this.components.map(c => c.MW));
    const vL = dot(x, this.components.map(c => c.MW / c.rhoL));
    const molarVolume = (1 - beta) * vL + beta * R * T / P;
    return { F, z: [...z], T, P, beta, x, y, h, H: F * h, hL, hV, MW, massFlow: F * MW,
      vL, molarVolume, volumeFlow: F * molarVolume, density: MW / molarVolume,
      cp: (1 - beta) * dot(x, this.components.map(c => c.cpL)) + beta * dot(y, this.components.map(c => c.cpV)),
      phase: beta < 1e-10 ? 'Liquid' : beta > 1 - 1e-10 ? 'Vapor' : 'Two-phase',
      warnings: checkRange ? this.rangeWarnings(T, P, z) : [], residual: 0, iterations: 0, ...extra };
  }
  flashTP(F, z, T, P, { betaHint = 0, checkRange = true } = {}) {
    this.validate(T, P, z);
    if (this.method === 'IDEAL-GAS') return this.state(F, z, T, P, 1, [...z], [...z], {}, checkRange);
    const K = this.components.map((_, i) => this.psat(i, T) / P);
    const ambiguous = K.every((k, i) => z[i] < 1e-12 || Math.abs(k - 1) < 1e-9);
    const rr = ambiguous ? { beta: clamp(betaHint, 0, 1), residual: 0, iterations: 0 } : rachfordRice(z, K);
    const x = normalize(z.map((zi, i) => zi / (1 + rr.beta * (K[i] - 1))));
    const y = normalize(x.map((xi, i) => xi * K[i]));
    if (rr.beta === 1) { for (let i = 0; i < z.length; i++) y[i] = z[i]; }
    if (rr.beta === 0) { for (let i = 0; i < z.length; i++) x[i] = z[i]; }
    const result = this.state(F, z, T, P, rr.beta, x, y, { K, residual: rr.residual, iterations: rr.iterations, ambiguous }, checkRange);
    if (ambiguous && checkRange) result.warnings.push(`TP state at saturation is underdetermined; specified/default vapor fraction ${rr.beta} used. PH flash resolves quality from enthalpy.`);
    return result;
  }
  flashPH(F, z, P, h, { checkRange = true } = {}) {
    finite(h, 'Target molar enthalpy'); this.validate((this.Tmin + this.Tmax) / 2, P, z);
    // Pure-component latent-heat plateau: solve saturation temperature then apply the lever rule.
    const active = z.map((v, i) => v > 1e-13 ? i : -1).filter(i => i >= 0);
    if (this.method === 'IDEAL-RAOULT' && active.length === 1) {
      const i = active[0], { A, B, C } = this.components[i].antoine;
      const Ts = B / (A - Math.log10(P / 1e5)) - C;
      if (Ts >= this.Tmin && Ts <= this.Tmax) {
        const hl = this.hL(i, Ts, P), hv = this.hV(i, Ts);
        invariant(hv > hl, 'Caloric model has nonpositive latent heat.', 'THERMO_DOMAIN');
        if (h >= hl && h <= hv) return this.state(F, z, Ts, P, (h - hl) / (hv - hl), [...z], [...z], { phResidual: 0, iterations: 1, K: this.components.map((_, j) => this.psat(j, Ts) / P) }, checkRange);
      }
    }
    const targetScale = Math.max(1, Math.abs(h));
    const f = T => (this.flashTP(F, z, T, P, { checkRange: false }).h - h) / targetScale;
    const root = bisect(f, this.Tmin, this.Tmax, { fTol: 2e-12, xTol: 1e-11 });
    const result = this.flashTP(F, z, root.x, P, { checkRange });
    result.phResidual = result.h - h; result.iterations += root.iterations;
    invariant(Math.abs(result.phResidual) <= 1e-7 * Math.max(1, Math.abs(h)), 'PH flash failed its energy residual check.', 'PH_RESIDUAL');
    return result;
  }
  phaseStream(F, z, T, P, phase) {
    this.validate(T, P, z); return this.state(F, z, T, P, phase === 'vapor' ? 1 : 0, [...z], [...z]);
  }
  bubbleDew(z, P) {
    invariant(this.method === 'IDEAL-RAOULT', 'Bubble and dew points are not defined by IDEAL-GAS.');
    this.validate((this.Tmin + this.Tmax) / 2, P, z);
    const bubble = bisect(T => sum(z.map((v, i) => v * this.psat(i, T) / P)) - 1, this.Tmin, this.Tmax).x;
    const dew = bisect(T => sum(z.map((v, i) => v * P / this.psat(i, T))) - 1, this.Tmin, this.Tmax).x;
    return { bubble, dew };
  }
}
