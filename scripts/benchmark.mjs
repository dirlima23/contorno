import {makeMask,closeMask,filterComponents,traceBoundaries,simplifyClosed,pathCommands} from '../src/trace.js';
import {offsetContours} from '../src/geometry.js';
import {TracePipeline} from '../src/pipeline.js';
const width=1400,height=1400,rgba=new Uint8ClampedArray(width*height*4);rgba.fill(255);
for(let n=0;n<96;n++){
  const angle=n*Math.PI*2/96,cx=700+560*Math.cos(angle),cy=700+560*Math.sin(angle);
  for(let y=Math.max(0,Math.floor(cy-12));y<Math.min(height,cy+12);y++)for(let x=Math.max(0,Math.floor(cx-12));x<Math.min(width,cx+12);x++)if((x-cx)**2+(y-cy)**2<144){const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
}
const options={mode:'background',threshold:16,background:[255,255,255],invert:false,region:null,close:0,noise:40,largest:false,holes:false,general:false,offsetPixels:28,simplify:1.5,smooth:25,editRevision:0};
const pipeline=new TracePipeline();pipeline.setSource({rgba,width,height});const cold=pipeline.run(options);
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const full=[],cached=[];
for(let i=0;i<7;i++){
  const t=performance.now();let mask=closeMask(makeMask(rgba,width,height,options),width,height,0);mask=filterComponents(mask,width,height,40,false);
  const raw=traceBoundaries(mask,width,height,false);raw.map(p=>simplifyClosed(p,1));const paths=offsetContours(raw,28).map(p=>simplifyClosed(p,1.5));paths.map(p=>pathCommands(p,30+i));full.push(performance.now()-t);
  const r=pipeline.run({...options,smooth:30+i},null,cold.maskVersion);cached.push(r.stats.computeMs);
  if(r.stats.stages.join(',')!=='curves')throw new Error('Um ajuste de suavização refez etapas anteriores.');
}
console.log(JSON.stringify({fixture:'1400×1400, 96 formas em círculo',scope:'CPU apenas; não inclui comunicação com worker nem desenho da tela',coldMs:cold.stats.computeMs,recomputeEveryStageMedianMs:median(full),cachedSmoothingMedianMs:median(cached)},null,2));
