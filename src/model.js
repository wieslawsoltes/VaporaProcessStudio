import { invariant, sum } from './numerics.js';
import { COMPONENT_MAP } from './components.js';
export const SCHEMA_VERSION = 1;
const p = (id, direction, kind = 'material', side = direction === 'in' ? 'left' : 'right', offset = .5) => ({ id, direction, kind, side, offset });
export const TYPES = Object.freeze({
  feed: { name: 'Feed', group: 'Streams', symbol: 'feed', ports: [p('out', 'out')], defaults: { F: 100, T: 338.15, P: 101325, z: {} } },
  product: { name: 'Product', group: 'Streams', symbol: 'product', ports: [p('in', 'in')], defaults: {} },
  mixer: { name: 'Mixer', group: 'Mix & split', symbol: 'mixer', ports: [p('in1', 'in', 'material', 'left', .3), p('in2', 'in', 'material', 'bottom', .35), p('in3', 'in', 'material', 'top', .35), p('out', 'out')], defaults: {} },
  splitter: { name: 'Splitter', group: 'Mix & split', symbol: 'splitter', ports: [p('in', 'in'), p('out1', 'out', 'material', 'right', .3), p('out2', 'out', 'material', 'bottom', .5)], defaults: { fraction: .3 } },
  heater: { name: 'Heater', group: 'Heat transfer', symbol: 'heater', ports: [p('in', 'in'), p('out', 'out'), p('qin', 'in', 'energy', 'top'), p('qout', 'out', 'energy', 'bottom')], defaults: { mode: 'T', T: 373.15, Q: 200000, dP: 0 } },
  cooler: { name: 'Cooler', group: 'Heat transfer', symbol: 'cooler', ports: [p('in', 'in'), p('out', 'out'), p('qin', 'in', 'energy', 'top'), p('qout', 'out', 'energy', 'bottom')], defaults: { mode: 'T', T: 338.15, Q: -200000, dP: 0 } },
  pump: { name: 'Pump', group: 'Pressure', symbol: 'pump', ports: [p('in', 'in'), p('out', 'out'), p('work', 'out', 'energy', 'bottom')], defaults: { P: 300000, efficiency: .75 } },
  valve: { name: 'Valve', group: 'Pressure', symbol: 'valve', ports: [p('in', 'in'), p('out', 'out')], defaults: { P: 101325 } },
  flash: { name: 'Flash separator', group: 'Separators', symbol: 'flash', ports: [p('in', 'in'), p('vapor', 'out', 'material', 'right', .2), p('liquid', 'out', 'material', 'right', .8), p('qin', 'in', 'energy', 'top'), p('qout', 'out', 'energy', 'bottom')], defaults: { mode: 'TP', T: 368.15, P: 101325, Q: 0 } },
  recycle: { name: 'Recycle', group: 'Convergence', symbol: 'recycle', ports: [p('in', 'in'), p('out', 'out')], defaults: {} },
  energy: { name: 'Energy source', group: 'Streams', symbol: 'energy', ports: [p('eout', 'out', 'energy')], defaults: { Q: 100000 } },
  energySink: { name: 'Energy sink', group: 'Streams', symbol: 'energySink', ports: [p('ein', 'in', 'energy')], defaults: {} },
});
export const clone = data => structuredClone(data);
export const uuid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
export function createNode(type, x, y, components, index = 1) {
  invariant(Object.hasOwn(TYPES, type), `Unknown unit operation ${type}.`);
  const cfg = clone(TYPES[type].defaults);
  if (type === 'feed') cfg.z = Object.fromEntries(components.map(id => [id, 1 / components.length]));
  const prefixes = { feed: 'FEED', product: 'PROD', mixer: 'M', splitter: 'S', heater: 'E', cooler: 'C', pump: 'P', valve: 'V', flash: 'F', recycle: 'R', energy: 'Q', energySink: 'DUTY' };
  return { id: uuid('block'), tag: `${prefixes[type]}-${100 + index}`, type, x, y, cfg };
}
export function emptyProject() {
  return { schemaVersion: SCHEMA_VERSION, name: 'Untitled process', description: 'Steady-state process simulation', components: ['benzene', 'toluene'], method: 'IDEAL-RAOULT',
    settings: { tolerance: 1e-8, maxIterations: 250, damping: .7, acceleration: 'wegstein', strictRange: false },
    nodes: [], streams: [], view: { x: 35, y: 40, zoom: 1 }, units: 'Engineering' };
}
export function demoProject() {
  const project = emptyProject(); project.name = 'Aromatics recovery'; project.description = 'Benzene / toluene separation with liquid recycle';
  const n = (id, tag, type, x, y, cfg = {}) => ({ id, tag, type, x, y, cfg: { ...clone(TYPES[type].defaults), ...cfg } });
  project.nodes = [
    n('feed', 'FEED-101', 'feed', 50, 170, { F: 100, z: { benzene: .55, toluene: .45 } }),
    n('mixer', 'M-101', 'mixer', 240, 170),
    n('pump', 'P-101', 'pump', 430, 170),
    n('heater', 'E-101', 'heater', 620, 170),
    n('valve', 'V-101', 'valve', 810, 170),
    n('flash', 'F-201', 'flash', 1000, 170),
    n('vapor', 'DISTILLATE', 'product', 1240, 80),
    n('splitter', 'S-101', 'splitter', 1230, 300, { fraction: .35 }),
    n('bottoms', 'BOTTOMS', 'product', 1450, 300),
    n('cooler', 'E-102', 'cooler', 970, 440),
    n('recycle', 'R-101', 'recycle', 520, 440),
    n('utility', 'Q-RECOVERED', 'energySink', 1350, 470),
  ];
  project.nodes.find(n => n.id === 'cooler').flip = true;
  project.nodes.find(n => n.id === 'recycle').flip = true;
  const e = (id, from, fp, to, tp, extra = {}) => ({ id, tag: id, kind: 'material', from: { node: from, port: fp }, to: { node: to, port: tp }, ...extra });
  project.streams = [
    e('FEED', 'feed', 'out', 'mixer', 'in1'), e('MIXED', 'mixer', 'out', 'pump', 'in'),
    e('PRESSURIZED', 'pump', 'out', 'heater', 'in'), e('HOT-FEED', 'heater', 'out', 'valve', 'in'),
    e('FLASH-FEED', 'valve', 'out', 'flash', 'in'), e('VAPOR', 'flash', 'vapor', 'vapor', 'in'),
    e('LIQUID', 'flash', 'liquid', 'splitter', 'in'), e('PRODUCT', 'splitter', 'out1', 'bottoms', 'in'),
    e('RECYCLE-HOT', 'splitter', 'out2', 'cooler', 'in'), e('RECYCLE-COLD', 'cooler', 'out', 'recycle', 'in'),
    e('RECYCLE', 'recycle', 'out', 'mixer', 'in2'),
    e('Q-102', 'cooler', 'qout', 'utility', 'ein', { kind: 'energy' }),
  ];
  return project;
}
export function getPort(node, id) { return TYPES[node.type]?.ports.find(p => p.id === id); }
export function checkConnection(project, from, to, kind) {
  const a = project.nodes.find(n => n.id === from.node), b = project.nodes.find(n => n.id === to.node);
  invariant(a && b && a.id !== b.id, 'Connect two different blocks.');
  const pa = getPort(a, from.port), pb = getPort(b, to.port);
  invariant(pa?.direction === 'out' && pb?.direction === 'in' && pa.kind === kind && pb.kind === kind, 'Connect compatible output and input ports.');
  invariant(!project.streams.some(e => e.from.node === a.id && e.from.port === pa.id), 'Output already connected. Insert a splitter to branch material.');
  invariant(!project.streams.some(e => e.to.node === b.id && e.to.port === pb.id), 'Input already connected. Use a mixer to combine material.');
}
/** Structural schema validation is separate from run readiness, allowing incomplete projects to be saved. */
export function validateProjectData(project) {
  invariant(project && typeof project === 'object' && project.schemaVersion === SCHEMA_VERSION, 'Unsupported or missing project schema version.');
  invariant(typeof project.name === 'string' && project.name.length <= 200, 'Invalid project name.');
  invariant(Array.isArray(project.components) && project.components.length > 0 && project.components.every(id => Object.hasOwn(COMPONENT_MAP, id)) && new Set(project.components).size === project.components.length, 'Invalid component selection.');
  invariant(['IDEAL-RAOULT', 'IDEAL-GAS'].includes(project.method), 'Unsupported thermodynamic model.');
  invariant(Array.isArray(project.nodes) && Array.isArray(project.streams) && project.nodes.length <= 2000 && project.streams.length <= 10000, 'Project must contain at most 2,000 blocks and 10,000 streams.');
  const ids = new Set();
  for (const n of project.nodes) {
    invariant(n && typeof n.id === 'string' && n.id.length > 0 && n.id.length <= 200 && !['__proto__','prototype','constructor'].includes(n.id) && !ids.has(n.id) && Object.hasOwn(TYPES, n.type) && typeof n.tag === 'string' && n.tag.length <= 100 && Number.isFinite(n.x) && Number.isFinite(n.y) && n.cfg && typeof n.cfg === 'object', 'Invalid or duplicate block.'); ids.add(n.id);
  }
  for (const n of project.nodes) {
    invariant(!Array.isArray(n.cfg), `${n.tag}: specifications must be an object.`);
    for (const [key, value] of Object.entries(TYPES[n.type].defaults)) {
      invariant(Object.hasOwn(n.cfg, key), `${n.tag}: missing specification ${key}.`);
      if (typeof value === 'number') invariant(Number.isFinite(n.cfg[key]), `${n.tag}: ${key} must be a finite number.`);
      else if (typeof value === 'string') invariant(typeof n.cfg[key] === 'string', `${n.tag}: invalid ${key}.`);
    }
    if (n.type === 'feed') invariant(n.cfg.z && typeof n.cfg.z === 'object' && !Array.isArray(n.cfg.z), `${n.tag}: composition must be an object.`);
    if (['heater', 'cooler'].includes(n.type)) invariant(['T', 'Q'].includes(n.cfg.mode), `${n.tag}: invalid thermal specification mode.`);
    if (n.type === 'flash') invariant(['TP', 'PH'].includes(n.cfg.mode), `${n.tag}: invalid flash specification mode.`);
  }
  invariant(project.units === undefined || ['Engineering', 'SI', 'US'].includes(project.units), 'Invalid display unit set.');
  const eids = new Set();
  for (const e of project.streams) {
    invariant(e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 200 && !['__proto__','prototype','constructor'].includes(e.id) && !eids.has(e.id) && typeof e.tag === 'string' && e.tag.length <= 100 && ['material', 'energy'].includes(e.kind), 'Invalid or duplicate stream.'); eids.add(e.id);
    invariant(e.from && e.to && ids.has(e.from.node) && ids.has(e.to.node), 'Stream refers to an absent block.');
  }
  const s = project.settings;
  invariant(s && Number.isFinite(s.tolerance) && s.tolerance >= 1e-12 && s.tolerance <= .001, 'Convergence tolerance must be 1e-12 to 1e-3.');
  invariant(Number.isInteger(s.maxIterations) && s.maxIterations >= 1 && s.maxIterations <= 5000, 'Maximum iterations must be 1–5000.');
  invariant(s.damping > 0 && s.damping <= 1 && ['none', 'wegstein'].includes(s.acceleration), 'Invalid recycle solver settings.');
  return project;
}
export function parseProject(text) {
  invariant(typeof text === 'string' && text.length <= 10_000_000, 'Project file is too large.');
  // Reject prototype-related keys even though project data is never executed.
  const parsed = JSON.parse(text, (key, value) => { invariant(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe project key.'); return value; });
  return validateProjectData(parsed);
}
export function validateReadiness(project) {
  const issues = [];
  try { validateProjectData(project); } catch (e) { return [{ severity: 'error', message: e.message }]; }
  if (!project.nodes.some(n => n.type === 'feed')) issues.push({ severity: 'error', message: 'Add at least one material feed.' });
  if (!project.nodes.some(n => n.type === 'product')) issues.push({ severity: 'error', message: 'Add at least one material product outlet.' });
  const fromSet = new Set(), toSet = new Set();
  for (const e of project.streams) {
    const a = project.nodes.find(n => n.id === e.from.node), b = project.nodes.find(n => n.id === e.to.node);
    const pa = getPort(a, e.from.port), pb = getPort(b, e.to.port), fk = `${a.id}/${e.from.port}`, tk = `${b.id}/${e.to.port}`;
    if (a === b || pa?.direction !== 'out' || pb?.direction !== 'in' || pa.kind !== e.kind || pb.kind !== e.kind || fromSet.has(fk) || toSet.has(tk)) issues.push({ severity: 'error', message: `${e.tag}: incompatible or multiply-connected ports.`, stream: e.id });
    fromSet.add(fk); toSet.add(tk);
  }
  for (const n of project.nodes) {
    for (const p of TYPES[n.type].ports) {
      const connected = (p.direction === 'in' ? toSet : fromSet).has(`${n.id}/${p.id}`);
      const required = p.kind === 'material' && n.type !== 'mixer' || n.type === 'mixer' && p.direction === 'out' || ['energy', 'energySink'].includes(n.type);
      if (required && !connected) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: connect ${p.id}.` });
    }
    if (n.type === 'mixer' && !project.streams.some(e => e.kind === 'material' && e.to.node === n.id)) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: at least one inlet is required.` });
    if (toSet.has(`${n.id}/qin`) && !['Q', 'PH'].includes(n.cfg.mode)) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: use duty/PH mode to consume an energy stream.` });
    if (toSet.has(`${n.id}/qin`) && fromSet.has(`${n.id}/qout`)) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: an energy input and exported-duty output cannot be specified simultaneously.` });
    if (n.type === 'feed') {
      const z = project.components.map(id => n.cfg.z?.[id] ?? 0);
      if (z.some(x => !Number.isFinite(x) || x < 0) || Math.abs(sum(z) - 1) > 1e-8) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: mole fractions must sum to 1.` });
      if (!Number.isFinite(n.cfg.F) || n.cfg.F <= 0) issues.push({ severity: 'error', node: n.id, message: `${n.tag}: feed molar flow must be positive.` });
    }
  }
  return issues;
}
/** Transactions contain only semantic project state. Results are invalidated rather than stored in undo history. */
export class History {
  constructor(limit = 100) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  commit(before, after, label = 'Edit') {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.undoStack.push({ before: clone(before), after: clone(after), label });
    if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack.length = 0; return true;
  }
  undo() { const e = this.undoStack.pop(); if (!e) return null; this.redoStack.push(e); return clone(e.before); }
  redo() { const e = this.redoStack.pop(); if (!e) return null; this.undoStack.push(e); return clone(e.after); }
  clear() { this.undoStack.length = this.redoStack.length = 0; }
}
