import { Thermodynamics } from './thermo.js';
import { validateReadiness, TYPES, clone } from './model.js';
import { SimulationError, invariant, finite, sum, clamp } from './numerics.js';

const scaleState = (s, factor) => ({ ...s, F: s.F * factor, H: s.H * factor, massFlow: s.massFlow * factor, volumeFlow: s.volumeFlow * factor });

/** Compile a dependency graph. Recycle block outputs are explicit tear streams. */
export function compile(project) {
  const issues = validateReadiness(project);
  invariant(!issues.some(x => x.severity === 'error'), issues.map(x => x.message).join('\n'), 'MODEL_VALIDATION', { issues });
  const nodes = new Map(project.nodes.map(n => [n.id, n]));
  const inputs = new Map(project.nodes.map(n => [n.id, []])), outputs = new Map(project.nodes.map(n => [n.id, []]));
  const tears = project.streams.filter(e => nodes.get(e.from.node).type === 'recycle' && e.kind === 'material');
  const tearIds = new Set(tears.map(e => e.id));
  const indegree = new Map(project.nodes.map(n => [n.id, 0]));
  for (const e of project.streams) {
    inputs.get(e.to.node).push(e); outputs.get(e.from.node).push(e);
    if (!tearIds.has(e.id)) indegree.set(e.to.node, indegree.get(e.to.node) + 1);
  }
  const queue = project.nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id), order = [];
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q]; order.push(nodes.get(id));
    for (const e of outputs.get(id)) if (!tearIds.has(e.id)) {
      indegree.set(e.to.node, indegree.get(e.to.node) - 1); if (indegree.get(e.to.node) === 0) queue.push(e.to.node);
    }
  }
  invariant(order.length === project.nodes.length, 'Unbroken dependency cycle. Insert a Recycle block on each material feedback loop; energy feedback loops are not supported.', 'UNBROKEN_CYCLE', { nodes: project.nodes.filter(n => !order.includes(n)).map(n => n.tag) });
  return { nodes, inputs, outputs, tears, tearIds, order };
}

