import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { jsPDF } from 'jspdf';
import { frameBounds } from './geometry.js';
import {TraceRunner} from './trace-runner.js';
import { guessBackground, pathCommands, toSvgPath } from './trace.js';
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([__PDF_WORKER_SOURCE__], { type: 'text/javascript' }));
// Capture the pristine, fully bundled document before importing any user image.
const standaloneHTML='<!doctype html>\n'+document.documentElement.outerHTML;
const $ = id => document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d');
const state={source:null,work:null,rgba:null,w:0,h:0,background:[255,255,255],mask:null,paths:[],commands:[],rawPoints:0,physicalWidth:150,offsetMm:0,bounds:null,view:'overlay',tool:'view',zoom:1,pan:{x:0,y:0},transform:null,region:null,edits:null,history:[],pdf:null,name:'',generation:0};
const traceRunner=new TraceRunner(__TRACE_WORKER_SOURCE__);
let traceTimer=null,toastTimer=null,drag=null,traceRevision=0,sourceRevision=0,editRevision=0,appliedMaskVersion=-1,appliedCurveVersion=-1;
state.originalPaths=[];state.renderPaths=[];state.originalRenderPaths=[];
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500); }
function controls() {return {mode:$('mode').value,threshold:+$('threshold').value,background:state.background,invert:$('invert').checked,region:state.region};}
function updateLabels() {
  const mode=$('mode').value;
  $('threshold-value').textContent=$('threshold').value+'%';
  $('threshold-label').textContent=mode==='background'?'Tolerância do fundo':mode==='dark'?'Limite de luminosidade':'Opacidade mínima';
  $('threshold-hint').textContent=mode==='background'?'Aumente para ignorar mais variações do fundo.':mode==='dark'?'Aumente para selecionar áreas mais claras.':'Aumente para ignorar pixels semitransparentes.';
  $('background-control').hidden=mode!=='background';
  $('noise-value').textContent=$('noise').value+' px²';$('close-value').textContent=$('close').value+' px';
  $('simplify-value').textContent=Number($('simplify').value).toLocaleString('pt-BR')+' px';$('smooth-value').textContent=$('smooth').value+'%';
  $('brush-value').textContent=$('brush').value+' px';
  $('offset-value').textContent=state.offsetMm.toLocaleString('pt-BR')+' mm';
  $('offset-hint').textContent=`Positivo expande e une formas próximas. Negativo encolhe. Base: imagem de ${state.physicalWidth.toLocaleString('pt-BR')} mm.`;
  $('color-swatch').style.background=`rgb(${state.background.join(',')})`;
  const b=state.bounds,scale=state.physicalWidth/state.w,format=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:1});
  $('export-size').textContent=b ? `Área: ${format(b.width*scale)} × ${format(b.height*scale)} mm · imagem: ${format(state.physicalWidth)} mm`:'Proporção original preservada';
}
function traceOptions(){return {...controls(),close:+$('close').value,noise:+$('noise').value,largest:$('largest').checked,holes:$('holes').checked,general:$('general').checked,offsetPixels:state.offsetMm*state.w/state.physicalWidth,simplify:+$('simplify').value,smooth:+$('smooth').value,editRevision};}
function scheduleTrace(){
  traceRevision++;updateLabels();clearTimeout(traceTimer);$('processing-status').textContent='Atualizando…';
  traceTimer=setTimeout(updateTrace,60);
}
async function updateTrace(){
  clearTimeout(traceTimer);traceTimer=null;if(!state.rgba)return false;
  const revision=++traceRevision,source=sourceRevision,start=performance.now();state.traceError=null;
  $('processing-status').textContent='Atualizando…';
  try{
    const result=await traceRunner.request(traceOptions(),state.edits,appliedMaskVersion);
    if(!result || revision!==traceRevision || source!==sourceRevision)return false;
    Object.assign(state,{paths:result.paths,bounds:result.bounds,commands:result.commands,originalPaths:result.originalPaths,rawPoints:result.rawPoints});
    if(result.maskRGBA){
      if(!state.maskCanvas){state.maskCanvas=document.createElement('canvas');state.maskCanvas.width=state.w;state.maskCanvas.height=state.h;}
      state.maskCanvas.getContext('2d').putImageData(new ImageData(result.maskRGBA,state.w,state.h),0,0);
    }
    if(appliedMaskVersion!==result.maskVersion){state.originalRenderPaths=state.originalPaths.map(p=>new Path2D(toSvgPath(pathCommands(p))));}
    if(appliedCurveVersion!==result.curveVersion){state.renderPaths=state.commands.map(c=>new Path2D(toSvgPath(c)));}
    appliedMaskVersion=result.maskVersion;appliedCurveVersion=result.curveVersion;
    const points=state.paths.reduce((n,p)=>n+p.length,0);
    $('path-count').textContent=`${state.paths.length} contorno${state.paths.length===1?'':'s'}`;
    $('point-count').textContent=`${points.toLocaleString('pt-BR')} pontos`;
    $('reduction').textContent=state.rawPoints?`−${Math.round((1-points/state.rawPoints)*100)}% de pontos`:'';
    $('reduction').hidden=!state.rawPoints;
    $('export-pdf').disabled=$('export-svg').disabled=!state.paths.length;
    $('empty-state').hidden=state.paths.length>0;updateLabels();draw();
    $('processing-status').textContent=`Rastreio em ${Math.round(performance.now()-start)} ms`;
    $('processing-status').dataset.stages=JSON.stringify(result.stats.stages);
    $('processing-status').dataset.computeMs=result.stats.computeMs;
    $('processing-status').dataset.execution=result.execution;
    return true;
  }catch(error){
    if(revision!==traceRevision || source!==sourceRevision)return false;
    state.traceError=error;$('processing-status').textContent='Não foi possível rastrear';toast(error.message);
    $('export-pdf').disabled=$('export-svg').disabled=true;return false;
  }
}
async function ensureCurrentTrace(){
  const source=sourceRevision;
  while(!await updateTrace()){
    if(source!==sourceRevision)throw new Error('A imagem mudou durante o processamento. Exporte novamente.');
    if(state.traceError)throw state.traceError;
    if(!state.rgba)throw new Error('Importe uma imagem antes de exportar.');
  }
}
function draw() {
  const bounds=canvas.getBoundingClientRect();if(!bounds.width || !state.work)return;
  const dpr=window.devicePixelRatio||1;
  const width=Math.round(bounds.width*dpr),height=Math.round(bounds.height*dpr);
  if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,bounds.width,bounds.height);
  const frame=state.bounds || frameBounds([],state.w,state.h);
  const fit=Math.min((bounds.width-70)/frame.width,(bounds.height-100)/frame.height),scale=fit*state.zoom;
  const x=(bounds.width-frame.width*scale)/2-frame.minX*scale+state.pan.x,y=(bounds.height-frame.height*scale)/2-frame.minY*scale+state.pan.y;
  state.transform={scale,x,y};ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.shadowColor='#0f29161f';ctx.shadowBlur=20/scale;ctx.fillStyle=state.view==='vector'?'#f9faf5':'#fff';ctx.fillRect(0,0,state.w,state.h);ctx.shadowBlur=0;
  if(state.view!=='vector') ctx.drawImage(state.work,0,0);
  if(state.view==='mask'){ctx.fillStyle='#fbfbf7dd';ctx.fillRect(0,0,state.w,state.h);}
  if(state.view!=='vector' && state.maskCanvas){ctx.globalAlpha=state.view==='overlay'?.32:1;ctx.drawImage(state.maskCanvas,0,0);ctx.globalAlpha=1;}
  ctx.strokeStyle=$('stroke-color').value;ctx.lineWidth=1.7/scale;ctx.lineJoin='round';
  if(state.view==='overlay' && state.offsetMm!==0){ctx.save();ctx.strokeStyle='#768a80';ctx.lineWidth=.8/scale;ctx.setLineDash([4/scale,4/scale]);for(const path of state.originalRenderPaths)ctx.stroke(path);ctx.restore();}
  if(state.view!=='mask')for(const path of state.renderPaths)ctx.stroke(path);
  if($('points').checked && state.view!=='mask') {
    ctx.fillStyle='#fff';ctx.strokeStyle='#a53b55';ctx.lineWidth=.8/scale;
    ctx.beginPath();for(const path of state.paths)for(const [px,py]of path){ctx.moveTo(px+2.3/scale,py);ctx.arc(px,py,2.3/scale,0,2*Math.PI);}ctx.fill();ctx.stroke();
  }
  const region=drag?.kind==='region'?normalizedRect(drag.start,drag.current):state.region;
  if(region){ctx.setLineDash([5/scale,4/scale]);ctx.strokeStyle='#2f7053';ctx.lineWidth=1.5/scale;ctx.strokeRect(region.x,region.y,region.w,region.h);ctx.setLineDash([]);}
  ctx.restore();$('zoom-value').textContent=Math.round(state.zoom*100)+'%';
}
function normalizedRect(a,b){const x=Math.max(0,Math.min(a.x,b.x)),y=Math.max(0,Math.min(a.y,b.y));return {x:Math.floor(x),y:Math.floor(y),w:Math.max(1,Math.ceil(Math.min(state.w,Math.max(a.x,b.x))-x)),h:Math.max(1,Math.ceil(Math.min(state.h,Math.max(a.y,b.y))-y))};}
function imagePoint(event) {const r=canvas.getBoundingClientRect(),t=state.transform;return {x:(event.clientX-r.left-t.x)/t.scale,y:(event.clientY-r.top-t.y)/t.scale};}
function inImage(p){return p.x>=0 && p.y>=0 && p.x<state.w && p.y<state.h;}
function setTool(tool) {
  state.tool=tool;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  $('pick-background').classList.toggle('active',tool==='pick');$('brush-settings').hidden=!['add','erase'].includes(tool);
  canvas.style.cursor=tool==='view'?'grab':tool==='pick'?'crosshair':tool==='region'?'crosshair':'crosshair';
  const hints={view:'Arraste para mover. Use + e − para aproximar.',region:'Arraste um retângulo ao redor do que deseja traçar.',add:'Pinte sobre as partes que devem entrar no contorno.',erase:'Pinte sobre as partes que devem sair do contorno.',pick:'Clique na imagem para escolher a cor do fundo.'};
  $('tool-hint').textContent=hints[tool];
}
function pushHistory(){state.history.push({edits:state.edits.slice(),region:state.region?{...state.region}:null});if(state.history.length>15)state.history.shift();$('undo').disabled=false;}
function paint(p) {
  editRevision++;
  const radius=+$('brush').value/2;
  for(let y=Math.max(0,Math.floor(p.y-radius));y<Math.min(state.h,Math.ceil(p.y+radius));y++)for(let x=Math.max(0,Math.floor(p.x-radius));x<Math.min(state.w,Math.ceil(p.x+radius));x++)if((x-p.x)**2+(y-p.y)**2<=radius*radius)state.edits[y*state.w+x]=state.tool==='add'?1:-1;
}
canvas.addEventListener('pointerdown',event=>{
  if(!state.transform || event.button!==0)return;
  const p=imagePoint(event);
  if(state.tool==='pick'){if(inImage(p)){const i=(Math.floor(p.y)*state.w+Math.floor(p.x))*4;state.background=Array.from(state.rgba.slice(i,i+3));$('background-value').textContent='Escolhida na imagem';setTool('view');scheduleTrace();}return;}
  if(state.tool!=='view' && !inImage(p))return;
  canvas.setPointerCapture(event.pointerId);
  if(state.tool==='view')drag={kind:'view',client:{x:event.clientX,y:event.clientY},pan:{...state.pan}};
  else if(state.tool==='region')drag={kind:'region',start:p,current:p};
  else {pushHistory();drag={kind:'brush',last:p};paint(p);scheduleTrace();}
});
canvas.addEventListener('pointermove',event=>{
  if(!drag)return;
  if(drag.kind==='view'){state.pan={x:drag.pan.x+event.clientX-drag.client.x,y:drag.pan.y+event.clientY-drag.client.y};draw();}
  else if(drag.kind==='region'){drag.current=imagePoint(event);draw();}
  else {const p=imagePoint(event),distance=Math.hypot(p.x-drag.last.x,p.y-drag.last.y),steps=Math.min(1000,Math.max(1,Math.ceil(distance/(+$('brush').value/4))));for(let i=1;i<=steps;i++)paint({x:drag.last.x+(p.x-drag.last.x)*i/steps,y:drag.last.y+(p.y-drag.last.y)*i/steps});drag.last=p;scheduleTrace();}
});
function finishDrag(){if(!drag)return;if(drag.kind==='region'){pushHistory();state.region=normalizedRect(drag.start,drag.current);scheduleTrace();}else if(drag.kind==='brush')updateTrace();drag=null;draw();}
canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',finishDrag);
function resetSettings(runTrace=true) {
  $('mode').value='background';$('threshold').value=16;$('noise').value=40;$('close').value=0;$('simplify').value=1.5;$('smooth').value=25;$('offset').value=0;$('offset-mm').value=0;state.offsetMm=0;
  for(const id of ['largest','invert','holes','points','general'])$(id).checked=false;
  $('holes').disabled=false;
  editRevision++;
  state.region=null;state.history=[];$('undo').disabled=true;
  if(state.edits)state.edits.fill(0);
  if(state.rgba)state.background=guessBackground(state.rgba,state.w,state.h);
  $('background-value').textContent='Automática';setTool('view');updateLabels();if(runTrace)updateTrace();
}
function commitSource(source,name,demo=false) {
  const maxSide=1400,ratio=Math.min(1,maxSide/Math.max(source.width,source.height));
  const work=document.createElement('canvas');work.width=Math.max(1,Math.round(source.width*ratio));work.height=Math.max(1,Math.round(source.height*ratio));
  work.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,work.width,work.height);
  const rgba=work.getContext('2d').getImageData(0,0,work.width,work.height).data;
  Object.assign(state,{source,work,rgba,w:work.width,h:work.height,name,edits:new Int8Array(work.width*work.height),zoom:1,pan:{x:0,y:0},paths:[],commands:[],bounds:null,maskCanvas:null,renderPaths:[],originalPaths:[],originalRenderPaths:[]});
  sourceRevision++;traceRevision++;appliedMaskVersion=appliedCurveVersion=-1;editRevision=0;
  traceRunner.setSource({rgba,width:work.width,height:work.height});
  $('path-count').textContent='0 contornos';$('export-pdf').disabled=$('export-svg').disabled=true;draw();
  $('filename').textContent=name;$('demo-tag').hidden=!demo;
  $('dimensions').textContent=`${source.width} × ${source.height} px · rastreio ${work.width} × ${work.height} px`;
  resetSettings(false);
  let transparent=false;for(let i=3;i<rgba.length;i+=4)if(rgba[i]<250){transparent=true;break;}
  if(transparent){$('mode').value='alpha';$('threshold').value=10;}
  updateLabels();updateTrace();
}
function imageFromURL(url) {return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não foi possível ler esta imagem.'));image.src=url;});}
function cleanSvg(text) {
  const doc=new DOMParser().parseFromString(text,'image/svg+xml');
  if(doc.querySelector('parsererror') || doc.documentElement.localName!=='svg')throw new Error('O arquivo SVG é inválido.');
  let cleaned=false;
  doc.querySelectorAll('script,foreignObject,animate,animateMotion,animateTransform,set,iframe,object,embed').forEach(el=>{el.remove();cleaned=true;});
  for(const el of doc.querySelectorAll('*'))for(const attr of [...el.attributes]) {
    const name=attr.localName.toLowerCase(),value=attr.value.trim();
    if(name.startsWith('on') || name==='base' || ((name==='href' || name==='src') && !value.startsWith('#') && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value))){el.removeAttributeNode(attr);cleaned=true;}
    else if(name==='style' || value.includes('url(')){const safe=value.replace(/@import[^;]*;?/gi,'').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(whole,quote,url)=>url.trim().startsWith('#')?whole:'none');if(safe!==value){attr.value=safe;cleaned=true;}}
  }
  doc.querySelectorAll('style').forEach(el=>{const before=el.textContent;el.textContent=before.replace(/@import[^;]*;?/gi,'').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(whole,quote,url)=>url.trim().startsWith('#')?whole:'none');if(before!==el.textContent)cleaned=true;});
  if(cleaned)toast('SVG importado sem scripts ou recursos externos. Elementos dependentes desses recursos podem não aparecer.');
  return new XMLSerializer().serializeToString(doc);
}
async function loadPDFPage(pdf,pageNumber,generation) {
  if(!Number.isInteger(pageNumber) || pageNumber<1 || pageNumber>pdf.numPages)throw new Error(`Escolha uma página de 1 a ${pdf.numPages}.`);
  const page=await pdf.getPage(pageNumber),viewport=page.getViewport({scale:1});
  const scaled=page.getViewport({scale:Math.min(3,2400/Math.max(viewport.width,viewport.height))});
  const source=document.createElement('canvas');source.width=Math.ceil(scaled.width);source.height=Math.ceil(scaled.height);
  await page.render({canvasContext:source.getContext('2d'),viewport:scaled,background:'rgb(255,255,255)'}).promise;
  if(generation!==state.generation)return;
  commitSource(source,`${state.pdfName} · página ${pageNumber}`);state.pdf=pdf;
  $('pdf-page').value=pageNumber;$('pdf-page').max=pdf.numPages;$('pdf-pages').textContent=`de ${pdf.numPages}`;$('pdf-controls').hidden=false;
}
async function importFile(file) {
  if(!file)return;
  if(file.size>60*1024*1024){toast('O arquivo ultrapassa 60 MB. Use uma versão menor.');return;}
  const generation=++state.generation;
  $('processing-status').textContent='Importando…';
  try {
    if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true}).promise;
      if(generation!==state.generation){pdf.destroy();return;}
      const previous=state.pdf;state.pdfName=file.name;
      await loadPDFPage(pdf,1,generation);
      if(previous && previous!==pdf)previous.destroy();
    } else {
      let blob=file;
      if(file.type==='image/svg+xml' || /\.svg$/i.test(file.name))blob=new Blob([cleanSvg(await file.text())],{type:'image/svg+xml'});
      const url=URL.createObjectURL(blob);
      try {
        const image=await imageFromURL(url);
        if(generation!==state.generation)return;
        if(!image.naturalWidth || image.naturalWidth*image.naturalHeight>50000000 || image.naturalWidth>16000 || image.naturalHeight>16000)throw new Error('A imagem é grande demais. Reduza para até 50 megapixels e 16.000 px por lado.');
        const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;source.getContext('2d').drawImage(image,0,0);
        if(state.pdf)state.pdf.destroy();state.pdf=null;$('pdf-controls').hidden=true;commitSource(source,file.name);
      } finally {URL.revokeObjectURL(url);}
    }
  } catch(error) {console.error(error);if(generation!==state.generation)return;toast(error.name==='PasswordException'?'Este PDF tem senha. Importe uma cópia sem proteção.':`Falha na importação: ${error.message}`);$('processing-status').textContent='Importação não concluída';}
}
function createDemo() {
  ++state.generation;if(state.pdf)state.pdf.destroy();state.pdf=null;$('pdf-controls').hidden=true;
  const c=document.createElement('canvas');c.width=900;c.height=800;const d=c.getContext('2d');
  d.fillStyle='#f7f5ed';d.fillRect(0,0,900,800);
  d.fillStyle='#d9ddd02a';d.beginPath();d.ellipse(453,697,178,18,0,0,Math.PI*2);d.fill();
  d.strokeStyle='#5b794b';d.lineWidth=17;d.lineCap='round';d.beginPath();d.moveTo(450,576);d.bezierCurveTo(445,480,462,380,451,297);d.stroke();
  d.fillStyle='#78945d';d.beginPath();d.moveTo(450,480);d.bezierCurveTo(346,478,310,413,315,380);d.bezierCurveTo(391,373,445,421,450,480);d.fill();
  d.fillStyle='#476c4c';d.beginPath();d.moveTo(453,414);d.bezierCurveTo(471,342,537,312,593,327);d.bezierCurveTo(582,382,527,422,453,414);d.fill();
  const cx=451,cy=264;
  for(let i=0;i<8;i++){const angle=i*Math.PI/4;d.save();d.translate(cx,cy);d.rotate(angle);d.fillStyle=i%2?'#e99c63':'#ebaa70';d.beginPath();d.ellipse(0,-72,45,73,0,0,Math.PI*2);d.fill();d.restore();}
  d.fillStyle='#6b4936';d.beginPath();d.arc(cx,cy,49,0,Math.PI*2);d.fill();
  d.fillStyle='#b89565';for(let y=-25;y<=25;y+=14)for(let x=-25;x<=25;x+=14)if(x*x+y*y<1050){d.beginPath();d.arc(cx+x,cy+y,2,0,Math.PI*2);d.fill();}
  d.fillStyle='#739dba';d.beginPath();d.moveTo(326,554);d.lineTo(577,554);d.lineTo(551,679);d.quadraticCurveTo(449,716,350,680);d.closePath();d.fill();
  d.fillStyle='#4c7993';d.beginPath();d.roundRect(313,529,277,36,9);d.fill();
  d.strokeStyle='#bcd1d5';d.lineWidth=3;d.beginPath();d.moveTo(364,580);d.lineTo(375,660);d.moveTo(397,581);d.lineTo(403,674);d.moveTo(437,584);d.lineTo(439,678);d.moveTo(477,583);d.lineTo(475,677);d.moveTo(518,581);d.lineTo(509,667);d.stroke();
  commitSource(c,'Exemplo • flor em vaso',true);
}
function createRingDemo() {
  ++state.generation;if(state.pdf)state.pdf.destroy();state.pdf=null;$('pdf-controls').hidden=true;
  const c=document.createElement('canvas');c.width=c.height=600;const d=c.getContext('2d');
  d.fillStyle='#f7f5ed';d.fillRect(0,0,600,600);
  const colors=['#426d84','#cc7249','#557649'];
  for(let i=0;i<16;i++){
    const angle=i*Math.PI*2/16,x=300+190*Math.cos(angle),y=300+190*Math.sin(angle);
    d.save();d.translate(x,y);d.rotate(angle);d.fillStyle=colors[i%3];d.beginPath();
    if(i%3===0)d.arc(0,0,18,0,Math.PI*2);
    else if(i%3===1)d.rect(-17,-17,34,34);
    else {d.moveTo(0,-22);d.lineTo(20,17);d.lineTo(-20,17);d.closePath();}
    d.fill();d.restore();
  }
  commitSource(c,'Exemplo • formas em círculo',true);
  toast('Aumente o deslocamento para unir as 16 formas, ou marque Contorno geral do conjunto.');
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function baseName(){return state.name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/-+$/,'')||'contorno';}
async function exportSettings() {
  await ensureCurrentTrace();
  const width=+$('width-mm').value,stroke=+$('stroke-mm').value;
  if(!Number.isFinite(width) || width<1 || width>2000)throw new Error('A largura deve estar entre 1 e 2.000 mm.');
  if(!Number.isFinite(stroke) || stroke<.05 || stroke>5)throw new Error('A espessura deve estar entre 0,05 e 5 mm.');
  if(!state.paths.length)throw new Error('Nenhum contorno encontrado. Ajuste a seleção antes de exportar.');
  const offset=+$('offset-mm').value;
  if(!$('offset-mm').value || !Number.isFinite(offset) || offset < -20 || offset > 50)throw new Error('O deslocamento deve estar entre −20 e 50 mm.');
  const height=width*state.h/state.w,frame=state.bounds,pageWidth=frame.width*width/state.w,pageHeight=frame.height*width/state.w;
  if(pageWidth>5000 || pageHeight>5000)throw new Error('A altura resultante é muito grande. Diminua a largura.');
  return {width,height,pageWidth,pageHeight,frame,stroke,color:$('stroke-color').value,both:$('export-content').value==='both'};
}
async function exportSVG() {
  try {
    const {width,pageWidth,pageHeight,frame,stroke,color,both}=await exportSettings(),strokePixels=stroke*state.w/width;
    const paths=state.commands.map(c=>`<path d="${toSvgPath(c)}"/>`).join('\n');
    const image=both?`<image href="${state.source.toDataURL('image/png')}" x="0" y="0" width="${state.w}" height="${state.h}"/>`:'';
    const svg=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}mm" height="${pageHeight}mm" viewBox="${frame.minX} ${frame.minY} ${frame.width} ${frame.height}">\n${image}\n<g fill="none" stroke="${color}" stroke-width="${strokePixels}" stroke-linejoin="round" stroke-linecap="round">${paths}</g>\n</svg>`;
    download(new Blob([svg],{type:'image/svg+xml'}),`${baseName()}-contorno.svg`);toast('SVG exportado com contorno vetorial.');
  } catch(error){toast(error.message);}
}
async function exportPDF() {
  try {
    const {width,height,pageWidth,pageHeight,frame,stroke,color,both}=await exportSettings();
    // A stroke-width margin preserves lines on the image boundary without changing the requested image width.
    const margin=stroke,doc=new jsPDF({orientation:pageWidth>pageHeight?'landscape':'portrait',unit:'mm',format:[pageWidth+margin*2,pageHeight+margin*2],compress:true,precision:5});
    const scale=width/state.w,originX=margin-frame.minX*scale,originY=margin-frame.minY*scale;
    if(both)doc.addImage(state.source.toDataURL('image/png'),'PNG',originX,originY,width,height,undefined,'FAST');
    doc.setDrawColor(color);doc.setLineWidth(stroke);doc.setLineJoin('round');doc.setLineCap('round');
    for(const commands of state.commands) {
      const ops=[];let previous=null;
      for(const [op,...v] of commands) {
        if(op==='M' || op==='L'){ops.push({op:op.toLowerCase(),c:[v[0]*scale+originX,v[1]*scale+originY]});previous=v;}
        else if(op==='Q') {
          const [cx,cy,x,y]=v;
          const c1=[previous[0]+2/3*(cx-previous[0]),previous[1]+2/3*(cy-previous[1])],c2=[x+2/3*(cx-x),y+2/3*(cy-y)];
          ops.push({op:'c',c:[c1[0]*scale+originX,c1[1]*scale+originY,c2[0]*scale+originX,c2[1]*scale+originY,x*scale+originX,y*scale+originY]});previous=[x,y];
        } else ops.push({op:'h',c:[]});
      }
      doc.path(ops);doc.stroke();
    }
    doc.setProperties({title:`${state.name} — contorno vetorial`,creator:'Contorno offline'});
    download(doc.output('blob'),`${baseName()}-contorno.pdf`);toast('PDF exportado. O contorno foi preservado como linhas vetoriais.');
  } catch(error){console.error(error);toast(`Não foi possível exportar: ${error.message}`);}
}
$('import').onclick=()=>$('file').click();$('file').onchange=event=>{importFile(event.target.files[0]);event.target.value='';};
$('load-page').onclick=async()=>{if(!state.pdf)return;const generation=++state.generation;try{await loadPDFPage(state.pdf,+$('pdf-page').value,generation);}catch(e){toast(e.message);}};
$('save-app').onclick=()=>{download(new Blob([standaloneHTML],{type:'text/html;charset=utf-8'}),'contorno-offline.html');toast('Aplicativo completo salvo. Abra contorno-offline.html no navegador, mesmo sem internet.');};
$('demo-ring').onclick=createRingDemo;$('demo').onclick=createDemo;$('reset').onclick=()=>resetSettings();
for(const id of ['threshold','noise','close','simplify','smooth','largest','invert','holes'])$(id).addEventListener('input',scheduleTrace);
$('mode').onchange=()=>{$('threshold').value=$('mode').value==='dark'?55:$('mode').value==='alpha'?10:16;scheduleTrace();};
$('pick-background').onclick=()=>setTool(state.tool==='pick'?'view':'pick');
$('auto-background').onclick=()=>{state.background=guessBackground(state.rgba,state.w,state.h);$('background-value').textContent='Automática';scheduleTrace();};
$('points').onchange=draw;$('brush').oninput=updateLabels;
$('stroke-color').oninput=draw;
function changeWidth(input){
  $('width-mm').value=$('image-width-mm').value=input.value;
  const value=Number(input.value);
  if(input.value && Number.isFinite(value) && value>=1 && value<=2000){state.physicalWidth=value;scheduleTrace();}
}
$('width-mm').oninput=event=>changeWidth(event.target);$('image-width-mm').oninput=event=>changeWidth(event.target);
function changeOffset(input){
  const value=Number(input.value);
  if(input.value && Number.isFinite(value) && value>=-20 && value<=50){state.offsetMm=value;$('offset').value=$('offset-mm').value=value;scheduleTrace();}
}
$('offset').oninput=event=>changeOffset(event.target);$('offset-mm').oninput=event=>changeOffset(event.target);
$('offset-zero').onclick=()=>{state.offsetMm=0;$('offset').value=$('offset-mm').value=0;scheduleTrace();};
$('general').onchange=()=>{$('holes').disabled=$('general').checked;scheduleTrace();};
$('export-pdf').onclick=exportPDF;$('export-svg').onclick=exportSVG;
$('undo').onclick=()=>{const previous=state.history.pop();if(previous){editRevision++;state.edits=previous.edits;state.region=previous.region;$('undo').disabled=!state.history.length;updateTrace();}};
$('clear-edits').onclick=()=>{pushHistory();editRevision++;state.edits.fill(0);state.region=null;updateTrace();};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));$('canvas-view-label').textContent=state.view==='mask'?'ÁREA SELECIONADA':state.view==='vector'?'CONTORNO VETORIAL':'PRÉVIA DO RASTREIO';draw();});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('zoom-in').onclick=()=>{state.zoom=Math.min(8,state.zoom*1.25);draw();};$('zoom-out').onclick=()=>{state.zoom=Math.max(.25,state.zoom/1.25);draw();};$('zoom-fit').onclick=()=>{state.zoom=1;state.pan={x:0,y:0};draw();};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
$('canvas-wrap').addEventListener('dragover',event=>event.preventDefault());$('canvas-wrap').addEventListener('drop',event=>{event.preventDefault();importFile(event.dataTransfer.files[0]);});
new ResizeObserver(draw).observe($('canvas-wrap'));
document.addEventListener('keydown',event=>{if(event.key==='Escape')setTool('view');if((event.ctrlKey || event.metaKey) && event.key==='z' && !['INPUT','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('undo').click();}});
createDemo();
