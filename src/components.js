/**
 * Antoine A/B/C and validity intervals: NIST Chemistry WebBook SRD 69, linked per species.
 * Single, continuous Antoine fit per species; no silent switching across correlations.
 * cpL, cpV, rhoL and HvapB are deliberately rounded ENGINEERING MODEL CONSTANTS,
 * not a claim to reproduce the NIST caloric/density database. See docs/THERMODYNAMICS.md.
 * SI: MW kg/mol, Cp J/(mol K), HvapB J/mol, rhoL kg/m3, temperatures K.
 */
const c = (id, name, formula, cas, MW, A, B, C, Tmin, Tmax, cpL, cpV, Tb, HvapB, rhoL, Tc) => Object.freeze({
  id, name, formula, cas, MW, antoine: { A, B, C, Tmin, Tmax }, cpL, cpV, Tb, HvapB, rhoL, Tc,
  source: `https://webbook.nist.gov/cgi/cbook.cgi?ID=C${cas.replaceAll('-', '')}&Mask=4&Type=ANTOINE&Plot=on`,
});
export const COMPONENTS = Object.freeze([
  c('benzene', 'Benzene', 'C₆H₆', '71-43-2', .0781118, 4.72583, 1660.652, -1.461, 333.4, 373.5, 136.1, 82.4, 353.24, 30720, 874, 562.02),
  c('toluene', 'Toluene', 'C₇H₈', '108-88-3', .0921384, 4.07827, 1343.943, -53.773, 308.52, 384.66, 156, 103.7, 383.75, 33180, 867, 591.75),
  c('water', 'Water', 'H₂O', '7732-18-5', .0180153, 4.6543, 1435.264, -64.848, 255.9, 373, 75.3, 33.6, 373.15, 40650, 997, 647.1),
  c('methanol', 'Methanol', 'CH₄O', '67-56-1', .0320419, 5.20409, 1581.341, -33.5, 288.1, 356.83, 81.1, 44, 337.85, 35210, 792, 512.6),
  c('ethanol', 'Ethanol', 'C₂H₆O', '64-17-5', .0460684, 5.24677, 1598.673, -46.424, 292.77, 366.63, 112.4, 65.2, 351.44, 38560, 789, 514),
  c('acetone', 'Acetone', 'C₃H₆O', '67-64-1', .0580791, 4.42448, 1312.253, -32.445, 259.16, 507.6, 125.5, 75, 329.22, 29100, 784, 508.1),
  c('hexane', 'n-Hexane', 'C₆H₁₄', '110-54-3', .0861754, 4.00266, 1171.53, -48.784, 286.18, 342.69, 198, 143, 341.88, 28850, 655, 507.8),
]);
export const COMPONENT_MAP = Object.fromEntries(COMPONENTS.map(c => [c.id, c]));
export function resolveComponents(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Object.hasOwn(COMPONENT_MAP, id)) || new Set(ids).size !== ids.length) throw new Error('Select one or more unique supported components.');
  return ids.map(id => COMPONENT_MAP[id]);
}