function unitOperation(node, incoming, thermo, componentIds) {
  const cfg = node.cfg;
  const material = incoming.filter(s => s.kind === 'material').map(s => s.value);
  const energy = incoming.find(s => s.kind === 'energy')?.value;
  const s = material[0]; let result = {}, Q = 0, W = 0, consumed = null;
  const outPH = (state, P, h) => state.F > 1e-14 ? thermo.flashPH(state.F, state.z, P, h) : thermo.flashTP(0, state.z, state.T, P);
  const pressure = (value, fallback) => value == null ? fallback : finite(value, 'Pressure');
  switch (node.type) {
    case 'feed': {
      const z = componentIds.map(id => cfg.z[id] ?? 0);
      result.out = thermo.flashTP(cfg.F, z, cfg.T, cfg.P); break;
    }
    case 'energy': result.eout = finite(cfg.Q, 'Energy source duty'); break;
    case 'energySink': consumed = energy; break;
    case 'product': consumed = s; break;
    case 'mixer': {
      const F = sum(material.map(s => s.F)), P = Math.min(...material.map(s => s.P));
      const nc = componentIds.map((_, i) => sum(material.map(s => s.F * s.z[i])));
      const z = F > 1e-14 ? nc.map(n => n / F) : material[0].z;
      const H = sum(material.map(s => s.H));
      result.out = F > 1e-14 ? thermo.flashPH(F, z, P, H / F) : thermo.flashTP(0, z, material[0].T, P); break;
    }
    case 'splitter':
      invariant(Number.isFinite(cfg.fraction) && cfg.fraction >= 0 && cfg.fraction <= 1, 'Splitter fraction must lie in [0, 1].');
      result.out1 = scaleState(s, cfg.fraction); result.out2 = scaleState(s, 1 - cfg.fraction); break;
    case 'heater': case 'cooler': {
      finite(cfg.dP, 'Pressure drop'); invariant(cfg.dP >= 0, 'A heat-transfer block cannot increase pressure.');
      const P = s.P - cfg.dP;
      invariant(['T', 'Q'].includes(cfg.mode), 'Choose temperature or duty mode.');
      if (cfg.mode === 'T') {
        result.out = thermo.flashTP(s.F, s.z, cfg.T, P); Q = result.out.H - s.H;
      } else {
        Q = energy ?? finite(cfg.Q, 'Heat duty');
        invariant(s.F > 1e-14 || Math.abs(Q) < 1e-12, 'Nonzero duty on a zero-flow stream.');
        result.out = outPH(s, P, s.h + (s.F > 1e-14 ? Q / s.F : 0));
      }
      const sign = node.type === 'heater' ? 1 : -1;
      invariant(sign * Q >= -1e-5, `${node.type === 'heater' ? 'Heater' : 'Cooler'} has the wrong duty sign; use the opposite block type.`, 'DUTY_SIGN');
      result.qout = -Q; break;
    }
    case 'pump': {
      const P = pressure(cfg.P, s.P);
      invariant(P >= s.P - 1e-6, 'Pump outlet pressure must not be below inlet pressure.');
      invariant(cfg.efficiency > 0 && cfg.efficiency <= 1, 'Pump hydraulic efficiency must be in (0, 1].');
      invariant(s.F < 1e-14 || s.beta < 1e-8, 'This pump model accepts liquid only. Condense the feed first.', 'PUMP_VAPOR');
      W = s.F * s.vL * (P - s.P) / cfg.efficiency;
      result.out = outPH(s, P, s.h + (s.F > 1e-14 ? W / s.F : 0)); result.work = -W; break;
    }
    case 'valve': {
      const P = pressure(cfg.P, s.P);
      invariant(P <= s.P + 1e-6, 'Valve outlet pressure must not exceed inlet pressure.');
      result.out = outPH(s, P, s.h); break;
    }
    case 'flash': {
      const P = pressure(cfg.P, s.P);
      invariant(P <= s.P + 1e-6, 'Flash pressure must not exceed feed pressure.');
      invariant(['TP', 'PH'].includes(cfg.mode), 'Choose TP or PH flash mode.');
      let f;
      if (cfg.mode === 'TP') { f = thermo.flashTP(s.F, s.z, cfg.T, P); Q = f.H - s.H; }
      else {
        Q = energy ?? finite(cfg.Q, 'Flash duty');
        invariant(s.F > 1e-14 || Math.abs(Q) < 1e-12, 'Nonzero flash duty with no material flow.');
        f = outPH(s, P, s.h + (s.F > 1e-14 ? Q / s.F : 0));
      }
      result.vapor = thermo.phaseStream(f.F * f.beta, f.y, f.T, f.P, 'vapor');
      result.liquid = thermo.phaseStream(f.F * (1 - f.beta), f.x, f.T, f.P, 'liquid');
      result.qout = -Q; result.flashState = f; break;
    }
    case 'recycle': result.out = s; break;
    default: throw new SimulationError(`No implementation for ${node.type}.`, 'UNKNOWN_BLOCK');
  }
  // Independently close each unit's component and energy balances, including latent/pressure enthalpy.
  const outputStates = Object.entries(result).filter(([k, v]) => k !== 'flashState' && typeof v === 'object' && v && 'F' in v).map(([, v]) => v);
  const isBoundary = ['feed', 'product', 'energy', 'energySink'].includes(node.type);
  const componentResiduals = isBoundary ? componentIds.map(() => 0) : componentIds.map((_, i) => sum(outputStates.map(s => s.F * s.z[i])) - sum(material.map(s => s.F * s.z[i])));
  const energyResidual = isBoundary ? 0 : sum(outputStates.map(s => s.H)) - sum(material.map(s => s.H)) - Q - W;
  return { outputs: result, Q, W, consumed, componentResiduals, energyResidual,
    massResidual: sum(componentResiduals.map((v, i) => v * thermo.components[i].MW)),
    state: result.flashState ?? result.out ?? s ?? null };
}

const tearVector = (s, count) => [...s.z.map(z => z * s.F), s.H, s.P];
function vectorState(v, thermo, fallback) {
  const nc = v.slice(0, thermo.components.length), F = sum(nc);
  invariant(nc.every(n => Number.isFinite(n) && n >= 0), 'Recycle extrapolation produced negative component flow.');
  const P = v.at(-1), H = v.at(-2);
  return F > 1e-12 ? thermo.flashPH(F, nc.map(n => n / F), P, H / F) : thermo.flashTP(0, fallback.z, fallback.T, P);
}
const scaledDifference = (a, b, nc) => Math.max(...a.map((v, i) => Math.abs(v - b[i]) / (i < nc ? 1 + Math.max(Math.abs(v), Math.abs(b[i])) : i === nc ? 100 + Math.max(Math.abs(v), Math.abs(b[i])) : 1000 + Math.max(Math.abs(v), Math.abs(b[i])))));

