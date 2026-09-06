import test from 'node:test';
import assert from 'node:assert/strict';
import { Thermodynamics, TREF, PREF } from '../src/thermo.js';
import { rachfordRice, bisect, normalize, sum } from '../src/numerics.js';
import { convert, toSI, fromSI } from '../src/units.js';
import { emptyProject, demoProject, createNode, clone, History, parseProject, validateReadiness, checkConnection } from '../src/model.js';
import { simulate, sensitivity, compile } from '../src/simulator.js';
import { COMPONENTS } from '../src/components.js';

const near=(a,b,abs=1e-7,rel=1e-9)=>assert.ok(Math.abs(a-b)<=abs+rel*Math.max(Math.abs(a),Math.abs(b)), `${a} != ${b}`);
const bt=()=>new Thermodynamics(['benzene','toluene']);
function network(type,cfg={},feed={}){
  const p=emptyProject();p.settings.acceleration='none';
  const f=createNode('feed',0,0,p.components);Object.assign(f,{id:'feed',tag:'FEED'});Object.assign(f.cfg,{F:100,T:338.15,P:101325,z:{benzene:.5,toluene:.5}},feed);
  const u=createNode(type,100,0,p.components);Object.assign(u,{id:'unit',tag:'UNIT'});Object.assign(u.cfg,cfg);
  p.nodes=[f,u];p.streams=[{id:'in',tag:'IN',kind:'material',from:{node:'feed',port:'out'},to:{node:'unit',port:type==='mixer'?'in1':'in'}}];
  const ports=type==='flash'?['vapor','liquid']:type==='splitter'?['out1','out2']:['out'];
  for(const [i,port] of ports.entries()){const prod=createNode('product',200,100*i,p.components);prod.id='p'+i;prod.tag='P'+i;p.nodes.push(prod);p.streams.push({id:port,tag:port,kind:'material',from:{node:'unit',port},to:{node:prod.id,port:'in'}});}
  return p;
}
test('Affine unit conversion: Celsius, Fahrenheit, Kelvin',()=>{near(convert(100,'°C','K'),373.15);near(convert(32,'°F','°C'),0);near(convert(212,'°F','K'),373.15);near(convert(-40,'°C','°F'),-40);});
test('Molar flow, pressure and power conversion',()=>{near(convert(360,'kmol/h','mol/s'),100);near(convert(1,'bar','Pa'),100000);near(convert(1,'kW','W'),1000);near(convert(1,'atm','Pa'),101325);});
test('Dimensional mismatch is rejected',()=>{assert.throws(()=>convert(1,'bar','kW'),/Cannot convert/);assert.throws(()=>toSI(2,'K','pressure'),/not valid/);});
test('Non-finite input is rejected',()=>assert.throws(()=>toSI(NaN,'K'),/finite/));
test('Compensated sum and normalization',()=>{near(sum([.1,.2,.3]),.6);assert.deepEqual(normalize([2,3]),[.4,.6]);assert.throws(()=>normalize([0,0]));assert.throws(()=>normalize([-1,2]));});
test('Bracketed root: square root of two',()=>near(bisect(x=>x*x-2,0,2).x,Math.sqrt(2),1e-9));
test('Unbracketed root gives diagnostic',()=>assert.throws(()=>bisect(x=>x*x+1,-1,1),e=>e.code==='UNBRACKETED_ROOT'));
test('Rachford–Rice exact binary benchmark: beta = 0.5',()=>{const r=rachfordRice([.5,.5],[2,.5]);near(r.beta,.5,1e-13);assert.ok(Math.abs(r.residual)<1e-12);});
test('Rachford–Rice single-phase limits',()=>{assert.equal(rachfordRice([.2,.8],[.8,.1]).beta,0);assert.equal(rachfordRice([.2,.8],[1.8,1.1]).beta,1);});
test('NIST benzene vapor pressure reproduces coefficient evaluation',()=>{const t=bt();near(t.psat(0,353.24),100000*10**(4.72583-1660.652/(353.24-1.461)),1e-10);assert.ok(Math.abs(t.psat(0,353.24)-101325)<1000);});
test('Ideal mixture TP flash closes all component balances and y=Kx',()=>{
  const s=bt().flashTP(100,[.5,.5],368.15,101325);assert.ok(s.beta>0&&s.beta<1);
  for(let i=0;i<2;i++){near(s.z[i],(1-s.beta)*s.x[i]+s.beta*s.y[i],1e-12);near(s.y[i],s.K[i]*s.x[i],1e-12);}
  near(sum(s.x),1,1e-12);near(sum(s.y),1,1e-12);
});
test('Bubble and dew points bracket a two-phase mixture',()=>{const t=bt(),{bubble,dew}=t.bubbleDew([.5,.5],101325);assert.ok(bubble<368.15&&dew>368.15);near(t.flashTP(1,[.5,.5],bubble,101325).beta,0,1e-7);near(t.flashTP(1,[.5,.5],dew,101325).beta,1,1e-7);});
test('Mixture TP → PH round-trip over liquid, two-phase and vapor states',()=>{
  const t=bt();for(const T of [335,355,368.15,390,420]){const a=t.flashTP(50,[.5,.5],T,101325),b=t.flashPH(50,a.z,a.P,a.h);near(a.T,b.T,2e-7);near(a.beta,b.beta,1e-8);near(a.H,b.H,1e-4);}
});
test('Pure-component PH plateau uses latent heat and returns exact quality',()=>{
  const t=new Thermodynamics(['water']);const T=370,P=t.psat(0,T),hL=t.hL(0,T,P),hV=t.hV(0,T);
  for(const b of [0,.1,.5,.9,1]){const s=t.flashPH(10,[1],P,(1-b)*hL+b*hV);near(s.T,T,1e-8);near(s.beta,b,1e-10);}
});
test('Pure-component TP saturation explicitly reports ambiguity',()=>{const t=new Thermodynamics(['water']),s=t.flashTP(1,[1],360,t.psat(0,360));assert.equal(s.ambiguous,true);assert.equal(s.beta,0);assert.match(s.warnings.join(),/underdetermined/);});
test('Strict Antoine validity rejects extrapolation',()=>{assert.throws(()=>new Thermodynamics(['benzene'],'IDEAL-RAOULT',{strictRange:true}).flashTP(1,[1],300,101325),e=>e.code==='PROPERTY_RANGE');});
test('Non-strict Antoine validity produces explicit warning',()=>assert.match(new Thermodynamics(['benzene']).flashTP(1,[1],300,101325).warnings.join(),/extrapolation/));
test('Water/alcohol nonideality caveat is attached to state',()=>assert.match(new Thermodynamics(['water','ethanol']).flashTP(1,[.5,.5],340,101325).warnings.join(),/Polar mixture/));
test('Ideal gas model is vapor-only and round-trips enthalpy',()=>{const t=new Thermodynamics(['benzene','toluene'],'IDEAL-GAS'),s=t.flashTP(1,[.4,.6],400,2e5),r=t.flashPH(1,s.z,s.P,s.h);assert.equal(s.beta,1);near(r.T,400,1e-7);});
test('Invalid composition and absolute pressure rejected',()=>{assert.throws(()=>bt().flashTP(1,[.2,.4],350,101325),/sum to 1/);assert.throws(()=>bt().flashTP(1,[.5,.5],350,-1),/Absolute pressure/);});
test('Mixer analytical weighted temperature, same pressure and composition',()=>{
  const p=network('mixer'),f2=clone(p.nodes[0]);f2.id='feed2';f2.tag='FEED2';f2.cfg.F=100;f2.cfg.T=348.15;p.nodes.push(f2);p.streams.push({id:'in2',tag:'IN2',kind:'material',from:{node:'feed2',port:'out'},to:{node:'unit',port:'in2'}});
  const r=simulate(p);near(r.streams.out.F,200);near(r.streams.out.T,343.15,1e-7);near(r.diagnostics.globalEnergyResidual,0,1e-4);
});
test('Splitter analytical component balance',()=>{const r=simulate(network('splitter',{fraction:.27}));near(r.streams.out1.F,27);near(r.streams.out2.F,73);near(r.diagnostics.globalMassResidual,0);});
test('Zero-flow splitter outlet remains finite and propagates',()=>{const r=simulate(network('splitter',{fraction:0}));assert.equal(r.streams.out1.F,0);assert.ok(Number.isFinite(r.streams.out1.h));assert.equal(r.status,'converged');});
test('Heater analytical sensible duty at constant pressure',()=>{const r=simulate(network('heater',{T:348.15}));near(r.blocks.unit.Q,100*(.5*136.1+.5*156)*10,1e-5);});
test('Specified heater duty closes energy independently',()=>{const r=simulate(network('heater',{mode:'Q',Q:146050}));near(r.streams.out.T,348.15,1e-6);near(r.blocks.unit.energyResidual,0,1e-4);});
test('Cooler sensible heat sign',()=>{const r=simulate(network('cooler',{T:333.15}));assert.ok(r.blocks.unit.Q<0);near(r.blocks.unit.Q,-73025,1e-5);});
test('Wrong heater duty direction is diagnosed',()=>assert.throws(()=>simulate(network('heater',{T:330})),e=>e.code==='DUTY_SIGN'));
test('Pump work and pressure enthalpy correction',()=>{
  const p=network('pump',{P:301325,efficiency:.8});const r=simulate(p),s=r.streams.in,v=.5*.0781118/874+.5*.0921384/867;
  near(r.blocks.unit.W,100*v*200000/.8,1e-7);near(r.streams.out.H-s.H,r.blocks.unit.W,1e-4);
  near(r.streams.out.T-s.T,v*200000*(1/.8-1)/(.5*136.1+.5*156),1e-7);
});
test('Pump rejects vapor feed',()=>assert.throws(()=>simulate(network('pump',{P:3e5},{T:410})),e=>e.code==='PUMP_VAPOR'));
test('Valve is isenthalpic and flashes a pressurized liquid',()=>{
  const r=simulate(network('valve',{P:101325},{T:373.15,P:3e5}));near(r.streams.out.h,r.streams.in.h,1e-5);assert.ok(r.streams.out.beta>0);assert.ok(r.streams.out.T<r.streams.in.T);
});
test('Valve cannot increase pressure',()=>assert.throws(()=>simulate(network('valve',{P:2e5})),/must not exceed/));
test('Flash outputs satisfy feed component and energy balance',()=>{const r=simulate(network('flash',{mode:'TP',T:368.15,P:101325},{P:3e5,T:373.15}));for(let i=0;i<2;i++)near(r.streams.vapor.F*r.streams.vapor.z[i]+r.streams.liquid.F*r.streams.liquid.z[i],50,1e-7);near(r.blocks.unit.energyResidual,0,1e-5);});
test('Adiabatic flash has zero heat and conserves enthalpy',()=>{const r=simulate(network('flash',{mode:'PH',Q:0,P:101325},{T:373.15,P:3e5}));near(r.blocks.unit.Q,0);near(r.streams.vapor.H+r.streams.liquid.H,r.streams.in.H,1e-4);});
test('Explicit energy input supplies heater duty',()=>{
  const p=network('heater',{mode:'Q',Q:5});const e=createNode('energy',10,50,p.components);e.id='energy';e.cfg.Q=146050;p.nodes.push(e);p.streams.push({id:'heat',tag:'HEAT',kind:'energy',from:{node:'energy',port:'eout'},to:{node:'unit',port:'qin'}});
  const r=simulate(p);near(r.blocks.unit.Q,146050);near(r.streams.out.T,348.15,1e-6);
});
test('Direct energy coupling transfers cooler heat into a second heater',()=>{
  const p=network('cooler',{T:333.15});const heater=createNode('heater',400,0,p.components);heater.id='h';heater.cfg.mode='Q';heater.cfg.Q=0;
  const f2=createNode('feed',0,100,p.components);f2.id='f2';f2.cfg={F:100,T:333.15,P:101325,z:{benzene:.5,toluene:.5}};
  const prod=createNode('product',600,0,p.components);prod.id='p2';p.nodes.push(heater,f2,prod);
  p.streams.push({id:'f2h',tag:'F2H',kind:'material',from:{node:'f2',port:'out'},to:{node:'h',port:'in'}},{id:'hp',tag:'HP',kind:'material',from:{node:'h',port:'out'},to:{node:'p2',port:'in'}},{id:'energy',tag:'ENERGY',kind:'energy',from:{node:'unit',port:'qout'},to:{node:'h',port:'qin'}});
  const r=simulate(p);near(r.blocks.h.Q,-r.blocks.unit.Q,1e-6);near(r.diagnostics.totalQ,0,1e-6);near(r.streams.hp.T,338.15,1e-7);
});
test('Default recycle process converges and closes global balances',()=>{
  const r=simulate(demoProject());assert.equal(r.converged,true);assert.ok(r.iterations>1);assert.ok(r.diagnostics.recycleResidual<1e-8);assert.ok(Math.abs(r.diagnostics.globalMassResidual)<1e-7);assert.ok(Math.abs(r.diagnostics.globalEnergyResidual)<.01);near(r.diagnostics.productFlow,100,1e-6);
});
test('Relaxed direct substitution and Wegstein reach same physical solution',()=>{
  const p=demoProject(),a=simulate(p);p.settings.acceleration='none';const b=simulate(p);assert.equal(b.converged,true);near(a.streams.VAPOR.F,b.streams.VAPOR.F,1e-5);near(a.streams.RECYCLE.F,b.streams.RECYCLE.F,1e-5);
});
test('Recycle iteration limit is reported, not disguised as convergence',()=>{const p=demoProject();p.settings.maxIterations=1;const r=simulate(p);assert.equal(r.converged,false);assert.match(r.warnings.join(),/did not converge/);});
test('An unbroken material cycle is diagnosed before simulation',()=>{
  const p=demoProject();p.nodes=p.nodes.filter(n=>n.id!=='recycle');p.streams=p.streams.filter(e=>!['RECYCLE','RECYCLE-COLD'].includes(e.id));p.streams.push({id:'loop',tag:'LOOP',kind:'material',from:{node:'cooler',port:'out'},to:{node:'mixer',port:'in2'}});assert.throws(()=>compile(p),e=>e.code==='UNBROKEN_CYCLE');
});
test('Unconnected material ports are diagnosed',()=>{const p=demoProject();p.streams.pop();p.streams.pop();assert.ok(validateReadiness(p).some(i=>i.severity==='error'));});
test('Connecting output twice is rejected',()=>{const p=demoProject();assert.throws(()=>checkConnection(p,{node:'feed',port:'out'},{node:'mixer',port:'in3'},'material'),/already connected/);});
test('Sensitivity results are computed and change with temperature',()=>{
  const r=sensitivity(demoProject(),{node:'flash',parameter:'T',min:363.15,max:372.15,points:7,stream:'VAPOR',metric:'F'});assert.equal(r.rows.length,7);assert.ok(r.rows.every(r=>r.status==='converged'));assert.ok(r.rows.at(-1).y>r.rows[0].y);
});
test('Sensitivity keeps failed cases explicit',()=>{const r=sensitivity(demoProject(),{node:'valve',parameter:'P',min:1e5,max:5e5,points:3,stream:'VAPOR',metric:'F'});assert.ok(r.rows.some(r=>r.status==='error'&&r.y===null));});
test('JSON project round-trip preserves computed results',()=>{
  const p=demoProject(),q=parseProject(JSON.stringify(p));assert.deepEqual(p,q);near(simulate(p).streams.VAPOR.F,simulate(q).streams.VAPOR.F,0,0);
});
test('Import rejects unsupported schemas and prototype keys',()=>{assert.throws(()=>parseProject('{"schemaVersion":99}'));assert.throws(()=>parseProject('{"__proto__": {"polluted":true}}'),/Unsafe project key/);});
test('Undo, redo and divergent edits have transactional semantics',()=>{
  const h=new History(2),a=emptyProject(),b=clone(a);b.name='Edited';assert.ok(h.commit(a,b));assert.deepEqual(h.undo(),a);assert.deepEqual(h.redo(),b);h.undo();const c=clone(a);c.name='Different';h.commit(a,c);assert.equal(h.redo(),null);
});
test('Every component supports a finite in-range state',()=>{for(const c of COMPONENTS){const t=new Thermodynamics([c.id]),T=(c.antoine.Tmin+c.antoine.Tmax)/2,s=t.flashTP(1,[1],T,101325);assert.ok(Number.isFinite(s.h));assert.ok(Number.isFinite(s.density));}});
test('Inherited property names are not components, operations, or units',()=>{
  assert.throws(()=>new Thermodynamics(['constructor']));
  assert.throws(()=>createNode('constructor',0,0,['benzene']));
  assert.throws(()=>convert(1,'constructor','constructor'));
  const p=demoProject();p.nodes[0].type='constructor';assert.throws(()=>parseProject(JSON.stringify(p)));
});
test('Reserved record identifiers cannot be injected through JSON',()=>{
  for(const key of ['__proto__','constructor','prototype']){
    const p=demoProject();p.nodes[0].id=key;assert.throws(()=>parseProject(JSON.stringify(p)));
    const q=demoProject();q.streams[0].id=key;assert.throws(()=>parseProject(JSON.stringify(q)));
  }
});
test('Two independent tear loops solve together and close analytically',()=>{
  const p=emptyProject();p.nodes=[];p.streams=[];
  for(const [index,recycleFraction] of [[0,.25],[1,.7]]){
    const prefix='loop'+index, fresh=10*(index+1);
    for(const [type,id] of [['feed','f'],['mixer','m'],['splitter','s'],['recycle','r'],['product','p']]){
      const n=createNode(type,0,0,p.components);n.id=prefix+id;n.tag=n.id;
      if(type==='feed')n.cfg.F=fresh;
      if(type==='splitter')n.cfg.fraction=1-recycleFraction;
      p.nodes.push(n);
    }
    for(const [id,a,ap,b,bp] of [['a','f','out','m','in1'],['b','m','out','s','in'],['c','s','out1','p','in'],['d','s','out2','r','in'],['e','r','out','m','in2']])p.streams.push({id:prefix+id,tag:prefix+id,kind:'material',from:{node:prefix+a,port:ap},to:{node:prefix+b,port:bp}});
  }
  const r=simulate(p);assert.equal(r.converged,true);assert.equal(r.diagnostics.tearStreams.length,2);
  near(r.streams.loop0e.F,10*.25/.75,1e-5);near(r.streams.loop1e.F,20*.7/.3,1e-5);near(r.diagnostics.productFlow,30,1e-5);
});
test('Energy dependencies form part of cycle detection',()=>{
  const p=network('heater',{mode:'Q'});const h=createNode('heater',0,0,p.components);h.id='h2';h.cfg.mode='Q';p.nodes.push(h);
  const old=p.streams.find(e=>e.id==='out');old.to={node:'h2',port:'in'};
  p.streams.push({id:'last',tag:'LAST',kind:'material',from:{node:'h2',port:'out'},to:{node:'p0',port:'in'}},{id:'returnQ',tag:'RETURNQ',kind:'energy',from:{node:'h2',port:'qout'},to:{node:'unit',port:'qin'}});
  assert.throws(()=>compile(p),e=>e.code==='UNBROKEN_CYCLE');
});
test('Project import rejects missing, nonnumeric, and array specifications',()=>{
  for(const cfg of [{},[],{mode:'TP',T:null,P:101325,Q:0},{mode:'TP',T:368.15,P:'1 bar',Q:0}]){
    const p=demoProject();p.nodes.find(n=>n.id==='flash').cfg=cfg;assert.throws(()=>parseProject(JSON.stringify(p)));
  }
});
test('Project import rejects invalid composition containers and calculation modes',()=>{
  const p=demoProject();p.nodes.find(n=>n.id==='feed').cfg.z=null;assert.throws(()=>parseProject(JSON.stringify(p)));
  const q=demoProject();q.nodes.find(n=>n.id==='flash').cfg.mode='fake-EOS';assert.throws(()=>parseProject(JSON.stringify(q)));
});
test('Project import rejects unknown display unit sets',()=>{const p=demoProject();p.units='constructor';assert.throws(()=>parseProject(JSON.stringify(p)));});
