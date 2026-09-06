import { fromSI, UNIT_SETS } from './units.js';
import { TYPES } from './model.js';
export const NODE_W = 116, NODE_H = 90;
const palette = { ink: '#28464e', teal: '#107c70', line: '#498f86', energy: '#c0923e', border: '#d6e1df', selected: '#147d70', white: '#ffffff', muted: '#79908f' };
const color = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1];
export function portPoint(node, port) {
  let side = port.side;
  if (node.flip) { if (side === 'left') side = 'right'; else if (side === 'right') side = 'left'; }
  const t = port.offset, x = node.x, y = node.y;
  return side === 'left' ? { x, y: y + NODE_H * t, dx: -1, dy: 0 } : side === 'right' ? { x: x + NODE_W, y: y + NODE_H * t, dx: 1, dy: 0 } : side === 'top' ? { x: x + NODE_W * t, y, dx: 0, dy: -1 } : { x: x + NODE_W * t, y: y + NODE_H, dx: 0, dy: 1 };
}
export function route(a, b) {
  const a1 = { x: a.x + a.dx * 24, y: a.y + a.dy * 24 }, b1 = { x: b.x + b.dx * 24, y: b.y + b.dy * 24 };
  let mid;
  if (a.dx && b.dx) {
    if (a.dx * (b1.x - a1.x) >= 0 && a.dx === -b.dx) mid = [{ x: (a1.x + b1.x) / 2, y: a1.y }, { x: (a1.x + b1.x) / 2, y: b1.y }];
    else { const y = Math.max(a1.y, b1.y) + 86; mid = [{ x: a1.x, y }, { x: b1.x, y }]; }
  } else if (a.dy && b.dy) { const y = (a1.y + b1.y) / 2; mid = [{ x: a1.x, y }, { x: b1.x, y }]; }
  else mid = a.dx ? [{ x: b1.x, y: a1.y }] : [{ x: a1.x, y: b1.y }];
  return [a, a1, ...mid, b1, b].filter((p, i, ar) => i === 0 || p.x !== ar[i - 1].x || p.y !== ar[i - 1].y);
}
class Geometry {
  constructor() { this.data = []; this.commands = []; }
  triangle(a, b, c, fill) { const col = color(fill); this.data.push(...a, ...col, ...b, ...col, ...c, ...col); }
  polygon(points, fill) { for (let i = 1; i < points.length - 1; i++) this.triangle(points[0], points[i], points[i + 1], fill); this.commands.push({ points, fill }); }
  line(x1, y1, x2, y2, width, fill) {
    const len = Math.hypot(x2 - x1, y2 - y1); if (len < 1e-8) return;
    const dx = -(y2 - y1) / len * width / 2, dy = (x2 - x1) / len * width / 2;
    this.polygon([[x1 + dx, y1 + dy], [x2 + dx, y2 + dy], [x2 - dx, y2 - dy], [x1 - dx, y1 - dy]], fill);
  }
  rect(x, y, w, h, fill, r = 0) {
    if (!r) { this.polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]], fill); return; }
    const points = [];
    for (let c = 0; c < 4; c++) {
      const cx = [x+w-r,x+w-r,x+r,x+r][c], cy=[y+r,y+h-r,y+h-r,y+r][c];
      for (let j = 0; j <= 6; j++) { const a=(-90+c*90+j*15)*Math.PI/180; points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]); }
    }
    this.polygon(points,fill);
  }
  circle(x, y, r, fill) { const p=[]; for(let i=0;i<36;i++){const a=i*Math.PI/18;p.push([x+r*Math.cos(a),y+r*Math.sin(a)]);} this.polygon(p,fill); }
}
function symbol(g, type, x, y, selected, flip = false) {
  const c = selected ? palette.teal : palette.ink, f = '#ffffff', w=2;
  const line=(a,b,cx,d,ww=w)=>g.line(x+a,y+b,x+cx,y+d,ww,c);
  const poly=points=>g.polygon(points.map(p=>[x+p[0],y+p[1]]),c);
  const circle=(r)=>{g.circle(x,y,r,c);g.circle(x,y,r-2,f);};
  switch(type) {
    case 'feed': case 'product': {
      poly([[-25,-8],[5,-8],[5,-17],[25,0],[5,17],[5,8],[-25,8]]); break;
    }
    case 'mixer': poly([[-24,-23],[25,0],[-24,23]]);g.polygon([[x-21,y-19],[x+20,y],[x-21,y+19]],f);break;
    case 'splitter': poly([[-25,0],[24,-23],[24,23]]);g.polygon([[x-20,y],[x+21,y-19],[x+21,y+19]],f);break;
    case 'heater': circle(23);line(-29,0,-19,0);line(-19,0,-11,-9);line(-11,-9,0,9);line(0,9,11,-9);line(11,-9,19,0);line(19,0,29,0);break;
    case 'cooler': circle(23);line(0,-15,0,15);line(-13,-8,13,8);line(-13,8,13,-8);break;
    case 'pump': circle(21);poly([[-8,-10],[13,0],[-8,10]]);line(-17,25,17,25);line(-10,19,-16,25);line(10,19,16,25);break;
    case 'valve': poly([[-24,-15],[24,15],[24,-15]]);poly([[-24,-15],[-24,15],[24,-15]]);g.polygon([[x-21,y-11],[x-21,y+11],[x-3,y]],f);g.polygon([[x+21,y-11],[x+21,y+11],[x+3,y]],f);line(0,0,0,-27);line(-9,-27,9,-27);break;
    case 'flash': g.rect(x-20,y-31,40,62,c,19);g.rect(x-18,y-29,36,58,f,17);g.rect(x-17,y+7,34,8,'#dcefe9');line(-18,6,18,6);line(-29,-2,-20,-2);line(20,-16,30,-16);line(20,20,30,20);break;
    case 'recycle': {
      for(let i=0;i<25;i++){const a=(i*12+30)*Math.PI/180,b=((i+1)*12+30)*Math.PI/180;line(Math.cos(a)*22,Math.sin(a)*22,Math.cos(b)*22,Math.sin(b)*22,2.5);}
      poly([[22,-15],[22,-2],[11,-10]]);break;
    }
    case 'energy': case 'energySink': if(type==='energySink')circle(25);poly([[4,-22],[-14,3],[-2,3],[-5,23],[15,-5],[3,-5]]);break;
  }
}
const GPU_SHADER = `
struct Camera { size: vec2f, pan: vec2f, zoom: f32, pad: f32, pad2: vec2f };
@group(0) @binding(0) var<uniform> camera: Camera;
struct VOut { @builtin(position) pos: vec4f, @location(0) color: vec4f };
@vertex fn vs(@location(0) p: vec2f, @location(1) color: vec4f) -> VOut {
  var o: VOut; let screen = p * camera.zoom + camera.pan;
  o.pos = vec4f(screen.x / camera.size.x * 2.0 - 1.0, 1.0 - screen.y / camera.size.y * 2.0, 0.0, 1.0); o.color = color; return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f { return i.color; }
struct BGOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn bgvs(@builtin(vertex_index) i: u32) -> BGOut {
  var p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); var o: BGOut; o.pos=vec4f(p[i],0,1); o.uv=vec2f((p[i].x+1.0)*0.5,(1.0-p[i].y)*0.5); return o;
}
@fragment fn bgfs(i: BGOut) -> @location(0) vec4f {
  let world=(i.uv*camera.size-camera.pan)/camera.zoom;
  let cell=abs(fract((world+12.0)/24.0)-0.5)*24.0*camera.zoom;
  let d=length(cell); let dot=1.0-smoothstep(0.45,1.1,d);
  return vec4f(mix(vec3f(0.973,0.982,0.978),vec3f(0.79,0.84,0.82),dot),1.0);
}`;
export class FlowsheetRenderer {
  constructor(host, callbacks = {}) {
    this.host=host;this.callbacks=callbacks;this.camera={x:20,y:30,zoom:.75};this.selection=null;this.tool='select';this.dirty=true;this.pending=false;this.spatial=new Map();
    this.canvas=document.createElement('canvas');this.overlay=document.createElement('canvas');this.canvas.className='gpu-canvas';this.overlay.className='label-canvas';host.append(this.canvas,this.overlay);
    this.ctx=this.overlay.getContext('2d');this.mode='initializing';this.project=null;this.geometry=new Geometry();this.edgePaths=[];this.setupEvents();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.initialize().then(()=>this.invalidate());
  }
  async initialize() {
    try {
      if (!navigator.gpu) throw new Error('WebGPU unavailable');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
      const device=await adapter.requestDevice();this.device=device;this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('No GPU canvas context');
      this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device,format:this.format,alphaMode:'opaque'});
      this.uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const module=device.createShaderModule({code:GPU_SHADER});
      const infos=await module.getCompilationInfo();if(infos.messages.some(m=>m.type==='error'))throw new Error(infos.messages.map(m=>m.message).join('\n'));
      const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
      const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
      this.bind=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:this.uniform}}]});
      const common={layout:pipelineLayout,primitive:{topology:'triangle-list'},multisample:{count:1}};
      this.pipeline=await device.createRenderPipelineAsync({...common,vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:this.format}]}});
      this.bgPipeline=await device.createRenderPipelineAsync({...common,vertex:{module,entryPoint:'bgvs'},fragment:{module,entryPoint:'bgfs',targets:[{format:this.format}]}});
      this.mode='WebGPU';device.lost.then(info=>{if(this.mode==='WebGPU')this.fallback(`Device lost: ${info.message}`);});
      device.addEventListener('uncapturederror',e=>this.callbacks.onError?.(e.error.message));
      this.upload();this.callbacks.onBackend?.(this.mode);
    } catch(error) { this.fallback(error.message); }
  }
  fallback(reason) {
    // A WebGPU-configured canvas cannot be reused as a 2D canvas. Replace the element.
    const old=this.canvas;this.canvas=document.createElement('canvas');this.canvas.className='gpu-canvas';old.replaceWith(this.canvas);this.fallbackCtx=this.canvas.getContext('2d');
    this.mode='Canvas 2D';this.fallbackReason=reason;this.resize();this.callbacks.onBackend?.(this.mode);this.invalidate();
  }
  resize(){const r=this.host.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.dpr=Math.min(devicePixelRatio||1,2);for(const c of [this.canvas,this.overlay]){c.width=Math.round(this.width*this.dpr);c.height=Math.round(this.height*this.dpr);c.style.width=this.width+'px';c.style.height=this.height+'px';}this.invalidate();}
  setScene(project,results,selection){this.project=project;this.results=results;this.selection=selection;this.build();this.invalidate();}
  setTool(tool){this.tool=tool;this.host.dataset.tool=tool;this.build();this.invalidate();}
  nodePosition(node){return this.drag?.node===node.id?{...node,x:this.drag.x,y:this.drag.y}:node;}
  build(){
    if(!this.project)return;const g=new Geometry();this.edgePaths=[];this.spatial.clear();
    const nodes=new Map(this.project.nodes.map(n=>[n.id,this.nodePosition(n)]));
    for(const edge of this.project.streams){
      const a=nodes.get(edge.from.node),b=nodes.get(edge.to.node);if(!a||!b)continue;
      const ap=TYPES[a.type].ports.find(p=>p.id===edge.from.port),bp=TYPES[b.type].ports.find(p=>p.id===edge.to.port);if(!ap||!bp)continue;
      const path=route(portPoint(a,ap),portPoint(b,bp));const selected=this.selection?.kind==='stream'&&this.selection.id===edge.id;
      const c=selected?palette.teal:edge.kind==='energy'?palette.energy:palette.line, w=selected?3.3:2;
      for(let i=1;i<path.length;i++){
        const p=path[i-1],q=path[i];
        if(edge.kind==='energy'){const len=Math.hypot(q.x-p.x,q.y-p.y);for(let d=0;d<len;d+=11){const d2=Math.min(d+6,len);g.line(p.x+(q.x-p.x)*d/len,p.y+(q.y-p.y)*d/len,p.x+(q.x-p.x)*d2/len,p.y+(q.y-p.y)*d2/len,w,c);}}
        else g.line(p.x,p.y,q.x,q.y,w,c);
      }
      const end=path.at(-1), prev=path.at(-2), dx=end.x-prev.x,dy=end.y-prev.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
      g.polygon([[end.x,end.y],[end.x-ux*9-uy*4,end.y-uy*9+ux*4],[end.x-ux*9+uy*4,end.y-uy*9-ux*4]],c);
      this.edgePaths.push({edge,path});
    }
    for(const n of nodes.values()){
      const sel=this.selection?.kind==='node'&&this.selection.id===n.id, energy=['energy','energySink'].includes(n.type), c=energy?palette.energy:sel?palette.selected:palette.border;
      if(sel)g.rect(n.x-5,n.y-5,NODE_W+10,NODE_H+10,'#deeee7',12);
      g.rect(n.x+1,n.y+3,NODE_W,NODE_H,'#e9efec',9);g.rect(n.x,n.y,NODE_W,NODE_H,c,8);g.rect(n.x+1.3,n.y+1.3,NODE_W-2.6,NODE_H-2.6,'#ffffff',7);
      symbol(g,n.type,n.x+NODE_W/2,n.y+NODE_H/2,sel,n.flip);
      if(this.results?.blocks[n.id]){g.circle(n.x+NODE_W-10,n.y+10,3.2,this.results.converged?'#49a48b':'#d49b3f');}
      for(const p of TYPES[n.type].ports){
        if(p.kind==='energy' && this.tool!=='energy'&&!sel&&!this.project.streams.some(e=>e.kind==='energy'&&(e.from.node===n.id&&e.from.port===p.id||e.to.node===n.id&&e.to.port===p.id)))continue;
        const a=portPoint(n,p),pc=p.kind==='energy'?palette.energy:palette.teal;
        g.circle(a.x,a.y,this.tool==='connect'||this.tool==='energy'?5:3,pc);g.circle(a.x,a.y,1.6,'#ffffff');
      }
      const key=`${Math.floor(n.x/180)},${Math.floor(n.y/180)}`;if(!this.spatial.has(key))this.spatial.set(key,[]);this.spatial.get(key).push(n);
    }
    this.geometry=g;this.upload();
  }
  upload(){if(this.mode!=='WebGPU'||!this.device)return;const data=new Float32Array(this.geometry.data),size=Math.max(24,data.byteLength);if(!this.vertexBuffer||this.bufferSize<size){this.vertexBuffer?.destroy();this.bufferSize=Math.max(size,Math.ceil((this.bufferSize||1024)*1.5));this.vertexBuffer=this.device.createBuffer({size:Math.ceil(this.bufferSize/4)*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}if(data.length)this.device.queue.writeBuffer(this.vertexBuffer,0,data);this.vertexCount=data.length/6;}
  invalidate(){if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.render();});}
  render(){
    if(!this.width)return;const c=this.camera;
    if(this.mode==='WebGPU'){
      this.device.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,c.x,c.y,c.zoom,0,0,0]));
      const encoder=this.device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.973,g:.982,b:.978,a:1}}]});
      pass.setBindGroup(0,this.bind);pass.setPipeline(this.bgPipeline);pass.draw(3);
      if(this.vertexCount){pass.setPipeline(this.pipeline);pass.setVertexBuffer(0,this.vertexBuffer);pass.draw(this.vertexCount);}pass.end();this.device.queue.submit([encoder.finish()]);
    } else if(this.fallbackCtx){
      const ctx=this.fallbackCtx;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.fillStyle='#f8faf9';ctx.fillRect(0,0,this.width,this.height);
      const step=24*c.zoom;ctx.fillStyle='#d1ded8';for(let x=((c.x%step)+step)%step;x<this.width;x+=step)for(let y=((c.y%step)+step)%step;y<this.height;y+=step){ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill();}
      ctx.translate(c.x,c.y);ctx.scale(c.zoom,c.zoom);for(const command of this.geometry.commands){ctx.fillStyle=command.fill;ctx.beginPath();command.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();}
    }
    this.drawLabels();this.callbacks.onView?.({...this.camera});
  }
  drawLabels(){const ctx=this.ctx,c=this.camera,d=this.dpr;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,this.width,this.height);if(!this.project)return;
    const text=(t,x,y,size=11,fill='#29493f',weight=500,align='center',back=false)=>{
      const sx=x*c.zoom+c.x,sy=y*c.zoom+c.y;if(sx<-120||sx>this.width+120||sy<-30||sy>this.height+30)return;
      ctx.font=`${weight} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';
      if(back){const tw=ctx.measureText(t).width;ctx.fillStyle='#f8faf9';ctx.fillRect(sx-tw/2-4,sy-size/2-2,tw+8,size+4);}ctx.fillStyle=fill;ctx.fillText(t,sx,sy);
    };
    for(const {edge,path} of this.edgePaths){
      let longest=null,length=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(len>length){longest=[a,b];length=len;}}
      if(longest&&length*c.zoom>45){const [a,b]=longest,x=(a.x+b.x)/2,y=(a.y+b.y)/2;
        const tag=edge.tag.length>17?edge.tag.slice(0,15)+'…':edge.tag;text(tag,x,y-12/c.zoom,9,edge.kind==='energy'?'#ad812f':'#72867f',600,'center',true);
        const r=this.results?.streams[edge.id];if(typeof r==='number')text((r/1000).toFixed(1)+' kW',x,y+12/c.zoom,9,'#a8843b',500,'center',true);
      }
    }
    for(const original of this.project.nodes){const n=this.nodePosition(original),sel=this.selection?.kind==='node'&&this.selection.id===n.id;
      text(n.tag,n.x+NODE_W/2,n.y-17/c.zoom,11,sel?'#137b6c':'#314e47',650);
      const s=this.results?.blocks[n.id]?.state;
      const units=UNIT_SETS[this.project.units]??UNIT_SETS.Engineering;
      const subtitle=s&&typeof s==='object'?`${fromSI(s.T,units.T).toFixed(1)} ${units.T}`+(c.zoom>=.5?` · ${fromSI(s.P,units.P).toFixed(2)} ${units.P}`:''):TYPES[n.type].name;
      text(subtitle,n.x+NODE_W/2,n.y+NODE_H+15/c.zoom,9,'#7a8a83',450);
    }
    if(this.connectStart){const n=this.project.nodes.find(n=>n.id===this.connectStart.node);if(n){const p=TYPES[n.type].ports.find(p=>p.id===this.connectStart.port),a=portPoint(n,p);ctx.strokeStyle='#168173';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(a.x*c.zoom+c.x,a.y*c.zoom+c.y);ctx.lineTo(this.pointer?.x??0,this.pointer?.y??0);ctx.stroke();ctx.setLineDash([]);}}
  }
  screenToWorld(x,y){return{x:(x-this.camera.x)/this.camera.zoom,y:(y-this.camera.y)/this.camera.zoom};}
  fit(){if(!this.project?.nodes.length){this.camera={x:50,y:50,zoom:1};this.invalidate();return;}
    const nodes=this.project.nodes,minX=Math.min(...nodes.map(n=>n.x))-60,minY=Math.min(...nodes.map(n=>n.y))-70,maxX=Math.max(...nodes.map(n=>n.x+NODE_W))+60,maxY=Math.max(...nodes.map(n=>n.y+NODE_H))+85;
    const zoom=Math.min(1.3,Math.max(.15,Math.min(this.width/(maxX-minX),this.height/(maxY-minY))));this.camera={zoom,x:(this.width-(maxX-minX)*zoom)/2-minX*zoom,y:(this.height-(maxY-minY)*zoom)/2-minY*zoom};this.invalidate();}
  zoom(factor,x=this.width/2,y=this.height/2){const a=this.screenToWorld(x,y),z=Math.max(.15,Math.min(3,this.camera.zoom*factor));this.camera={zoom:z,x:x-a.x*z,y:y-a.y*z};this.invalidate();}
  focusNode(id){const n=this.project.nodes.find(n=>n.id===id);if(!n)return;this.camera.x=this.width/2-(n.x+NODE_W/2)*this.camera.zoom;this.camera.y=this.height/2-(n.y+NODE_H/2)*this.camera.zoom;this.invalidate();}
  hit(x,y){
    const world=this.screenToWorld(x,y),threshold=10/this.camera.zoom;
    // Port and node lookup is spatially binned; stream hit testing uses cached orthogonal segments.
    const candidates=[];const bx=Math.floor(world.x/180),by=Math.floor(world.y/180);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)candidates.push(...(this.spatial.get(`${bx+dx},${by+dy}`)||[]));
    for(const n of candidates.reverse()){
      if(this.tool==='connect'||this.tool==='energy')for(const p of TYPES[n.type].ports){if(p.kind!==(this.tool==='energy'?'energy':'material'))continue;const a=portPoint(n,p);if(Math.hypot(world.x-a.x,world.y-a.y)<threshold)return{kind:'port',node:n.id,port:p.id,direction:p.direction,streamKind:p.kind};}
      if(world.x>=n.x&&world.x<=n.x+NODE_W&&world.y>=n.y&&world.y<=n.y+NODE_H)return{kind:'node',id:n.id};
    }
    for(const {edge,path} of this.edgePaths)for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],vx=b.x-a.x,vy=b.y-a.y,l=vx*vx+vy*vy,t=l?Math.max(0,Math.min(1,((world.x-a.x)*vx+(world.y-a.y)*vy)/l)):0;
      if(Math.hypot(world.x-a.x-t*vx,world.y-a.y-t*vy)<6/this.camera.zoom)return{kind:'stream',id:edge.id};
    }
    return null;
  }
  setupEvents(){
    this.overlay.addEventListener('contextmenu',e=>e.preventDefault());
    this.overlay.addEventListener('wheel',e=>{e.preventDefault();const r=this.overlay.getBoundingClientRect();if(e.ctrlKey||e.metaKey||!e.shiftKey)this.zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);else{this.camera.x-=e.deltaY;this.invalidate();}},{passive:false});
    this.overlay.addEventListener('pointerdown',e=>{
      this.overlay.setPointerCapture(e.pointerId);const r=this.overlay.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const world=this.screenToWorld(x,y),hit=this.hit(x,y);
      if(e.button===1||e.button===2||this.space||this.tool==='pan'){this.pan={x,y,cx:this.camera.x,cy:this.camera.y};return;}
      if(this.tool.startsWith('add:')){this.callbacks.onAdd?.(this.tool.slice(4),world.x-NODE_W/2,world.y-NODE_H/2);return;}
      if(hit?.kind==='port'){
        if(hit.direction==='out'){this.connectStart={node:hit.node,port:hit.port};this.pointer={x,y};this.invalidate();this.callbacks.onHint?.('Now click a compatible input port.');}
        else if(this.connectStart){this.callbacks.onConnect?.(this.connectStart,{node:hit.node,port:hit.port},hit.streamKind);this.connectStart=null;this.invalidate();}
        else this.callbacks.onHint?.('Select an output port first.');return;
      }
      if(hit){this.callbacks.onSelect?.(hit);if(hit.kind==='node'&&this.tool==='select'){const n=this.project.nodes.find(n=>n.id===hit.id);this.drag={node:n.id,x:n.x,y:n.y,dx:world.x-n.x,dy:world.y-n.y,originalX:n.x,originalY:n.y};}}
      else {this.callbacks.onSelect?.(null);this.pan={x,y,cx:this.camera.x,cy:this.camera.y};}
    });
    this.overlay.addEventListener('pointermove',e=>{const r=this.overlay.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;this.pointer={x,y};
      if(this.pan){this.camera.x=this.pan.cx+x-this.pan.x;this.camera.y=this.pan.cy+y-this.pan.y;this.invalidate();}
      else if(this.drag){const w=this.screenToWorld(x,y);this.drag.x=Math.round((w.x-this.drag.dx)/10)*10;this.drag.y=Math.round((w.y-this.drag.dy)/10)*10;this.build();this.invalidate();}
      else if(this.connectStart)this.invalidate();
    });
    const end=()=>{if(this.drag){const d=this.drag;this.drag=null;if(d.x!==d.originalX||d.y!==d.originalY)this.callbacks.onMove?.(d.node,d.x,d.y);else this.build();}this.pan=null;this.invalidate();};
    this.overlay.addEventListener('pointerup',end);this.overlay.addEventListener('pointercancel',end);
    this.overlay.addEventListener('dblclick',e=>{const r=this.overlay.getBoundingClientRect(),hit=this.hit(e.clientX-r.left,e.clientY-r.top);if(hit)this.callbacks.onInspect?.(hit);});
    window.addEventListener('keydown',e=>{if(e.code==='Space'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){this.space=true;e.preventDefault();}});window.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});window.addEventListener('blur',()=>{this.space=false;});
  }
}
