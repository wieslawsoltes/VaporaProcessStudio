import { finite, invariant } from './numerics.js';
/** valueSI = value * scale + offset. Dimension identifiers prevent accidental cross-conversion. */
export const UNITS = Object.freeze({
  'K': ['temperature', 1, 0], '°C': ['temperature', 1, 273.15], '°F': ['temperature', 5 / 9, 255.3722222222222],
  'Pa': ['pressure', 1, 0], 'kPa': ['pressure', 1000, 0], 'bar': ['pressure', 100000, 0], 'atm': ['pressure', 101325, 0], 'psi': ['pressure', 6894.757293168, 0],
  'mol/s': ['molarFlow', 1, 0], 'kmol/h': ['molarFlow', 1000 / 3600, 0], 'kmol/s': ['molarFlow', 1000, 0], 'mol/h': ['molarFlow', 1 / 3600, 0],
  'kg/s': ['massFlow', 1, 0], 'kg/h': ['massFlow', 1 / 3600, 0], 'lb/h': ['massFlow', 0.45359237 / 3600, 0],
  'W': ['power', 1, 0], 'kW': ['power', 1000, 0], 'MW': ['power', 1e6, 0], 'BTU/h': ['power', 0.29307107017, 0],
  'J/mol': ['molarEnthalpy', 1, 0], 'kJ/mol': ['molarEnthalpy', 1000, 0], 'kJ/kmol': ['molarEnthalpy', 1, 0],
  '1': ['dimensionless', 1, 0], '%': ['dimensionless', 0.01, 0],
});
export function toSI(value, unit, dimension) {
  finite(value, 'Value'); const u = Object.hasOwn(UNITS, unit) ? UNITS[unit] : null;
  invariant(u && (!dimension || u[0] === dimension), `Unit ${unit} is not valid for ${dimension ?? 'this quantity'}.`, 'UNIT_MISMATCH');
  return value * u[1] + u[2];
}
export function fromSI(value, unit, dimension) {
  finite(value, 'Value'); const u = Object.hasOwn(UNITS, unit) ? UNITS[unit] : null;
  invariant(u && (!dimension || u[0] === dimension), `Invalid unit ${unit}.`, 'UNIT_MISMATCH');
  return (value - u[2]) / u[1];
}
export function convert(value, from, to) {
  invariant(Object.hasOwn(UNITS, from) && Object.hasOwn(UNITS, to) && UNITS[from][0] === UNITS[to][0], `Cannot convert ${from} to ${to}.`, 'UNIT_MISMATCH');
  return fromSI(toSI(value, from), to);
}
export const UNIT_SETS = {
  Engineering: { T: '°C', P: 'bar', F: 'kmol/h', Q: 'kW', W: 'kW', h: 'kJ/mol', massFlow: 'kg/h' },
  SI: { T: 'K', P: 'Pa', F: 'mol/s', Q: 'W', W: 'W', h: 'J/mol', massFlow: 'kg/s' },
  US: { T: '°F', P: 'psi', F: 'kmol/h', Q: 'BTU/h', W: 'BTU/h', h: 'kJ/mol', massFlow: 'lb/h' },
};
