import { demoProject, emptyProject, createNode, TYPES, clone, uuid, History, checkConnection, parseProject, validateReadiness } from './model.js';
import { COMPONENTS, COMPONENT_MAP } from './components.js';
import { Thermodynamics } from './thermo.js';
import { sum, invariant } from './numerics.js';
import { fromSI, toSI, UNIT_SETS } from './units.js';
import { FlowsheetRenderer } from './renderer.js';
import { icon } from './icons.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const sci = value => Number.isFinite(value) ? (value === 0 ? '0' : value.toExponential(2)) : '—';
const STORAGE_KEY = 'vapora-project-v1';
let project = demoProject(), results = null, selected = { kind: 'node', id: 'flash' }, page = 'flowsheet', reportTab = 'streams', inspectorTab = 'specs', paletteGroup = 'all';
let revision = 0, runCounter = 0, worker = null, workerObjectURL = null, busy = false, activeJob = '', logs = [], sensitivityResult = null, toastTimer, saveTimer;
let history = new History(), renderer, dirty = false, autoRun = true;
let sensitivitySpec = { node: 'flash', parameter: 'T', min: 363.15, max: 372.15, points: 13, stream: 'VAPOR', metric: 'F' };
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { project = parseProject(saved); selected = project.nodes.some(n=>n.id==='flash') ? {kind:'node',id:'flash'} : project.nodes[0] ? {kind:'node',id:project.nodes[0].id} : null; } } catch { /* A corrupt or unavailable local store must not prevent startup. */ }
const unitSet = () => UNIT_SETS[project.units] ?? UNIT_SETS.Engineering;
const unitFor = key => unitSet()[key] ?? (key === 'dP' ? unitSet().P : key === 'efficiency' || key === 'fraction' ? '%' : '1');
const displayValue = (key, value, digits = 3) => num(fromSI(value, unitFor(key)), digits);
const btn = (action, name, text, cls = '') => `<button class="btn ${cls}" data-action="${action}" title="${esc(text)}">${icon(name)}<span>${esc(text)}</span></button>`;
const ib = (action, name, title, cls = '') => `<button class="iconbtn ${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}">${icon(name)}</button>`;
const ri = (action, name, text, cls = '') => `<button class="ribbon-item ${cls}" data-action="${action}" title="${esc(text)}">${icon(name)}<span>${esc(text)}</span></button>`;
function log(message, type = 'info') { logs.push({ time: new Date().toLocaleTimeString('en-GB'), message, type }); if (logs.length > 400) logs.shift(); if(reportTab==='log')renderReport(); }
function toast(message) { const e=$('#toast');e.textContent=message;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),4500); }
function persist() { clearTimeout(saveTimer); saveTimer=setTimeout(()=>{try{project.view={...renderer.camera};localStorage.setItem(STORAGE_KEY,JSON.stringify(project));dirty=false;$('#saved-state').textContent='Saved locally';}catch{ $('#saved-state').textContent='Local save unavailable'; }},200); }
function invalidateResults(){results=null;sensitivityResult=null;revision++;if(busy)cancelRun(false);}
function transact(label, mutate, { physics = true } = {}) {
  const before=clone(project);mutate(project);if(history.commit(before,project,label)){
    if(physics)invalidateResults();dirty=true;persist();log(label);renderAll();
  }
}
function setSelection(selection){selected=selection;inspectorTab='specs';renderInspector();renderTree();renderer.setScene(project,results,selected);if(innerWidth<=620&&selection)document.body.classList.add('mobile-inspector');}
function mount(){
  $('#app').innerHTML=`
    <header class="titlebar">
      <div class="brand"><div class="brand-logo"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m7 8 9 17L25 8M12 8l4 8 4-8"/></svg></div><span class="brand-name">vapora</span><span class="brand-sub">PROCESS STUDIO</span></div>
      <div class="project-crumb"><span>Workspace</span>${icon('right','icon-sm')}<strong id="breadcrumb-name"></strong></div>
      <div class="spacer"></div><span class="autosave flex">${icon('check','icon-sm')}<span id="saved-state">Local workspace</span></span>
      ${btn('export','export','Export','small')}<div class="avatar" title="Local workspace · no account required">VP</div>
    </header>
    <nav class="menubar" aria-label="Application menu">
      <button class="menu-tab active" data-action="menu-home">Home</button><button class="menu-tab" data-action="menu-flowsheet">Flowsheet</button><button class="menu-tab" data-action="menu-properties">Properties</button><button class="menu-tab" data-action="menu-analysis">Analysis</button><button class="menu-tab" data-action="menu-view">View</button><button class="menu-tab" data-action="help">Help</button>
      <div class="menu-right">${icon('info','icon-sm')} IDEAL PROPERTY MODELS <span class="badge">v1.0</span></div>
    </nav>
    <section class="ribbon" aria-label="Process tools">
      <div class="ribbon-group">${ri('new','file','New')}${ri('open','open','Open')}${ri('save','save','Save')}</div>
      <div class="ribbon-group">${ri('undo','undo','Undo')}${ri('redo','redo','Redo')}${ri('components','atom','Components')}${ri('methods','layers','Methods')}</div>
      <div class="ribbon-group">${ri('tool-connect','connect','Material stream')}${ri('tool-energy','energy','Energy stream')}${ri('validate','check','Check input')}</div>
      <div class="ribbon-group optional">${ri('sensitivity','chart','Sensitivity')}${ri('reports','table','Results')}</div>
      <div class="ribbon-right"><div class="ribbon-label">Property method<strong id="ribbon-method">IDEAL-RAOULT</strong></div>${ib('settings','gear','Solver settings')}${btn('run','play','Run simulation','primary run-button')}${ib('cancel','stop','Stop calculation')}</div>
    </section>
    <main class="workbench">
      <aside class="left-panel"><div class="panel-heading">${icon('folder','icon-sm')} Project explorer<small>LOCAL</small></div><div class="tree-search">${icon('search')}<input id="tree-search" placeholder="Search blocks and streams" aria-label="Search project" /></div><div id="tree" class="tree"></div><div class="project-bottom">${icon('info')}<div><strong>Transparent by design</strong>Every result is calculated.<br>Every model is documented.</div></div></aside>
      <section class="center" id="center">
        <div class="workspace-heading"><div><h1 id="project-title"></h1><p id="project-description"></p></div><span class="badge">STEADY STATE</span><div class="actions">${btn('project-settings','gear','Setup','small')}<span id="run-pill"></span></div></div>
        <div class="kpis" id="kpis"></div>
        <div class="workspace-tabs"><button data-page="flowsheet" class="workspace-tab active">${icon('flow')}Flowsheet</button><button data-page="reports" class="workspace-tab">${icon('table')}Stream reports</button><button data-page="sensitivity" class="workspace-tab">${icon('chart')}Sensitivity</button><button data-page="properties" class="workspace-tab">${icon('layers')}Properties</button><div class="workspace-tab-right">${icon('folder','icon-sm')} MAIN</div></div>
        <div class="workspace-view">
          <div id="flowsheet-view"><div id="viewport" role="application" aria-label="Interactive process flowsheet"></div>
            <div class="canvas-toolbar">${ib('tool-select','cursor','Select and move (V)','active')}${ib('tool-pan','hand','Pan (H / Space)')}<span class="separator"></span>${ib('tool-connect','connect','Connect material ports (C)')}${ib('tool-energy','energy','Connect energy ports (E)')}<span class="separator"></span>${ib('fit','fit','Fit flowsheet (F)')}${ib('focus-mode','layers','Expand workspace')}</div>
            <div class="canvas-scope"><span></span> PROCESS FLOWSHEET / 01</div>
            <div class="canvas-legend"><span><i class="legend-line"></i>Material</span><span><i class="legend-line energy"></i>Energy</span><span>SI calculation basis</span></div>
            <div class="hint-chip hidden" id="canvas-hint"></div>
            <div class="zoom-controls">${ib('zoom-out','zoomout','Zoom out')}<span id="zoom-level">100%</span>${ib('zoom-in','zoomin','Zoom in')}${ib('fit','fit','Zoom to fit')}</div>
          </div><div id="page-content" class="main-page hidden"></div><div id="progress-line" class="progress-line" style="width:0"></div>
        </div>
        <div class="palette"><div class="palette-head"><strong>Model library</strong><button class="active" data-palette="all">All blocks</button><button data-palette="streams">Streams</button><button data-palette="thermal">Heat & pressure</button><span class="palette-hint">Choose a block, then click to place</span></div><div class="palette-items" id="palette-items"></div></div>
        <section class="report-dock"><div class="report-tabs"><button class="report-tab active" data-report="streams">${icon('table')}Stream summary <span id="stream-count" class="report-count"></span></button><button class="report-tab" data-report="blocks">${icon('layers')}Block results</button><button class="report-tab" data-report="convergence">${icon('chart')}Convergence</button><button class="report-tab" data-report="log">${icon('terminal')}Run log</button><span class="spacer"></span>${ib('csv','export','Export current results as CSV')}</div><div id="report-body" class="report-body"></div></section>
      </section>
      <aside class="inspector" id="inspector"></aside>
    </main>
    <footer class="statusbar"><span id="status-icon">${icon('check')}</span><strong id="status-text">Ready</strong><span class="status-bar-separator"></span><span id="status-detail">No calculation yet</span><div class="status-right"><span id="object-count" class="optional"></span><span class="status-bar-separator optional"></span><button data-action="units" id="units-label">Units: Engineering</button><span class="status-bar-separator"></span><span id="backend">Initializing renderer</span></div></footer>`;
  renderer=new FlowsheetRenderer($('#viewport'),{
    onSelect:setSelection,onInspect:s=>{setSelection(s);inspectorTab='results';renderInspector();},
    onMove:(id,x,y)=>transact('Move block',p=>Object.assign(p.nodes.find(n=>n.id===id),{x,y}),{physics:false}),
    onAdd:(type,x,y)=>{transact(`Add ${TYPES[type].name}`,p=>{const n=createNode(type,Math.round(x/10)*10,Math.round(y/10)*10,p.components,p.nodes.length+1);p.nodes.push(n);selected={kind:'node',id:n.id};});setTool('select');},
    onConnect:(from,to,kind)=>{try{checkConnection(project,from,to,kind);transact('Connect stream',p=>{const edge={id:uuid('stream'),tag:`${kind==='energy'?'Q':'S'}-${101+p.streams.length}`,kind,from,to};p.streams.push(edge);selected={kind:'stream',id:edge.id};});}catch(error){toast(error.message);}},
    onBackend:mode=>{$('#backend').textContent=mode;log(mode==='WebGPU'?'WebGPU geometry renderer initialized.':'WebGPU unavailable: using the functional Canvas 2D fallback.');},
    onError:message=>log(message,'error'),onHint:toast,
    onView:view=>{$('#zoom-level').textContent=Math.round(view.zoom*100)+'%';},
  });
  renderAll();requestAnimationFrame(()=>requestAnimationFrame(()=>{renderer.fit();}));
}
function renderAll(){
  $('#project-title').textContent=project.name;$('#project-description').textContent=project.description||'Steady-state process simulation';$('#breadcrumb-name').textContent=project.name;
  $('#ribbon-method').textContent=project.method;$('#units-label').textContent=`Units: ${project.units||'Engineering'}`;
  $('#object-count').textContent=`${project.nodes.length} blocks · ${project.streams.length} streams`;
  $('#stream-count').textContent=project.streams.filter(e=>e.kind==='material').length;
  document.querySelectorAll('[data-action=undo]').forEach(b=>b.disabled=!history.undoStack.length);
  document.querySelectorAll('[data-action=redo]').forEach(b=>b.disabled=!history.redoStack.length);
  document.querySelectorAll('[data-action=run]').forEach(b=>b.disabled=busy);
  document.querySelectorAll('[data-action=cancel]').forEach(b=>b.disabled=!busy);
  renderKpis();renderTree();renderInspector();renderPalette();renderReport();renderPage();renderer.setScene(project,results,selected);renderStatus();
}
function renderKpis(){
  const d=results?.diagnostics;
  const cards=[['feed','Feed throughput',d?displayValue('F',d.feedFlow,1):'—',unitFor('F')],['energy','Net heat duty',d?displayValue('Q',d.totalQ,1):'—',unitFor('Q')],['pump','Shaft power',d?displayValue('W',d.totalW,2):'—',unitFor('W')],['check','Balance residual',d?sci(d.balanceResidual):'—','scaled']];
  $('#kpis').innerHTML=cards.map(([ic,label,val,unit])=>`<div class="kpi"><div class="kpi-label">${icon(ic)}${label}</div><div class="kpi-value">${val}<small>${unit}</small></div></div>`).join('');
  $('#run-pill').innerHTML=busy?'<span class="pill pending"><i class="dot"></i>Calculating</span>':results?`<span class="pill ${results.converged?'':'error'}"><i class="dot"></i>${results.converged?'Converged':'Not converged'}</span>`:'<span class="pill pending"><i class="dot"></i>Needs run</span>';
}
function renderTree(){
  const query=($('#tree-search')?.value??'').toLowerCase();
  const treeNode=n=>`<button class="tree-item child ${selected?.kind==='node'&&selected.id===n.id?'selected':''}" data-node="${esc(n.id)}">${icon(TYPES[n.type].symbol)}<span>${esc(n.tag)}</span></button>`;
  const treeEdge=e=>`<button class="tree-item child ${selected?.kind==='stream'&&selected.id===e.id?'selected':''}" data-stream="${esc(e.id)}">${icon(e.kind==='energy'?'energy':'connect')}<span>${esc(e.tag)}</span></button>`;
  $('#tree').innerHTML=`<button class="tree-item" data-action="project-settings">${icon('down','icon-sm')}${icon('folder')}<strong title="${esc(project.name)}">${esc(project.name.length>19?project.name.slice(0,17)+'…':project.name)}</strong></button>
    <div class="tree-section">SIMULATION BASIS</div><button class="tree-item" data-action="components">${icon('atom')}Components<span class="tree-count">${project.components.length}</span></button><button class="tree-item" data-action="methods">${icon('layers')}Property methods<span class="tree-dot"></span></button><button class="tree-item" data-action="settings">${icon('gear')}Convergence settings</button>
    <div class="tree-section">FLOWSHEET</div><button class="tree-item ${page==='flowsheet'?'selected':''}" data-page="flowsheet">${icon('flow')}Main flowsheet<span class="tree-count">01</span></button>
    <details open><summary class="tree-item">${icon('down','icon-sm')}${icon('layers')}Blocks<span class="tree-count">${project.nodes.length}</span></summary>${project.nodes.filter(n=>!query||n.tag.toLowerCase().includes(query)||n.type.includes(query)).map(treeNode).join('')}</details>
    <details ${query?'open':''}><summary class="tree-item">${icon('right','icon-sm')}${icon('connect')}Streams<span class="tree-count">${project.streams.length}</span></summary>${project.streams.filter(e=>!query||e.tag.toLowerCase().includes(query)).map(treeEdge).join('')}</details>
    <div class="tree-section">ANALYSIS</div><button class="tree-item" data-page="reports">${icon('table')}Results summary</button><button class="tree-item" data-page="sensitivity">${icon('chart')}Sensitivity study</button><button class="tree-item" data-action="validate">${icon('check')}Input diagnostics</button>`;
}
function renderPalette(){
  const types=Object.entries(TYPES).filter(([id])=>paletteGroup==='streams'?['feed','product','energy','energySink'].includes(id):paletteGroup==='thermal'?['heater','cooler','pump','valve','flash'].includes(id):!['energySink'].includes(id));
  $('#palette-items').innerHTML=types.map(([id,t])=>`<button class="palette-item ${renderer.tool===`add:${id}`?'active':''}" data-add="${id}" title="Place ${t.name}">${icon(t.symbol)}<span>${t.name==='Flash separator'?'Flash':t.name}</span></button>`).join('');
  document.querySelectorAll('[data-palette]').forEach(b=>b.classList.toggle('active',b.dataset.palette===paletteGroup));
}
function renderStatus(){
  if(busy)return;
  const text=results?(results.converged?'Simulation converged':'Convergence not achieved'):'Ready to simulate';
  $('#status-text').textContent=text;$('#status-icon').innerHTML=icon(results&&!results.converged?'warning':'check');
  $('#status-detail').textContent=results?`${results.iterations} iteration${results.iterations===1?'':'s'} · ${num(results.elapsedMs,1)} ms · ${results.warnings.length} warning${results.warnings.length===1?'':'s'}`:'Edit the process, then run the solver';
}
function field(key,label,value,unit=unitFor(key),{disabled=false,text=false}={}){
  const display=text?value:Number.isFinite(value)?Number(fromSI(value,unit).toPrecision(10)):'';
  return `<label class="field"><span>${esc(label)}</span><div class="field-input"><input name="${esc(key)}" data-unit="${esc(unit)}" type="${text?'text':'number'}" ${text?'maxlength="100"':'step="any"'} value="${esc(display)}" ${disabled?'disabled':''}/>${text?'':`<span class="unit">${esc(unit)}</span>`}</div></label>`;
}
function choice(key,label,value,options){return `<label class="field"><span>${esc(label)}</span><div class="field-input"><select name="${esc(key)}">${options.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></div></label>`;}
function stateRows(s){if(!s)return '<div class="notice">Run the model to calculate this state.</div>';return [
  ['Temperature',displayValue('T',s.T,3)+' '+unitFor('T')],['Absolute pressure',displayValue('P',s.P,4)+' '+unitFor('P')],['Molar flow',displayValue('F',s.F,4)+' '+unitFor('F')],['Mass flow',displayValue('massFlow',s.massFlow,3)+' '+unitFor('massFlow')],['Vapor fraction',num(s.beta,6)],['Molar enthalpy',displayValue('h',s.h,5)+' '+unitFor('h')],['Enthalpy flow',displayValue('Q',s.H,3)+' '+unitFor('Q')],['Density estimate',num(s.density,3)+' kg/m³'],['Frozen-phase Cp',num(s.cp,3)+' J/mol·K'],['Phase',s.phase],
].map(([a,b])=>`<div class="property-row"><span>${a}</span><strong>${b}</strong></div>`).join('');}
function compositionView(s){return `<hr class="inspector-divider"><div class="section-label">Overall mole fractions</div>${project.components.map((id,i)=>`<div class="composition-row"><div class="line"><span>${esc(COMPONENT_MAP[id].name)}</span><span class="mono">${num(s.z[i],6)}</span></div><div class="composition-bar"><i style="width:${s.z[i]*100}%"></i></div></div>`).join('')}`;}
function renderInspector(){
  const n=selected?.kind==='node'?project.nodes.find(n=>n.id===selected.id):null;
  const e=selected?.kind==='stream'?project.streams.find(e=>e.id===selected.id):null;
  if(!n&&!e){$('#inspector').innerHTML=`<div class="panel-heading">${icon('info')}Process overview${ib('close-inspector','close','Close inspector')}</div><div class="inspector-content"><div class="section-label">Simulation basis</div><h3 style="font-size:16px;font-weight:550">${esc(project.name)}</h3><div class="notice">Select a block to edit its specifications, or select a stream to inspect computed properties.</div><div class="property-row"><span>Components</span><strong>${project.components.length}</strong></div><div class="property-row"><span>Property model</span><strong>${project.method}</strong></div><div class="property-row"><span>Unit operations</span><strong>${project.nodes.length}</strong></div><hr class="inspector-divider">${btn('components','atom','Manage components','small')}<div class="notice warning">Ideal-mixture model. Not a certified design or safety calculation.</div></div>`;return;}
  const title=n?.tag??e.tag, type=n?TYPES[n.type].name:e.kind==='material'?'Material stream':'Energy stream', result=n?results?.blocks[n.id]:results?.streams[e.id];
  const h=`<div class="panel-heading">${icon('info','icon-sm')}Property inspector<span class="spacer"></span>${ib('close-inspector','close','Close inspector')}</div><div class="inspector-head"><div class="inspector-title"><div class="inspector-icon">${icon(n?TYPES[n.type].symbol:e.kind==='material'?'connect':'energy')}</div><div><h2>${esc(title)}</h2><p>${type}</p></div></div><div class="inspector-mini-status"><span>${n?'BLOCK':'STREAM'} SPECIFICATIONS</span><span class="pill ${result!=null?'':'pending'}"><i class="dot"></i>${result!=null?'Calculated':'Needs run'}</span></div></div><div class="inspector-tabs"><button data-inspector="specs" class="${inspectorTab==='specs'?'active':''}">Specifications</button><button data-inspector="results" class="${inspectorTab==='results'?'active':''}">Results</button></div>`;
  let body='';
  if(inspectorTab==='results'){
    if(result==null)body='<div class="notice">Run the simulation to calculate results for this object.</div>'+btn('run','play','Run simulation','primary small');
    else if(e){body=e.kind==='energy'?`<div class="result-card"><div class="label">Signed energy transfer</div><div class="value">${displayValue('Q',result,2)}<small>${unitFor('Q')}</small></div></div><div class="notice">Positive means energy supplied to the receiving unit. A negative exported duty represents energy demand by the source block.</div>`:stateRows(result)+compositionView(result);}
    else{
      if(n.type==='flash'){
        const v=result.outputs.vapor,l=result.outputs.liquid;
        body+=`<div class="section-label">Phase separation</div><div class="result-grid"><div class="result-card"><div class="label">Vapor fraction</div><div class="value">${num(result.state.beta,4)}</div></div><div class="result-card"><div class="label">Liquid fraction</div><div class="value">${num(1-result.state.beta,4)}</div></div></div><div class="property-row"><span>Vapor flow</span><strong>${displayValue('F',v.F,3)} ${unitFor('F')}</strong></div><div class="property-row"><span>Liquid flow</span><strong>${displayValue('F',l.F,3)} ${unitFor('F')}</strong></div>`;
      }
      body+=`<div class="property-row"><span>Heat into material</span><strong>${displayValue('Q',result.Q,3)} ${unitFor('Q')}</strong></div><div class="property-row"><span>Shaft work input</span><strong>${displayValue('W',result.W,4)} ${unitFor('W')}</strong></div><div class="property-row"><span>Energy residual</span><strong>${sci(result.energyResidual)} W</strong></div><div class="property-row"><span>Max component residual</span><strong>${sci(Math.max(0,...result.componentResiduals.map(Math.abs)))} mol/s</strong></div>`;
      if(result.state&&typeof result.state==='object'){body+=`<hr class="inspector-divider"><div class="section-label">${n.type==='product'?'Product':'Block'} state</div>`+stateRows(result.state)+compositionView(result.state);}
      if(['energy','energySink'].includes(n.type))body+=`<div class="result-card"><div class="label">Energy boundary</div><div class="value">${displayValue('Q',n.type==='energy'?result.outputs.eout:result.consumed,2)}<small>${unitFor('Q')}</small></div></div>`;
    }
  } else {
    body=`<form id="inspector-form"><div class="section-label">Identification</div>${field('tag','Tag',title,'1',{text:true})}`;
    if(n){const c=n.cfg;
      body+='<hr class="inspector-divider"><div class="section-label">Operating conditions</div>';
      switch(n.type){
        case 'feed':body+=field('F','Molar flow',c.F)+field('T','Temperature',c.T)+field('P','Absolute pressure',c.P)+`<hr class="inspector-divider"><div class="section-label">Mole fractions</div><table class="composition-edit">${project.components.map(id=>`<tr><td>${esc(COMPONENT_MAP[id].name)}</td><td><input name="z:${id}" type="number" min="0" max="1" step="any" value="${esc(c.z[id]??0)}" aria-label="${esc(COMPONENT_MAP[id].name)} mole fraction"></td></tr>`).join('')}</table><div class="sum-line"><span>Sum</span><span id="composition-sum" class="mono">${num(sum(project.components.map(id=>c.z[id]??0)),6)}</span></div>${btn('normalize','check','Normalize composition','small')}`;break;
        case 'heater':case 'cooler':body+=choice('mode','Calculation mode',c.mode,[['T','Outlet temperature'],['Q','Specified heat duty']])+field('T','Outlet temperature',c.T,unitFor('T'),{disabled:c.mode!=='T'})+field('Q','Heat into material',c.Q,unitFor('Q'),{disabled:c.mode!=='Q'})+field('dP','Pressure drop',c.dP)+`<div class="field-note">Heat input is positive; cooling is negative. In duty mode, a connected energy stream overrides the duty field.</div>`;break;
        case 'flash':body+=choice('mode','Flash specification',c.mode,[['TP','Temperature / pressure'],['PH','Pressure / duty (PH flash)']])+field('T','Temperature',c.T,unitFor('T'),{disabled:c.mode!=='TP'})+field('P','Absolute pressure',c.P)+field('Q','Heat into material',c.Q,unitFor('Q'),{disabled:c.mode!=='PH'})+`<div class="field-note">TP mode calculates the required duty. PH mode conserves inlet enthalpy plus specified duty; use zero duty for an adiabatic flash.</div>`;break;
        case 'pump':body+=field('P','Outlet absolute pressure',c.P)+field('efficiency','Hydraulic efficiency',c.efficiency)+`<div class="field-note">Liquid-only, incompressible hydraulic model. Work and outlet enthalpy are calculated.</div>`;break;
        case 'valve':body+=field('P','Outlet absolute pressure',c.P)+`<div class="notice">Adiabatic, isenthalpic throttling. No shaft work or pressure increase.</div>`;break;
        case 'splitter':body+=field('fraction','Fraction to outlet 1',c.fraction)+`<div class="field-note">The remaining flow leaves outlet 2. Composition, temperature, and pressure are unchanged.</div>`;break;
        case 'mixer':body+=`<div class="notice">Component and energy balances determine the mixed outlet. Outlet pressure equals the lowest connected inlet pressure.</div>`;break;
        case 'recycle':body+=`<div class="notice">This block defines an explicit tear stream. Component flows, enthalpy flow, and pressure are iterated to convergence.</div>${btn('settings','gear','Convergence settings','small')}`;break;
        case 'energy':body+=field('Q','Signed energy supply',c.Q);break;
        case 'energySink':body+='<div class="notice">Receives the calculated signed duty from a connected energy output.</div>';break;
        case 'product':body+='<div class="notice">Product boundary. All properties are calculated from the connected inlet.</div>';break;
      }
      body+=`<hr class="inspector-divider"><div class="section-label">Connections</div>${TYPES[n.type].ports.map(p=>{const e=project.streams.find(e=>p.direction==='out'?e.from.node===n.id&&e.from.port===p.id:e.to.node===n.id&&e.to.port===p.id);return `<div class="property-row"><span>${esc(p.id)} · ${p.kind==='energy'?'energy':p.direction}</span><strong>${e?esc(e.tag):'Not connected'}</strong></div>`;}).join('')}<div class="field-note">Use the material or energy stream tool and click an output port, then an input port.</div>`;
    } else {const a=project.nodes.find(n=>n.id===e.from.node),b=project.nodes.find(n=>n.id===e.to.node);body+=`<div class="connection-box"><span>FROM</span><strong>${esc(a.tag)} / ${esc(e.from.port)}</strong><span>TO</span><strong>${esc(b.tag)} / ${esc(e.to.port)}</strong></div><div class="notice">Streams inherit their state from the source operation. Edit the source block to change this stream.</div>`;if(result&&e.kind==='material')body+=stateRows(result);}
    body+='</form>';
  }
  $('#inspector').innerHTML=h+`<div class="inspector-content">${body}</div><div class="inspector-footer">${inspectorTab==='specs'?btn('apply','check','Apply changes','primary'):btn('run','play','Recalculate','primary')}${n?ib('duplicate','duplicate','Duplicate block'):''}${ib('delete','trash','Delete selected object')}</div>`;
}
function applyInspector(){const form=$('#inspector-form');if(!form)return;try{
  const n=selected?.kind==='node'?project.nodes.find(n=>n.id===selected.id):null,e=selected?.kind==='stream'?project.streams.find(e=>e.id===selected.id):null;
  const tag=form.elements.namedItem('tag').value.trim();invariant(tag.length>0,'A nonempty tag is required.');
  if(n){const cfg=clone(n.cfg);for(const input of form.querySelectorAll('input[type=number],select')){if(input.disabled)continue;const key=input.name;if(key.startsWith('z:')){invariant(input.value.trim()!=='','Enter every mole fraction.');const v=Number(input.value);invariant(Number.isFinite(v)&&v>=0,'Mole fractions must be nonnegative.');cfg.z[key.slice(2)]=v;}else if(input.tagName==='SELECT')cfg[key]=input.value;else{invariant(input.value.trim()!=='','A numerical specification is blank.');cfg[key]=toSI(Number(input.value),input.dataset.unit);}}
    if(n.type==='feed')invariant(Math.abs(sum(project.components.map(id=>cfg.z[id]??0))-1)<1e-8,'Mole fractions must sum to 1. Use Normalize before applying.');
    const tempProject=clone(project);const tempNode=tempProject.nodes.find(x=>x.id===n.id);tempNode.cfg=cfg;
    if('T'in cfg)invariant(cfg.T>=200&&cfg.T<=1000,'Temperature is outside the 200–1000 K numerical envelope.');if('P'in cfg)invariant(cfg.P>=1000&&cfg.P<=1e7,'Absolute pressure must be 0.01–100 bar.');if('efficiency'in cfg)invariant(cfg.efficiency>0&&cfg.efficiency<=1,'Efficiency must be above 0% and at most 100%.');if('fraction'in cfg)invariant(cfg.fraction>=0&&cfg.fraction<=1,'Split fraction must be 0–100%.');if('F'in cfg)invariant(cfg.F>0,'Feed flow must be positive.');if('dP'in cfg)invariant(cfg.dP>=0,'Pressure drop cannot be negative.');
    transact(`Update ${tag}`,p=>Object.assign(p.nodes.find(x=>x.id===n.id),{tag,cfg}));
  } else if(e)transact('Rename stream',p=>{p.streams.find(x=>x.id===e.id).tag=tag;},{physics:false});toast('Specifications applied. Run to recalculate.');
}catch(error){toast(error.message);}}
function streamTable(expanded=false){
  if(!results)return `<div class="table-empty">${icon('table')}Run the simulation to populate stream properties.</div>`;
  const streams=project.streams.filter(e=>e.kind==='material'&&results.streams[e.id]);
  const rows=[['Temperature','T',unitFor('T')],['Absolute pressure','P',unitFor('P')],['Molar flow','F',unitFor('F')],['Vapor fraction','beta','1'],['Molar enthalpy','h',unitFor('h')],['Mass flow','massFlow',unitFor('massFlow')]];
  if(expanded)rows.push(['Enthalpy flow','H',unitFor('Q')],['Density estimate','density','kg/m³'],['Frozen-phase Cp','cp','J/mol·K'],['Volume flow','volumeFlow','m³/s']);
  const tr=(label,unit,getter)=>`<tr><td>${esc(label)}</td><td>${esc(unit)}</td>${streams.map(e=>`<td class="${selected?.kind==='stream'&&selected.id===e.id?'selected-col':''}">${getter(results.streams[e.id])}</td>`).join('')}</tr>`;
  return `<table class="data-table"><thead><tr><th>Property</th><th>Unit</th>${streams.map(e=>`<th><button class="table-link" data-stream="${esc(e.id)}">${esc(e.tag)}</button></th>`).join('')}</tr></thead><tbody>${rows.map(([label,key,unit])=>tr(label,unit,s=>num(['beta','density','cp','volumeFlow'].includes(key)?s[key]:fromSI(s[key],unit),key==='beta'?5:3))).join('')}${expanded?project.components.map((id,i)=>tr(`${COMPONENT_MAP[id].name} · overall`,'mol/mol',s=>num(s.z[i],6))).join(''):''}${expanded?project.components.flatMap((id,i)=>[tr(`${COMPONENT_MAP[id].name} · liquid*`,'mol/mol',s=>s.beta<1?num(s.x[i],6):'—'),tr(`${COMPONENT_MAP[id].name} · vapor*`,'mol/mol',s=>s.beta>0?num(s.y[i],6):'—')]).join(''):''}</tbody></table>`;
}
function blockTable(){
  if(!results)return '<div class="table-empty">Run the simulation to inspect block balances.</div>';
  return `<table class="data-table"><thead><tr><th>Block</th><th>Model</th><th>Heat · ${unitFor('Q')}</th><th>Work · ${unitFor('W')}</th><th>Energy residual · W</th><th>Component residual · mol/s</th></tr></thead><tbody>${project.nodes.map(n=>{const b=results.blocks[n.id];return `<tr><td><button class="table-link" data-node="${esc(n.id)}">${esc(n.tag)}</button></td><td>${esc(TYPES[n.type].name)}</td><td>${displayValue('Q',b.Q,3)}</td><td>${displayValue('W',b.W,4)}</td><td>${sci(b.energyResidual)}</td><td>${sci(Math.max(0,...b.componentResiduals.map(Math.abs)))}</td></tr>`;}).join('')}</tbody></table>`;
}
function lineChart(rows,{xLabel='',yLabel='',width=660,height=250,logY=false}={}){
  const data=rows.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!data.length)return '<div class="table-empty">No converged points to plot.</div>';
  const L=63,Rr=20,T=20,B=43,W=width-L-Rr,H=height-T-B;
  let xmin=Math.min(...data.map(p=>p.x)),xmax=Math.max(...data.map(p=>p.x));if(xmin===xmax)xmax=xmin+1;
  const fy=y=>logY?Math.log10(Math.max(y,1e-15)):y;
  let ymin=Math.min(...data.map(p=>fy(p.y))),ymax=Math.max(...data.map(p=>fy(p.y)));if(ymin===ymax){ymin-=.5;ymax+=.5;}else{const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;}
  const X=x=>L+(x-xmin)/(xmax-xmin)*W,Y=y=>T+H-(fy(y)-ymin)/(ymax-ymin)*H;
  let grid='',labels='';for(let i=0;i<5;i++){
    const yt=T+H-i*H/4,yv=ymin+(ymax-ymin)*i/4;
    grid+=`<path d="M${L} ${yt}h${W}" stroke="#e6edde" stroke-dasharray="3 4"/>`;
    labels+=`<text x="${L-10}" y="${yt+3}" text-anchor="end">${logY?`10^${num(yv,1)}`:num(yv,Math.abs(yv)<10?2:0)}</text>`;
    const xv=xmin+(xmax-xmin)*i/4;labels+=`<text x="${L+i*W/4}" y="${height-22}" text-anchor="middle">${num(xv,Math.abs(xv)<10?2:1)}</text>`;
  }
  // Do not interpolate across failed/unconverged sensitivity points.
  let path='',open=false;for(const p of rows){if(!Number.isFinite(p.x)||!Number.isFinite(p.y)){open=false;continue;}path+=`${open?'L':'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)} `;open=true;}
  const points=data.length<50?data.map(p=>`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="#fff" stroke="#619b73" stroke-width="1.6"><title>${esc(xLabel)}: ${num(p.x,5)} · ${esc(yLabel)}: ${num(p.y,6)}</title></circle>`).join(''):'';
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(yLabel)} versus ${esc(xLabel)}"><g fill="none">${grid}<path d="M${L} ${T}v${H}h${W}" stroke="#d3dfca"/></g><g fill="#93a982" font-family="ui-monospace,monospace" font-size="9">${labels}<text x="${L+W/2}" y="${height-4}" text-anchor="middle">${esc(xLabel)}</text><text x="${L}" y="10">${esc(yLabel)}</text></g><path d="${path}" fill="none" stroke="#619b73" stroke-width="2" stroke-linejoin="round"/>${points}</svg>`;
}
function renderReport(){
  document.querySelectorAll('[data-report]').forEach(b=>b.classList.toggle('active',b.dataset.report===reportTab));
  const body=$('#report-body');if(!body)return;
  if(reportTab==='streams')body.innerHTML=streamTable();
  else if(reportTab==='blocks')body.innerHTML=blockTable();
  else if(reportTab==='log')body.innerHTML=`<div class="log-list">${logs.map(l=>`<div class="log-row ${esc(l.type)}"><span class="log-time">${esc(l.time)}</span><span>${esc(l.message)}</span></div>`).join('')}</div>`;
  else if(results){const d=results.diagnostics;body.innerHTML=`<div class="diagnostics-content"><div class="mini-metrics">Recycle residual<strong>${sci(d.recycleResidual)}</strong><br>Mass residual<strong>${sci(d.globalMassResidual)} kg/s</strong><br>Energy residual<strong>${sci(d.globalEnergyResidual)} W</strong><br>Iterations<strong>${results.iterations}</strong><br>Explicit tear streams<strong>${d.tearStreams.length}</strong></div>${lineChart(results.trace.map(t=>({x:t.iteration,y:t.residual})),{xLabel:'Iteration',yLabel:'Scaled tear residual',height:150,logY:true})}</div>`;}
  else body.innerHTML='<div class="table-empty">Run the simulation to record residuals.</div>';
}
function numericParameters(n){if(!n)return[];let keys=Object.keys(n.cfg).filter(k=>typeof n.cfg[k]==='number');if(['heater','cooler'].includes(n.type))keys=keys.filter(k=>k!==(n.cfg.mode==='T'?'Q':'T'));if(n.type==='flash')keys=keys.filter(k=>k!==(n.cfg.mode==='TP'?'Q':'T'));return keys;}
const parameterNames={T:'Temperature',P:'Absolute pressure',F:'Molar flow',Q:'Heat duty',dP:'Pressure drop',efficiency:'Pump efficiency',fraction:'Outlet 1 fraction'};
function validSensitivitySpec(){
  const candidates=project.nodes.filter(n=>numericParameters(n).length);
  if(!candidates.some(n=>n.id===sensitivitySpec.node)){const n=candidates.find(n=>n.type==='flash')??candidates[0];sensitivitySpec.node=n?.id??'';sensitivitySpec.parameter=numericParameters(n)[0]??'';}
  const n=project.nodes.find(n=>n.id===sensitivitySpec.node);if(n&&!numericParameters(n).includes(sensitivitySpec.parameter))sensitivitySpec.parameter=numericParameters(n)[0];
  if(!project.streams.some(e=>e.id===sensitivitySpec.stream&&e.kind==='material'))sensitivitySpec.stream=project.streams.find(e=>e.kind==='material')?.id??'';
}
function renderPage(){
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.classList.contains('workspace-tab'))b.classList.toggle('active',b.dataset.page===page);});
  $('#flowsheet-view').classList.toggle('hidden',page!=='flowsheet');$('#page-content').classList.toggle('hidden',page==='flowsheet');$('#center').classList.toggle('expanded',page!=='flowsheet');
  if(page==='flowsheet')return;
  const host=$('#page-content');
  if(page==='reports'){
    host.innerHTML=`<div class="flex"><div><h2>Stream reports</h2><p class="muted">Computed phase, thermal, and material properties</p></div><span class="spacer"></span>${btn('csv','export','Export CSV','small')}</div>${results?`<div class="notice ${results.converged?'':'error'}">${results.converged?'Converged':'PROVISIONAL: NOT CONVERGED'} · ${esc(project.method)} · ${results.iterations} iterations. Values reflect the last completed calculation.</div>`:''}<div style="overflow:auto;border:1px solid #e2ebd8;border-radius:6px">${streamTable(true)}</div><p class="muted" style="font-size:9px">* Incipient, absent phases are shown as “—”. A separated phase stream has only its occupied phase reported.</p><h2 style="margin-top:26px">Unit-operation balances</h2><div style="overflow:auto">${blockTable()}</div>${results?.warnings.length?`<div class="notice warning">${results.warnings.map(esc).join('<br>')}</div>`:''}`;
  }else if(page==='properties'){
    host.innerHTML=`<div class="flex"><div><h2>Thermodynamic properties</h2><p class="muted">Explicit correlations. Inspectable constants. Defined limits.</p></div><span class="spacer"></span>${btn('components','atom','Manage components','small')}</div><div class="notice">Method: <strong>${esc(project.method)}</strong>. Antoine pressure is in bar, temperature in kelvin. Heat capacities, density, and latent-heat anchors are rounded model constants, not high-accuracy property regressions.</div><div class="page-card"><h3>Selected component library</h3><div style="overflow:auto"><table class="data-table"><thead><tr><th>Component</th><th>CAS</th><th>MW · g/mol</th><th>Cp liquid</th><th>Cp vapor</th><th>ρ liquid · kg/m³</th><th>ΔHvap(Tb) · kJ/mol</th></tr></thead><tbody>${project.components.map(id=>{const c=COMPONENT_MAP[id];return `<tr><td>${esc(c.name)}</td><td>${c.cas}</td><td>${num(c.MW*1000,4)}</td><td>${num(c.cpL,1)}</td><td>${num(c.cpV,1)}</td><td>${num(c.rhoL,0)}</td><td>${num(c.HvapB/1000,3)}</td></tr>`;}).join('')}</tbody></table></div><p style="font-size:9px;color:#96a987">Heat capacities: J/(mol·K). Liquid density is constant. No transport-property correlations are implemented.</p></div><div class="page-card"><h3>Antoine coefficients · log₁₀(Psat / bar) = A − B / (T + C)</h3><div style="overflow:auto"><table class="data-table"><thead><tr><th>Component</th><th>A</th><th>B · K</th><th>C · K</th><th>Published interval · K</th><th>Reference</th></tr></thead><tbody>${project.components.map(id=>{const c=COMPONENT_MAP[id],a=c.antoine;return `<tr><td>${esc(c.name)}</td><td>${a.A}</td><td>${a.B}</td><td>${a.C}</td><td>${a.Tmin} – ${a.Tmax}</td><td><a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer" style="color:#6c9651">NIST SRD 69 ↗</a></td></tr>`;}).join('')}</tbody></table></div></div><div class="page-card"><h3>Model assumptions & numerical methods</h3><p class="muted" style="font-size:11px;line-height:1.9">Ideal vapor and ideal liquid. Kᵢ = Psat,ᵢ / P. Rachford–Rice phase splitting with safeguarded Newton steps; bracketed pressure–enthalpy flash with a pure-component latent-heat branch. Constant phase heat capacities and incompressible liquid enthalpy pressure correction. No reactions, solid phases, activity coefficients, fugacity coefficients, or azeotrope prediction.</p>${btn('methods','layers','Property method settings','small')}</div>`;
  }else if(page==='sensitivity'){
    validSensitivitySpec();const n=project.nodes.find(n=>n.id===sensitivitySpec.node),key=sensitivitySpec.parameter,unit=unitFor(key);
    const study=sensitivityResult,metric=sensitivitySpec.metric,yUnit=['Q','W'].includes(metric)?unitFor(metric):unitFor(metric==='H'?'Q':metric), actualYUnit=metric==='density'?'kg/m³':metric==='beta'?'1':yUnit;
    host.innerHTML=`<h2>Sensitivity study</h2><p>Independent steady-state solves across a numerical specification range.</p><div class="page-card"><div class="sensitivity-grid">
      <label class="field"><span>Manipulated block</span><div class="field-input"><select id="sensitivity-node">${project.nodes.filter(n=>numericParameters(n).length).map(n=>`<option value="${esc(n.id)}" ${n.id===sensitivitySpec.node?'selected':''}>${esc(n.tag)} · ${TYPES[n.type].name}</option>`).join('')}</select></div></label>
      <label class="field"><span>Specification</span><div class="field-input"><select id="sensitivity-parameter">${numericParameters(n).map(k=>`<option value="${k}" ${k===key?'selected':''}>${parameterNames[k]??k}</option>`).join('')}</select></div></label>
      ${field('study-min','Minimum',sensitivitySpec.min,unit)}${field('study-max','Maximum',sensitivitySpec.max,unit)}${field('study-points','Points',sensitivitySpec.points,'1')}
      <label class="field"><span>Response stream</span><div class="field-input"><select id="sensitivity-stream">${project.streams.filter(e=>e.kind==='material').map(e=>`<option value="${esc(e.id)}" ${e.id===sensitivitySpec.stream?'selected':''}>${esc(e.tag)}</option>`).join('')}</select></div></label>
      <label class="field"><span>Response variable</span><div class="field-input"><select id="sensitivity-metric">${[['F','Molar flow'],['T','Temperature'],['beta','Vapor fraction'],['h','Molar enthalpy'],['density','Density estimate'],['Q','Manipulated block duty'],['W','Manipulated block shaft work']].map(([v,t])=>`<option value="${v}" ${v===metric?'selected':''}>${t}</option>`).join('')}</select></div></label>
      </div><div class="sensitivity-bottom"><span class="muted" style="font-size:9px">Failed and unconverged points remain visible and are not interpolated.</span>${btn('run-sensitivity','play',busy?'Calculating…':'Run study','primary small')}</div></div>
      <div class="page-card"><h3>${esc(parameterNames[key]??key)} response</h3><div class="chart-container">${study?lineChart(study.rows.map(r=>({x:fromSI(r.value,unit),y:r.status==='converged'?(metric==='beta'||metric==='density'?r.y:fromSI(r.y,actualYUnit)):null})),{xLabel:(parameterNames[key]??key)+' · '+unit,yLabel:metric+' · '+actualYUnit}):'<div class="table-empty">Run the study to compute and plot response points.</div>'}</div></div>
      ${study?`<div class="flex" style="margin-bottom:12px"><h3 style="font-size:12px;margin:0">Calculated points</h3><span class="spacer"></span>${btn('sensitivity-csv','export','Export study CSV','small')}</div><table class="data-table"><thead><tr><th>${parameterNames[key]??key} · ${unit}</th><th>Status</th><th>Response · ${actualYUnit}</th><th>Iterations</th><th>Residual</th><th>Diagnostics</th></tr></thead><tbody>${study.rows.map(r=>`<tr><td>${num(fromSI(r.value,unit),4)}</td><td>${esc(r.status)}</td><td>${r.y==null?'—':num(metric==='beta'||metric==='density'?r.y:fromSI(r.y,actualYUnit),5)}</td><td>${r.iterations??'—'}</td><td>${sci(r.residual)}</td><td>${esc(r.error??(r.warnings+' property warnings'))}</td></tr>`).join('')}</tbody></table>`:''}`;
    host.querySelector('[data-action=run-sensitivity]')?.toggleAttribute('disabled',busy);
  }
}
function setPage(value){page=value;renderPage();renderTree();if(value==='flowsheet')requestAnimationFrame(()=>renderer.resize());}
function setTool(value){setPage('flowsheet');renderer.connectStart=null;renderer.setTool(value);document.querySelectorAll('[data-action^=tool-]').forEach(b=>b.classList.toggle('active',b.dataset.action===`tool-${value}`));renderPalette();const hint=$('#canvas-hint');hint.classList.toggle('hidden',value==='select'||value==='pan');hint.textContent=value.startsWith('add:')?`Click to place ${TYPES[value.slice(4)].name} · Esc to cancel`:`Click an output port, then an input port · Esc to cancel`;}
function disposeWorker(){worker?.terminate();worker=null;if(workerObjectURL){URL.revokeObjectURL(workerObjectURL);workerObjectURL=null;}}
function beginJob(action,spec){
  if(busy)return;const issues=validateReadiness(project);if(issues.length){showIssues(issues);return;}
  busy=true;activeJob=action;const id=++runCounter,jobRevision=revision;
  log(action==='sensitivity'?'Starting sensitivity study…':'Starting steady-state calculation…');
  try{
    if(globalThis.__VAPORA_WORKER_SOURCE__){workerObjectURL=URL.createObjectURL(new Blob([globalThis.__VAPORA_WORKER_SOURCE__],{type:'text/javascript'}));worker=new Worker(workerObjectURL);}else worker=new Worker(globalThis.__VAPORA_WORKER_URL__ ?? new URL('./worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      if(data.id!==id||revision!==jobRevision)return;
      if(data.type==='progress'){
        if(action==='sensitivity'){$('#status-text').textContent='Sensitivity study';$('#status-detail').textContent=`${data.progress.completed} / ${data.progress.total} points`;$('#progress-line').style.width=(data.progress.completed/data.progress.total*100)+'%';}
        else{$('#status-text').textContent='Solving recycle';$('#status-detail').textContent=`Iteration ${data.progress.iteration} · residual ${sci(data.progress.residual)}`;$('#progress-line').style.width=Math.min(95,10+data.progress.iteration*3)+'%';}
      }else if(data.type==='result'){
        disposeWorker();busy=false;$('#progress-line').style.width='0';
        if(action==='sensitivity'){sensitivityResult=data.result;log(`Sensitivity complete: ${data.result.rows.filter(r=>r.status==='converged').length}/${data.result.rows.length} converged points.`,'success');}
        else{results=data.result;log(`${results.converged?'Converged':'NOT CONVERGED'} in ${results.iterations} iterations, ${num(results.elapsedMs,2)} ms. Scaled balance residual ${sci(results.diagnostics.balanceResidual)}.`,results.converged?'success':'error');for(const w of results.warnings)log(w,'warning');}
        renderAll();
      }else if(data.type==='error'){finishError(data.error);}
    };
    worker.onerror=event=>finishError({message:event.message||'Worker could not start. Serve the project over localhost, or use the standalone HTML build.'});
    worker.postMessage({id,action,project:clone(project),spec});renderAll();$('#status-text').textContent='Calculating';$('#status-detail').textContent='Worker started';
  }catch(error){finishError(error);}
}
function finishError(error){disposeWorker();busy=false;$('#progress-line').style.width='0';log(error.message,'error');renderAll();$('#status-text').textContent='Calculation failed';$('#status-detail').textContent=error.code??'Review diagnostics';showIssues([{severity:'error',message:error.message,node:error.details?.node}]);}
function cancelRun(notify=true){if(!busy)return;disposeWorker();busy=false;runCounter++;$('#progress-line').style.width='0';log('Calculation cancelled. No partial result was accepted.','warning');if(notify){toast('Calculation cancelled.');renderAll();}}
function runStudy(){try{const host=$('#page-content'),key=$('#sensitivity-parameter').value,unit=unitFor(key);const input=name=>host.querySelector(`[name="${name}"]`).value;invariant(input('study-min')!==''&&input('study-max')!==''&&input('study-points')!=='','Enter the sensitivity range and point count.');sensitivitySpec={node:$('#sensitivity-node').value,parameter:key,min:toSI(Number(input('study-min')),unit),max:toSI(Number(input('study-max')),unit),points:Number(input('study-points')),stream:$('#sensitivity-stream').value,metric:$('#sensitivity-metric').value};invariant(Number.isInteger(sensitivitySpec.points)&&sensitivitySpec.points>=2&&sensitivitySpec.points<=101,'Use 2–101 sensitivity points.');invariant(sensitivitySpec.max>sensitivitySpec.min,'Maximum must exceed minimum.');sensitivityResult=null;beginJob('sensitivity',clone(sensitivitySpec));}catch(error){toast(error.message);}}
function modal(title,body,footer=''){const d=$('#modal');d.innerHTML=`<div class="modal-head"><h2>${esc(title)}</h2><span class="spacer"></span>${ib('close-modal','close','Close dialog')}</div><div class="modal-body">${body}</div><div class="modal-footer">${footer||btn('close-modal','check','Done','primary small')}</div>`;if(!d.open)d.showModal();}
function closeModal(){$('#modal').close();}
function componentDialog(){
  modal('Components & property method',`<p>Select the species available throughout the project. Existing feed compositions are preserved and renormalized when components are removed; newly added species start at zero.</p><table class="component-picker"><thead><tr><th></th><th>Component</th><th>Formula</th><th>MW · g/mol</th><th>CAS number</th></tr></thead><tbody>${COMPONENTS.map(c=>`<tr><td><input type="checkbox" name="component" value="${c.id}" ${project.components.includes(c.id)?'checked':''} aria-label="Include ${esc(c.name)}"></td><td><strong>${esc(c.name)}</strong><small>Pure-component vapor-pressure data: NIST</small></td><td>${esc(c.formula)}</td><td class="mono">${num(c.MW*1000,4)}</td><td class="mono">${c.cas}</td></tr>`).join('')}</tbody></table><h3>Thermodynamic property model</h3>${choice('property-method','Selected model',project.method,[['IDEAL-RAOULT','IDEAL-RAOULT · ideal liquid / ideal gas VLE'],['IDEAL-GAS','IDEAL-GAS · vapor-only ideal mixture']])}<div class="notice warning">Raoult’s law does not model activity coefficients, azeotropes, or phase splitting into two liquids. Water/alcohol mixtures are available for model exploration, not accurate nonideal prediction. Cp, density, and latent-heat values are approximate constants.</div><label class="flex" style="color:#789367;font-size:11px"><input type="checkbox" id="strict-range" ${project.settings.strictRange?'checked':''}>Reject Antoine temperature extrapolation rather than warn</label>`,`${btn('close-modal','close','Cancel','small')}${btn('apply-components','check','Apply to project','primary small')}`);
}
function applyComponents(){try{
  const ids=[...$('#modal').querySelectorAll('input[name=component]:checked')].map(i=>i.value);invariant(ids.length,'Select at least one component.');const method=$('#modal [name=property-method]').value,strictRange=$('#strict-range').checked;
  transact('Update component library and property method',p=>{p.components=ids;p.method=method;p.settings.strictRange=strictRange;for(const n of p.nodes.filter(n=>n.type==='feed')){const retained=ids.map(id=>n.cfg.z[id]??0),total=sum(retained);n.cfg.z=Object.fromEntries(ids.map((id,i)=>[id,total>0?retained[i]/total:1/ids.length]));}});closeModal();toast('Property basis updated. Existing results were invalidated.');
}catch(error){toast(error.message);}}
function settingsDialog(){modal('Solver & project settings',`<div class="two-column"><div>${field('project-name','Project name',project.name,'1',{text:true})}${field('project-description','Description',project.description,'1',{text:true})}${choice('unit-set','Display unit set',project.units||'Engineering',Object.keys(UNIT_SETS).map(k=>[k,k]))}</div><div>${field('solver-tolerance','Scaled recycle tolerance',project.settings.tolerance,'1')}${field('solver-iterations','Maximum iterations',project.settings.maxIterations,'1')}${field('solver-damping','Relaxation factor',project.settings.damping,'1')}${choice('solver-acceleration','Recycle acceleration',project.settings.acceleration,[['wegstein','Safeguarded Wegstein'],['none','Relaxed successive substitution']])}</div></div><div class="notice">The numerical engine always uses K, Pa, mol/s, J/mol, and W. Unit changes affect input/output formatting only. Recycle unknowns are component molar flows, enthalpy flow, and absolute pressure. Every cycle must cross an explicit Recycle block.</div>`,`${btn('close-modal','close','Cancel','small')}${btn('apply-settings','check','Apply settings','primary small')}`);}
function applySettings(){try{
  const read=name=>$('#modal').querySelector(`[name="${name}"]`).value;
  const name=read('project-name').trim(),description=read('project-description').trim(),units=read('unit-set');
  const tolerance=Number(read('solver-tolerance')),maxIterations=Number(read('solver-iterations')),damping=Number(read('solver-damping')),acceleration=read('solver-acceleration');
  invariant(name.length>0,'Enter a project name.');invariant(tolerance>=1e-12&&tolerance<=1e-3,'Tolerance must be 1e-12 to 1e-3.');invariant(Number.isInteger(maxIterations)&&maxIterations>=1&&maxIterations<=5000,'Iteration limit must be 1–5000.');invariant(damping>0&&damping<=1,'Relaxation factor must be in (0,1].');
  transact('Update project settings',p=>{Object.assign(p,{name,description,units});Object.assign(p.settings,{tolerance,maxIterations,damping,acceleration});});closeModal();
}catch(error){toast(error.message);}}
function showIssues(issues){
  modal(issues.length?'Simulation diagnostics':'Input check passed',issues.length?issues.map(issue=>`<div class="notice ${issue.severity==='error'?'error':'warning'}">${icon(issue.severity==='error'?'warning':'info','icon-sm')} ${esc(issue.message)}${issue.node?`<div style="margin-top:8px"><button class="btn small" data-locate="${esc(issue.node)}">Locate block</button></div>`:''}</div>`).join(''):'<div class="notice">All required ports and feed compositions are specified. Run the numerical solver to check pressure constraints, phase feasibility, property ranges, and recycle convergence.</div>');
}
function helpDialog(){modal('Vapora Process Studio',`<p>A complete, inspectable implementation of a bounded ideal-mixture process simulator. No Aspen software, property database, or proprietary simulation engine is used.</p><h3>Build a process</h3><p>Choose an operation in the model library, then click the flowsheet to place it. Use the material-stream tool and click a green output port, followed by a green input port. Energy ports are amber. Select a block, edit its specifications, and click Apply changes. Every material outlet must lead to another block or a Product boundary.</p><h3>Navigation & editing</h3><p><span class="help-key">V</span> select/move &nbsp; <span class="help-key">H</span> pan &nbsp; <span class="help-key">C</span> material stream &nbsp; <span class="help-key">E</span> energy stream &nbsp; <span class="help-key">F</span> fit &nbsp; <span class="help-key">F5</span> run &nbsp; <span class="help-key">Esc</span> cancel tool<br>Wheel zooms around the pointer. Space-drag or right-drag pans. Delete removes a selected object. Ctrl/⌘ Z undoes; Ctrl/⌘ Shift Z redoes; Ctrl/⌘ S saves a portable project.</p><h3>Numerical model</h3><p>IDEAL-RAOULT uses Antoine vapor pressure, ideal liquid/vapor equilibrium, and Rachford–Rice splitting. PH flashing solves the enthalpy equation, with a separate latent-heat branch for pure components. IDEAL-GAS is vapor-only. Phase heat capacities, liquid densities, and latent-heat anchors are constant approximations. Pumps use an incompressible liquid model; valves are isenthalpic. Every unit independently reports component and energy residuals.</p><h3>Recycle & energy conventions</h3><p>Insert a Recycle block in each material feedback loop. The solver tears its output and converges component flows, enthalpy flow, and pressure with relaxed substitution and optional safeguarded Wegstein acceleration. Heat and shaft work into material are positive. An exported energy outlet carries the negative of the source unit’s heat or shaft duty. Thus a cooler can supply a downstream heater in duty mode.</p><h3>Persistence & privacy</h3><p>Project edits are saved in this browser’s local storage when available. Save exports a versioned JSON project. Open imports that project with schema validation. No backend service or network API is used by the app. Calculations execute in a dedicated Worker and can be cancelled.</p><div class="notice warning">This is not Aspen Plus feature parity. No PR/SRK EOS, NRTL/UNIQUAC, reactions, columns, electrolyte chemistry, solids, dynamic simulation, equipment sizing, or design certification. The validation suite checks the implemented equations; it does not establish real-plant predictive accuracy.</div>`);}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const fileSlug=()=>project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'process';
function saveProject(){project.view={...renderer.camera};download(fileSlug()+'.vapora.json',JSON.stringify(project,null,2),'application/json');persist();toast('Project exported as versioned JSON.');}
function csvCell(value){if(value==null)return '""';let text=String(value);if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
function exportCSV(){if(!results){toast('Run the simulation before exporting results.');return;}
  const rows=[['Vapora Process Studio · calculated stream report'],['Project',project.name],['Status',results.status],['Property method',project.method],['Basis','All numeric columns below are SI'],[],['Stream','Type','Flow mol/s','Temperature K','Pressure Pa','Vapor fraction','Molar enthalpy J/mol','Enthalpy flow W','Mass flow kg/s',...project.components.map(id=>'Mole fraction '+id)]];
  for(const e of project.streams){const s=results.streams[e.id];rows.push(e.kind==='energy'?[e.tag,'energy','','','','','',s]:[e.tag,'material',s.F,s.T,s.P,s.beta,s.h,s.H,s.massFlow,...s.z]);}
  rows.push([],['Block','Heat into material W','Shaft work W','Energy residual W','Mass residual kg/s']);for(const n of project.nodes){const b=results.blocks[n.id];rows.push([n.tag,b.Q,b.W,b.energyResidual,b.massResidual]);}
  rows.push([],['Global mass residual kg/s',results.diagnostics.globalMassResidual],['Global energy residual W',results.diagnostics.globalEnergyResidual],['Scaled balance residual',results.diagnostics.balanceResidual],[],['Warnings'],...results.warnings.map(w=>[w]));
  download(fileSlug()+'-results.csv',csv(rows),'text/csv;charset=utf-8');
}
function exportStudy(){if(!sensitivityResult){toast('Run a sensitivity study first.');return;}download(fileSlug()+'-sensitivity.csv',csv([['Parameter',sensitivityResult.spec.parameter,'SI basis'],['Response',sensitivityResult.spec.metric,'SI basis'],['Value','Response','Status','Iterations','Residual','Error'],...sensitivityResult.rows.map(r=>[r.value,r.y,r.status,r.iterations,r.residual,r.error??''])]),'text/csv;charset=utf-8');}
function exportDialog(){modal('Export workspace',`<div class="button-grid"><button class="choice-button" data-action="save">${icon('save')}<span><strong>Project source</strong><small>Portable JSON · editable specifications, topology, component selection, and solver settings.</small></span></button><button class="choice-button" data-action="csv">${icon('table')}<span><strong>Engineering report</strong><small>CSV · calculated stream states, component fractions, duties, and balance diagnostics in SI units.</small></span></button><button class="choice-button" data-action="results-json">${icon('file')}<span><strong>Complete run results</strong><small>JSON · all calculated states, iteration history, residuals, warnings, and a project snapshot.</small></span></button><button class="choice-button" data-action="sensitivity-csv">${icon('chart')}<span><strong>Sensitivity study</strong><small>CSV · computed response points, failed cases, residuals, and iteration counts.</small></span></button></div>`);}
function newDialog(){modal('Create a process',`<div class="button-grid"><button class="choice-button" data-action="new-blank">${icon('file')}<span><strong>Blank flowsheet</strong><small>Start with a component basis and an empty editable process.</small></span></button><button class="choice-button" data-action="new-demo">${icon('flow')}<span><strong>Aromatics recovery</strong><small>Benzene / toluene flash separation, liquid recycle, cooling, pumping, and signed energy reporting.</small></span></button></div><div class="notice">The current project will be replaced. Use Save to export it before creating a new one.</div>`);}
function replaceProject(p){cancelRun(false);project=p;history.clear();results=null;sensitivityResult=null;revision++;selected=p.nodes.find(n=>n.type==='flash')?{kind:'node',id:p.nodes.find(n=>n.type==='flash').id}:null;setTool('select');closeModal();renderAll();renderer.fit();persist();log(`Opened project: ${p.name}`);}
function deleteSelection(){if(!selected)return;if(selected.kind==='node'){const id=selected.id;transact('Delete block and connected streams',p=>{p.nodes=p.nodes.filter(n=>n.id!==id);p.streams=p.streams.filter(e=>e.from.node!==id&&e.to.node!==id);selected=null;});}else if(selected.kind==='stream'){const id=selected.id;transact('Delete stream',p=>{p.streams=p.streams.filter(e=>e.id!==id);selected=null;});}}
function duplicateSelection(){if(selected?.kind!=='node')return;const n=project.nodes.find(n=>n.id===selected.id);transact('Duplicate block',p=>{const copy=clone(n);copy.id=uuid('block');copy.tag=(n.tag+'-COPY').slice(0,100);copy.x+=40;copy.y+=140;p.nodes.push(copy);selected={kind:'node',id:copy.id};});}
function undo(){const p=history.undo();if(p){project=p;selected=null;invalidateResults();persist();renderAll();log('Undo applied.');}}
function redo(){const p=history.redo();if(p){project=p;selected=null;invalidateResults();persist();renderAll();log('Redo applied.');}}
function normalizeForm(){const inputs=[...$('#inspector-form').querySelectorAll('input[name^="z:"]')];const values=inputs.map(i=>Number(i.value)),total=sum(values);if(values.some(v=>!Number.isFinite(v)||v<0)||total<=0){toast('Enter nonnegative fractions with a positive sum.');return;}inputs.forEach((i,k)=>i.value=String(values[k]/total));$('#composition-sum').textContent='1.000000';}
function resetSensitivityRange(){const n=project.nodes.find(n=>n.id===sensitivitySpec.node),key=sensitivitySpec.parameter;if(!n)return;const base=n.cfg[key];if(key==='T'){sensitivitySpec.min=base-5;sensitivitySpec.max=base+5;}else if(key==='fraction'||key==='efficiency'){sensitivitySpec.min=Math.max(.01,base-.2);sensitivitySpec.max=Math.min(.99,base+.2);}else{const a=base*.8,b=base*1.2;sensitivitySpec.min=Math.min(a,b);sensitivitySpec.max=Math.max(a,b);if(a===b){sensitivitySpec.min=0;sensitivitySpec.max=key==='dP'?10000:100000;}}sensitivityResult=null;renderPage();}
const actions={
  'menu-home':()=>setPage('flowsheet'),'menu-flowsheet':()=>setPage('flowsheet'),'menu-properties':()=>setPage('properties'),'menu-analysis':()=>setPage('sensitivity'),'menu-view':()=>{setPage('flowsheet');renderer.fit();},
  'run':()=>beginJob('simulate'),'cancel':()=>cancelRun(),'run-sensitivity':runStudy,'new':newDialog,'new-blank':()=>replaceProject(emptyProject()),'new-demo':()=>{replaceProject(demoProject());beginJob('simulate');},
  'open':()=>$('#open-file').click(),'save':saveProject,'export':exportDialog,'csv':exportCSV,'sensitivity-csv':exportStudy,
  'results-json':()=>{if(!results)return toast('Run the simulation first.');download(fileSlug()+'-run.json',JSON.stringify({project,results,assumptions:'See docs/THERMODYNAMICS.md. Ideal mixture and approximate constant caloric properties.'},null,2),'application/json');},
  'undo':undo,'redo':redo,'components':componentDialog,'methods':componentDialog,'apply-components':applyComponents,
  'settings':settingsDialog,'project-settings':settingsDialog,'units':settingsDialog,'apply-settings':applySettings,'help':helpDialog,'validate':()=>showIssues(validateReadiness(project)),
  'reports':()=>setPage('reports'),'sensitivity':()=>setPage('sensitivity'),'apply':applyInspector,'normalize':normalizeForm,'delete':deleteSelection,'duplicate':duplicateSelection,
  'close-modal':closeModal,'close-inspector':()=>{document.body.classList.remove('mobile-inspector');if(innerWidth>620)setSelection(null);},
  'tool-select':()=>setTool('select'),'tool-pan':()=>setTool('pan'),'tool-connect':()=>setTool('connect'),'tool-energy':()=>setTool('energy'),
  'fit':()=>renderer.fit(),'zoom-in':()=>renderer.zoom(1.2),'zoom-out':()=>renderer.zoom(1/1.2),'focus-mode':()=>{document.body.classList.toggle('focusmode');requestAnimationFrame(()=>{renderer.resize();renderer.fit();});},
};
mount();
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');if(action){event.preventDefault();const key=action.dataset.action;try{actions[key]?.();if(key.startsWith('menu-'))document.querySelectorAll('.menu-tab').forEach(b=>b.classList.toggle('active',b===action));}catch(error){toast(error.message);log(error.message,'error');}return;}
  const node=event.target.closest('[data-node]');if(node){event.preventDefault();setSelection({kind:'node',id:node.dataset.node});return;}
  const stream=event.target.closest('[data-stream]');if(stream){event.preventDefault();setSelection({kind:'stream',id:stream.dataset.stream});return;}
  const add=event.target.closest('[data-add]');if(add){setTool('add:'+add.dataset.add);return;}
  const tab=event.target.closest('[data-page]');if(tab){setPage(tab.dataset.page);return;}
  const report=event.target.closest('[data-report]');if(report){reportTab=report.dataset.report;renderReport();return;}
  const itab=event.target.closest('[data-inspector]');if(itab){inspectorTab=itab.dataset.inspector;renderInspector();return;}
  const pal=event.target.closest('[data-palette]');if(pal){paletteGroup=pal.dataset.palette;renderPalette();return;}
  const locate=event.target.closest('[data-locate]');if(locate){closeModal();setPage('flowsheet');setSelection({kind:'node',id:locate.dataset.locate});renderer.focusNode(locate.dataset.locate);}
});
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='inspector-form')applyInspector();});
document.addEventListener('input',event=>{
  if(event.target.id==='tree-search')renderTree();
  if(event.target.name?.startsWith('z:')){const inputs=[...$('#inspector-form').querySelectorAll('input[name^="z:"]')],total=sum(inputs.map(i=>Number(i.value)));$('#composition-sum').textContent=num(total,6);$('#composition-sum').classList.toggle('danger',Math.abs(total-1)>1e-8);}
});
document.addEventListener('change',event=>{
  if(event.target.name==='mode'&&event.target.closest('#inspector-form')){const mode=event.target.value,form=$('#inspector-form');form.querySelector('[name=T]')?.toggleAttribute('disabled',!['T','TP'].includes(mode));form.querySelector('[name=Q]')?.toggleAttribute('disabled',!['Q','PH'].includes(mode));}
  if(event.target.id==='sensitivity-node'){sensitivitySpec.node=event.target.value;const n=project.nodes.find(n=>n.id===sensitivitySpec.node);sensitivitySpec.parameter=numericParameters(n).includes('T')?'T':numericParameters(n)[0];resetSensitivityRange();}
  if(event.target.id==='sensitivity-parameter'){sensitivitySpec.parameter=event.target.value;resetSensitivityRange();}
  if(event.target.id==='sensitivity-stream'){sensitivitySpec.stream=event.target.value;sensitivityResult=null;renderPage();}
  if(event.target.id==='sensitivity-metric'){sensitivitySpec.metric=event.target.value;sensitivityResult=null;renderPage();}
});
$('#open-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{invariant(file.size<=10_000_000,'Project file exceeds 10 MB.');const data=parseProject(await file.text());replaceProject(data);toast('Project loaded. Run to calculate results.');}catch(error){toast('Could not open project: '+error.message);}event.target.value='';});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){renderer.connectStart=null;setTool('select');document.body.classList.remove('mobile-inspector');return;}
  const input=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName);if(input||$('#modal').open)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveProject();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key.toLowerCase();if(key==='delete'||key==='backspace'){event.preventDefault();deleteSelection();}else if(key==='v')setTool('select');else if(key==='h')setTool('pan');else if(key==='c')setTool('connect');else if(key==='e')setTool('energy');else if(key==='f')renderer.fit();else if(key==='f5'){event.preventDefault();beginJob('simulate');}
});
log('Project initialized. Thermodynamic basis: '+project.method+'.');
if(validateReadiness(project).length===0)beginJob('simulate');
// Read-only test/inspection hooks; all calculations still use the public engine modules.
globalThis.vapora=Object.freeze({getProject:()=>clone(project),getResults:()=>results?clone(results):null,getRenderer:()=>({mode:renderer.mode,vertices:renderer.vertexCount??0,camera:{...renderer.camera}}),version:'1.0.0'});
