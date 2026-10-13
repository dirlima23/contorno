import ClipperLib from 'clipper-lib';
import { signedArea, simplifyClosed } from './trace.js';
const SCALE=1000;

export function convexEnvelope(paths) {
  const points=paths.filter(p=>signedArea(p)>0).flat().sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const unique=points.filter((p,i)=>!i || p[0]!==points[i-1][0] || p[1]!==points[i-1][1]);
  if(unique.length<3)return [];
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=items=>{const result=[];for(const p of items){while(result.length>=2 && cross(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result;};
  const lower=half(unique),upper=half([...unique].reverse());
  return [[...lower.slice(0,-1),...upper.slice(0,-1)]];
}

export function offsetContours(paths,delta,includeHoles=false) {
  if(!Number.isFinite(delta))throw new Error('Deslocamento inválido.');
  if(!paths.length)return [];
  if(Math.abs(delta)<.0005)return paths.filter(p=>includeHoles || signedArea(p)>0);
  // Closed polygons preserve orientation: outer boundaries expand while holes contract.
  // ClipperOffset unions overlapping expansions, rather than drawing overlapping strokes.
  const offset=new ClipperLib.ClipperOffset(2,Math.max(.002,Math.min(.15,Math.abs(delta)/10))*SCALE);
  const integers=paths.map(p=>simplifyClosed(p,.05).map(([x,y])=>({X:Math.round(x*SCALE),Y:Math.round(y*SCALE)})));
  offset.AddPaths(integers,ClipperLib.JoinType.jtRound,ClipperLib.EndType.etClosedPolygon);
  const result=new ClipperLib.Paths();offset.Execute(result,delta*SCALE);
  return result.map(p=>p.map(({X,Y})=>[X/SCALE,Y/SCALE])).filter(p=>p.length>=3 && (includeHoles || signedArea(p)>0));
}

export function frameBounds(paths,width,height) {
  let minX=0,minY=0,maxX=width,maxY=height;
  for(const path of paths)for(const [x,y] of path){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