/** Deterministic sequential modular solve with explicit tear-state fixed-point iteration. */
export function simulate(project, { onProgress = () => {} } = {}) {
  const start = performance.now(), graph = compile(project);
  const thermo = new Thermodynamics(project.components, project.method, project.settings);
  const firstFeed = project.nodes.find(n => n.type === 'feed');
  const initial = thermo.flashTP(0, project.components.map(id => firstFeed.cfg.z[id] ?? 0), firstFeed.cfg.T, firstFeed.cfg.P);
  const guesses = Object.fromEntries(graph.tears.map(e => [e.id, initial]));
  const previous = {}, trace = [], count = project.components.length;
  let streamResults = {}, blockResults = {}, candidates = {}, converged = false, iterations = 0, previousResidual = Infinity;
  const limit = graph.tears.length ? project.settings.maxIterations : 1;
  for (let iteration = 1; iteration <= limit; iteration++) {
    iterations = iteration; streamResults = { ...guesses }; blockResults = {}; candidates = {};
    for (const node of graph.order) {
      const incoming = graph.inputs.get(node.id).map(e => {
        invariant(streamResults[e.id] !== undefined, `Stream ${e.tag} is not initialized.`, 'MISSING_STATE');
        return { port: e.to.port, kind: e.kind, value: streamResults[e.id] };
      });
      let b;
      try { b = unitOperation(node, incoming, thermo, project.components); }
      catch (error) { throw new SimulationError(`${node.tag}: ${error.message}`, error.code ?? 'BLOCK_ERROR', { ...error.details, node: node.id, iteration }); }
      blockResults[node.id] = b;
      for (const edge of graph.outputs.get(node.id)) {
        const value = b.outputs[edge.from.port];
        invariant(value !== undefined, `${node.tag}: output ${edge.from.port} was not computed.`);
        if (graph.tearIds.has(edge.id)) candidates[edge.id] = value; else streamResults[edge.id] = value;
      }
    }
    let residual = 0;
    for (const e of graph.tears) residual = Math.max(residual, scaledDifference(tearVector(guesses[e.id]), tearVector(candidates[e.id]), count));
    trace.push({ iteration, residual });
    if (iteration === 1 || iteration % 5 === 0 || residual < project.settings.tolerance) onProgress({ iteration, residual });
    if (residual < project.settings.tolerance) { converged = true; break; }
    if (!Number.isFinite(residual)) throw new SimulationError('Nonfinite recycle residual.', 'RECYCLE_DIVERGENCE');
    for (const e of graph.tears) {
      const id = e.id, x = tearVector(guesses[id]), g = tearVector(candidates[id]), prev = previous[id];
      const omega = project.settings.damping;
      let next = x.map((v, i) => v + omega * (g[i] - v));
      // Bounded Wegstein extrapolation. Disabled after a residual increase, backtracked on nonphysical state.
      if (project.settings.acceleration === 'wegstein' && prev && residual < previousResidual * 1.05 && iteration % 3 === 0) {
        next = x.map((v, i) => {
          const dx = v - prev.x[i], slope = Math.abs(dx) > 1e-10 * Math.max(1, Math.abs(v)) ? (g[i] - prev.g[i]) / dx : NaN;
          const factor = Number.isFinite(slope) && slope >= 0 && slope < .98 ? Math.min(4, 1 / (1 - slope)) : omega;
          return v + factor * (g[i] - v);
        });
      }
      previous[id] = { x, g };
      try { guesses[id] = vectorState(next, thermo, initial); }
      catch { guesses[id] = vectorState(x.map((v, i) => v + omega * (g[i] - v)), thermo, initial); }
    }
    previousResidual = residual;
  }
  // Tear residuals are measured against the streams actually consumed in the final pass.
  for (const e of graph.tears) {
    const b = blockResults[e.from.node], actual = candidates[e.id], used = streamResults[e.id];
    b.componentResiduals = project.components.map((_, i) => used.F * used.z[i] - actual.F * actual.z[i]);
    b.energyResidual = used.H - actual.H;
    b.massResidual = sum(b.componentResiduals.map((v, i) => v * thermo.components[i].MW));
  }
  const feeds = project.nodes.filter(n => n.type === 'feed').map(n => blockResults[n.id].outputs.out);
  const products = project.nodes.filter(n => n.type === 'product').map(n => blockResults[n.id].consumed);
  const duties = Object.values(blockResults);
  const totalQ = sum(duties.map(b => b.Q)), totalW = sum(duties.map(b => b.W));
  const ncResiduals = project.components.map((_, i) => sum(feeds.map(s => s.F * s.z[i])) - sum(products.map(s => s.F * s.z[i])));
  const globalEnergyResidual = sum(feeds.map(s => s.H)) + totalQ + totalW - sum(products.map(s => s.H));
  const globalMassResidual = sum(ncResiduals.map((v, i) => v * thermo.components[i].MW));
  const warnings = [...new Set(Object.values(streamResults).filter(s => typeof s === 'object').flatMap(s => s.warnings))];
  if (!converged) warnings.push(`Recycle did not converge after ${iterations} iterations. Results are provisional and must not be accepted.`);
  const materialScale = Math.max(1, ...feeds.map(s => s.F)), energyScale = Math.max(100, ...feeds.map(s => Math.abs(s.H)), Math.abs(totalQ), Math.abs(totalW));
  const balanceResidual = Math.max(...ncResiduals.map(v => Math.abs(v) / materialScale), Math.abs(globalEnergyResidual) / energyScale);
  const balanceOK = balanceResidual < Math.max(1e-6, 20 * project.settings.tolerance);
  if (!balanceOK) warnings.push(`Global balance residual ${balanceResidual.toExponential(3)} exceeds acceptance tolerance.`);
  return { status: converged && balanceOK ? 'converged' : 'not-converged', converged: converged && balanceOK,
    streams: streamResults, blocks: blockResults, trace, iterations, elapsedMs: performance.now() - start, warnings,
    method: project.method, components: project.components,
    diagnostics: { recycleResidual: trace.at(-1).residual, globalEnergyResidual, globalMassResidual, componentResiduals: ncResiduals, balanceResidual, totalQ, totalW,
      feedFlow: sum(feeds.map(s => s.F)), productFlow: sum(products.map(s => s.F)), feedMass: sum(feeds.map(s => s.massFlow)), productMass: sum(products.map(s => s.massFlow)),
      maxBlockEnergyResidual: Math.max(0, ...duties.map(b => Math.abs(b.energyResidual))),
      maxBlockComponentResidual: Math.max(0, ...duties.flatMap(b => b.componentResiduals.map(Math.abs))),
      tearStreams: graph.tears.map(e => e.id), order: graph.order.map(n => n.tag) } };
}

