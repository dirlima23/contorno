import { makeMask, closeMask, filterComponents, traceBoundaries, simplifyClosed, pathCommands, signedArea } from './trace.js';
import { offsetContours, convexEnvelope, frameBounds } from './geometry.js';

// Each stage retains one result. Changing a downstream control never invalidates
// source pixels or the more expensive segmentation and boundary extraction.
export class TracePipeline {
  constructor(){this.cache={};this.maskVersion=0;this.curveVersion=0;}
  setSource({rgba,width,height}){this.rgba=rgba;this.w=width;this.h=height;this.edits=new Int8Array(width*height);this.cache={};this.maskVersion=0;this.curveVersion=0;}
  run(options,edits=null,consumerMaskVersion=-1){
    if(!this.rgba)throw new Error('Imagem não carregada.');
    if(edits)this.edits=edits;
    const totalStart=performance.now(),stages=[],timings={},cache=this.cache;
    const stage=(name,key,compute)=>{
      if(cache[name]?.key===key)return cache[name].value;
      const start=performance.now(),value=compute();timings[name]=performance.now()-start;stages.push(name);cache[name]={key,value};return value;
    };
    const {mode,threshold,background,invert,region,close,editRevision,noise,largest,holes,general,offsetPixels,simplify,smooth}=options;
    const segmentationKey=JSON.stringify([mode,threshold,background,invert,region,close,editRevision]);
    const segmented=stage('selection',segmentationKey,()=>{
      const mask=closeMask(makeMask(this.rgba,this.w,this.h,{mode,threshold,background,invert,region}),this.w,this.h,close);
      for(let i=0;i<mask.length;i++){
        if(this.edits[i])mask[i]=this.edits[i]>0?1:0;
        if(region){const x=i%this.w,y=Math.floor(i/this.w);if(x<region.x || y<region.y || x>=region.x+region.w || y>=region.y+region.h)mask[i]=0;}
      }
      return mask;
    });
    const filterKey=JSON.stringify([segmentationKey,noise,largest]);
    const mask=stage('components',filterKey,()=>{this.maskVersion++;return filterComponents(segmented,this.w,this.h,noise,largest);});
    const raw=stage('boundaries',filterKey,()=>traceBoundaries(mask,this.w,this.h,true));
    const originalPaths=stage('original',filterKey,()=>raw.filter(p=>signedArea(p)>0).map(p=>simplifyClosed(p,1)));
    const includeHoles=holes && !general;
    const baseKey=JSON.stringify([filterKey,includeHoles,general]);
    const base=stage('envelope',baseKey,()=>general?convexEnvelope(raw):raw.filter(p=>includeHoles || signedArea(p)>0));
    const offsetKey=JSON.stringify([baseKey,offsetPixels]);
    const shifted=stage('offset',offsetKey,()=>offsetContours(base,offsetPixels,includeHoles));
    const simplifyKey=JSON.stringify([offsetKey,simplify]);
    const paths=stage('simplification',simplifyKey,()=>shifted.map(p=>simplifyClosed(p,simplify)));
    const bounds=stage('bounds',simplifyKey,()=>frameBounds(paths,this.w,this.h));
    const commands=stage('curves',JSON.stringify([simplifyKey,smooth]),()=>{this.curveVersion++;return paths.map(p=>pathCommands(p,smooth));});
    let maskRGBA=null;
    if(consumerMaskVersion!==this.maskVersion){
      const rgba=stage('preview',filterKey,()=>{
        const pixels=new Uint8ClampedArray(mask.length*4);
        for(let i=0;i<mask.length;i++)if(mask[i]){const p=i*4;pixels[p]=51;pixels[p+1]=167;pixels[p+2]=108;pixels[p+3]=120;}
        return pixels;
      });
      maskRGBA=rgba.slice();
    }
    return {paths,bounds,commands,originalPaths,rawPoints:shifted.reduce((n,p)=>n+p.length,0),maskRGBA,maskVersion:this.maskVersion,curveVersion:this.curveVersion,stats:{stages,timings,computeMs:performance.now()-totalStart}};
  }
}
