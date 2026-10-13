import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {TracePipeline} from '../src/pipeline.js';
import {makeMask,closeMask,filterComponents,traceBoundaries,simplifyClosed,pathCommands} from '../src/trace.js';
import {convexEnvelope,offsetContours} from '../src/geometry.js';
const html=await readFile('index.html','utf8');
function fixture(){
  const width=100,height=100,rgba=new Uint8ClampedArray(width*height*4);rgba.fill(255);
  for(let y=10;y<55;y++)for(let x=10;x<55;x++)if(!(x>=25 && x<40 && y>=25 && y<40)){const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  for(let y=65;y<85;y++)for(let x=65;x<85;x++){const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;}
  return {rgba,width,height};
}
const options={mode:'background',threshold:16,background:[255,255,255],invert:false,region:null,close:0,editRevision:0,noise:1,largest:false,holes:false,general:false,offsetPixels:0,simplify:1.5,smooth:25};

test('pipeline retains exact geometry and invalidates only dependent stages',()=>{
  const source=fixture(),pipeline=new TracePipeline();pipeline.setSource(source);let result=pipeline.run(options);
  const assertMatches=opts=>{
    let mask=closeMask(makeMask(source.rgba,source.width,source.height,opts),source.width,source.height,opts.close);
    mask=filterComponents(mask,source.width,source.height,opts.noise,opts.largest);
    const raw=traceBoundaries(mask,source.width,source.height,opts.holes && !opts.general);
    const base=opts.general?convexEnvelope(raw):raw;
    const paths=offsetContours(base,opts.offsetPixels,opts.holes && !opts.general).map(p=>simplifyClosed(p,opts.simplify));
    const actual=pipeline.run(opts,null,result.maskVersion);
    expect(actual.paths).toEqual(paths);expect(actual.commands).toEqual(paths.map(p=>pathCommands(p,opts.smooth)));result=actual;return actual;
  };
  expect(assertMatches(options).stats.stages).toEqual([]);
  expect(assertMatches({...options,smooth:80}).stats.stages).toEqual(['curves']);
  let actual=assertMatches({...options,smooth:80,simplify:3});expect(actual.stats.stages).toEqual(['simplification','bounds','curves']);expect(actual.maskRGBA).toBeNull();
  actual=assertMatches({...options,offsetPixels:2});expect(actual.stats.stages).not.toContain('boundaries');expect(actual.stats.stages).not.toContain('components');
  assertMatches({...options,holes:true,offsetPixels:1});assertMatches({...options,general:true,offsetPixels:1});
  actual=assertMatches({...options,noise:10000});expect(actual.paths).toHaveLength(0);expect(actual.stats.stages).toContain('components');expect(actual.stats.stages).not.toContain('selection');
  actual=assertMatches({...options,mode:'dark',threshold:40});expect(actual.stats.stages).toContain('selection');
});

test('edit buffers, consumer mask acknowledgements and new sources cannot reuse stale masks',()=>{
  const source=fixture(),pipeline=new TracePipeline();pipeline.setSource(source);
  const first=pipeline.run(options),edits=new Int8Array(source.width*source.height);edits.fill(-1);
  const erased=pipeline.run({...options,editRevision:1},edits,first.maskVersion);expect(erased.paths).toHaveLength(0);
  expect(erased.maskRGBA).not.toBeNull();
  const missed=pipeline.run({...options,editRevision:1,smooth:50},null,first.maskVersion);expect(missed.maskRGBA).not.toBeNull();expect(missed.maskRGBA.every(n=>n===0)).toBe(true);
  const acked=pipeline.run({...options,editRevision:1,smooth:60},null,missed.maskVersion);expect(acked.maskRGBA).toBeNull();
  pipeline.setSource(source);const reset=pipeline.run(options);expect(reset.paths).toHaveLength(2);
});

test('offline app uses the worker, reuses stages and exports the last rapid change',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.context().setOffline(true);await page.setContent(html);
  await expect(page.locator('#processing-status')).toHaveAttribute('data-execution','worker');
  const set=async(id,v)=>{await page.locator('#'+id).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(v));await expect(page.locator('#processing-status')).toContainText('Rastreio em');};
  await set('smooth',90);expect(JSON.parse(await page.locator('#processing-status').getAttribute('data-stages'))).toEqual(['curves']);
  await set('simplify',3);expect(JSON.parse(await page.locator('#processing-status').getAttribute('data-stages'))).toEqual(['simplification','bounds','curves']);
  await page.locator('#export-content').selectOption('vector');
  const pending=page.waitForEvent('download');
  await page.evaluate(()=>{
    const smooth=document.getElementById('smooth');for(const value of [20,70,0]){smooth.value=value;smooth.dispatchEvent(new Event('input',{bubbles:true}));}
    document.getElementById('export-svg').click();
  });
  const text=await readFile(await(await pending).path(),'utf8');expect(text).toContain('<path d=');expect(text.match(/<path d="([^"]+)"/)[1]).not.toContain('Q');
  // A source change while a pending recalculation is active must leave only the new source.
  await page.locator('#demo-ring').click();await page.locator('#demo').click();await expect(page.locator('#filename')).toHaveText('Exemplo • flor em vaso');await expect(page.locator('#path-count')).toHaveText('1 contorno');
  expect(errors).toEqual([]);
});

test('worker queue remains bounded and CPU work does not block the interface',async({page})=>{
  await page.context().setOffline(true);
  const bundle=await build({stdin:{contents:"import {TraceRunner} from './src/trace-runner.js';window.TestRunner=TraceRunner;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'es2022'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
    const source=`self.onmessage=({data})=>{const end=performance.now()+300;while(performance.now()<end){}self.postMessage({id:data.id,result:{value:data.options.offsetPixels}});};`;
    const runner=new window.TestRunner(source);runner.setSource({rgba:new Uint8ClampedArray([0,0,0,255]),width:1,height:1});
    const edits=new Int8Array(1),jobs=[];let starts=0;
    const dispatch=runner.dispatch.bind(runner);runner.dispatch=()=>{if(!runner.active && runner.pending)starts++;dispatch();};
    for(let i=0;i<30;i++)jobs.push(runner.request({offsetPixels:i,editRevision:0},edits,-1));
    const start=performance.now();await new Promise(resolve=>setTimeout(resolve,30));const timerDelay=performance.now()-start;
    const values=await Promise.all(jobs);runner.worker?.terminate();return {timerDelay,starts,values:values.map(v=>v.value),execution:values[0].execution};
  });
  expect(result.execution).toBe('worker');expect(result.timerDelay).toBeLessThan(200);expect(result.starts).toBe(2);expect(result.values).toEqual(Array(30).fill(29));
});

test('blocked workers retain functionality through the cached fallback',async({page})=>{
  await page.context().setOffline(true);await page.addInitScript(()=>{window.Worker=class {constructor(){throw new Error('Worker bloqueado para este teste');}};});
  await page.goto('about:blank');await page.setContent(html);
  await expect(page.locator('#path-count')).toHaveText('1 contorno');await expect(page.locator('#processing-status')).toHaveAttribute('data-execution','fallback');
  await page.locator('#smooth').evaluate(el=>{el.value=80;el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#processing-status')).toContainText('Rastreio em');expect(JSON.parse(await page.locator('#processing-status').getAttribute('data-stages'))).toEqual(['curves']);
});
