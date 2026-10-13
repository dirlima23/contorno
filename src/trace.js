export function guessBackground(rgba, width, height) {
  const channels = [[], [], []];
  const size = Math.max(1, Math.min(12, Math.floor(Math.min(width, height) / 20)));
  for (const [ox, oy] of [[0,0],[width-size,0],[0,height-size],[width-size,height-size]]) {
    for (let y=oy;y<oy+size;y++) for(let x=ox;x<ox+size;x++) {
      const i=(y*width+x)*4;
      if(rgba[i+3]>128) for(let c=0;c<3;c++) channels[c].push(rgba[i+c]);
    }
  }
  return channels.map(c=>c.length ? c.sort((a,b)=>a-b)[Math.floor(c.length/2)] : 255);
}

export function makeMask(rgba, width, height, options) {
  const mask = new Uint8Array(width*height);
  const { mode, threshold, background, invert, region } = options;
  const limit = threshold/100, distanceLimitSq=limit*limit*255*255*3;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=y*width+x, i=p*4;
    if(region && (x<region.x || y<region.y || x>=region.x+region.w || y>=region.y+region.h)) continue;
    const alpha=rgba[i+3]/255;
    let selected;
    if(mode==='alpha') selected=alpha>limit;
    else if(mode==='dark') selected=(.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2])/255<=limit;
    else {const dr=rgba[i]-background[0],dg=rgba[i+1]-background[1],db=rgba[i+2]-background[2];selected=dr*dr+dg*dg+db*db>distanceLimitSq;}
    mask[p]=alpha>0.02 && (invert ? !selected : selected) ? 1 : 0;
  }
  return mask;
}

function morphology(mask,w,h,r,erode) {
  function pass(input,width,height,horizontal) {
    const out=new Uint8Array(input.length);
    const lines=horizontal?height:width, length=horizontal?width:height;
    for(let line=0;line<lines;line++) {
      const index=t=>horizontal?line*width+t:t*width+line;
      let sum=0;
      for(let t=0;t<=Math.min(r,length-1);t++) sum+=input[index(t)];
      for(let t=0;t<length;t++) {
        const count=Math.min(length-1,t+r)-Math.max(0,t-r)+1;
        out[index(t)]=erode ? +(sum===count) : +(sum>0);
        if(t-r>=0) sum-=input[index(t-r)];
        if(t+r+1<length) sum+=input[index(t+r+1)];
      }
    }
    return out;
  }
  return pass(pass(mask,w,h,true),w,h,false);
}
export function closeMask(mask,w,h,r) { return r>0 ? morphology(morphology(mask,w,h,r,false),w,h,r,true) : mask; }

export function filterComponents(mask,w,h,minArea,largestOnly) {
  const length=mask.length,visited=new Uint8Array(length),queue=new Int32Array(length),out=new Uint8Array(length);
  let largest=null;
  for(let start=0;start<length;start++) {
    if(!mask[start] || visited[start])continue;
    let head=0,tail=1;queue[0]=start;visited[start]=1;
    while(head<tail){
      const p=queue[head++],x=p%w;
      // Avoid allocating a four-element array for every selected pixel.
      let q=p-1;if(x>0 && mask[q] && !visited[q]){visited[q]=1;queue[tail++]=q;}
      q=p+1;if(x<w-1 && mask[q] && !visited[q]){visited[q]=1;queue[tail++]=q;}
      q=p-w;if(p>=w && mask[q] && !visited[q]){visited[q]=1;queue[tail++]=q;}
      q=p+w;if(q<length && mask[q] && !visited[q]){visited[q]=1;queue[tail++]=q;}
    }
    if(tail<minArea)continue;
    if(largestOnly){if(!largest || tail>=largest.length)largest=queue.slice(0,tail);}
    else for(let i=0;i<tail;i++)out[queue[i]]=1;
  }
  if(largest)for(const p of largest)out[p]=1;
  return out;
}

export function signedArea(points) {
  let area=0;
  for(let i=0;i<points.length;i++) {const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}
  return area/2;
}
export function traceBoundaries(mask,w,h,includeHoles=false) {
  const stride=w+1,edges=new Map();
  const add=(a,b)=>{if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);};
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const p=y*w+x;if(!mask[p])continue;
    const a=y*stride+x,b=a+1,c=b+stride,d=a+stride;
    if(y===0 || !mask[p-w])add(a,b);
    if(x===w-1 || !mask[p+1])add(b,c);
    if(y===h-1 || !mask[p+w])add(c,d);
    if(x===0 || !mask[p-1])add(d,a);
  }
  const paths=[];
  while(edges.size) {
    const start=edges.keys().next().value,points=[];
    let current=start,previous=null;
    do {
      points.push([current%stride,Math.floor(current/stride)]);
      const nexts=edges.get(current);if(!nexts?.length)break;
      let pick=0;
      if(nexts.length>1 && previous!==null) {
        const dx=current%stride-previous%stride,dy=Math.floor(current/stride)-Math.floor(previous/stride);
        let best=-Infinity;
        nexts.forEach((n,i)=>{const nx=n%stride-current%stride,ny=Math.floor(n/stride)-Math.floor(current/stride);const score=dx*ny-dy*nx; if(score>best){best=score;pick=i;}});
      }
      const next=nexts.splice(pick,1)[0];if(!nexts.length)edges.delete(current);
      previous=current;current=next;
    } while(current!==start);
    if(points.length>=3 && (includeHoles || signedArea(points)>0)) paths.push(points);
  }
  return paths;
}
function distanceSq(p,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
  return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
}
function rdp(points,tolerance) {
  if(points.length<3)return points;
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while(stack.length) {
    const [first,last]=stack.pop();let max=tolerance*tolerance,index=-1;
    for(let i=first+1;i<last;i++){const d=distanceSq(points[i],points[first],points[last]);if(d>max){max=d;index=i;}}
    if(index>=0){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return points.filter((_,i)=>keep[i]);
}
export function simplifyClosed(points,tolerance) {
  if(points.length<4)return points;
  let farthest=1,max=0;
  for(let i=1;i<points.length;i++){const d=(points[i][0]-points[0][0])**2+(points[i][1]-points[0][1])**2;if(d>max){max=d;farthest=i;}}
  const first=rdp(points.slice(0,farthest+1),tolerance), second=rdp([...points.slice(farthest),points[0]],tolerance);
  const result=[...first.slice(0,-1),...second.slice(0,-1)];
  return result.length>=3?result:points;
}
export function pathCommands(points,smooth=0) {
  const f=smooth/100*.5,commands=[];
  if(!f)return [['M',...points[0]],...points.slice(1).map(p=>['L',...p]),['Z']];
  for(let i=0;i<points.length;i++) {
    const prev=points[(i+points.length-1)%points.length],p=points[i],next=points[(i+1)%points.length];
    const entry=[p[0]+(prev[0]-p[0])*f,p[1]+(prev[1]-p[1])*f],exit=[p[0]+(next[0]-p[0])*f,p[1]+(next[1]-p[1])*f];
    commands.push([i===0?'M':'L',...entry],['Q',...p,...exit]);
  }
  return [...commands,['Z']];
}
export function toSvgPath(commands) {return commands.map(c=>c[0]+c.slice(1).map(n=>+n.toFixed(3)).join(' ')).join(' ');}