export function sensitivity(project, spec, { onProgress = () => {} } = {}) {
  invariant(Number.isInteger(spec.points) && spec.points >= 2 && spec.points <= 101, 'Sensitivity needs 2–101 points.');
  invariant(Number.isFinite(spec.min) && Number.isFinite(spec.max) && spec.max > spec.min, 'Sensitivity range must increase.');
  const target = project.nodes.find(n => n.id === spec.node);
  invariant(target && Object.hasOwn(target.cfg, spec.parameter) && typeof target.cfg[spec.parameter] === 'number', 'Select a numerical block specification.');
  const rows = [];
  for (let i = 0; i < spec.points; i++) {
    const value = spec.min + (spec.max - spec.min) * i / (spec.points - 1), p = clone(project);
    p.nodes.find(n => n.id === spec.node).cfg[spec.parameter] = value;
    try {
      const r = simulate(p), b = r.blocks[spec.node], stream = r.streams[spec.stream];
      invariant(stream && typeof stream === 'object', 'Choose a material output stream.');
      const y = spec.metric === 'Q' ? b.Q : spec.metric === 'W' ? b.W : stream[spec.metric];
      invariant(Number.isFinite(y), 'Unsupported response variable.');
      rows.push({ value, y, status: r.status, iterations: r.iterations, residual: r.diagnostics.balanceResidual, warnings: r.warnings.length });
    } catch (error) { rows.push({ value, y: null, status: 'error', error: error.message }); }
    onProgress({ completed: i + 1, total: spec.points });
  }
  return { spec, rows };
}
