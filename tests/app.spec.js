import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { makeMask, guessBackground, traceBoundaries, signedArea, simplifyClosed, closeMask, filterComponents } from '../src/trace.js';
const html=await readFile('index.html','utf8');
async function start(page) {
  await page.context().setOffline(true);
  // The managed Chromium blocks file:// navigation. Load the exact standalone document
  // with networking disabled, so no resource can be supplied by a server.
  await page.setContent(html, {waitUntil:'load'});
  await expect(page.locator('#path-count')).toHaveText('1 contorno');
}
async function svg(page,text,name='forma.svg') {await page.locator('#file').setInputFiles({name,mimeType:'image/svg+xml',buffer:Buffer.from(text)});await expect(page.locator('#filename')).toHaveText(name);}
async function range(page,id,value){await page.locator('#'+id).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));await expect(page.locator('#processing-status')).toContainText('Rastreio em');}
function streams(buffer){const text=buffer.toString('latin1');return [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m=>{try{return inflateSync(Buffer.from(m[1],'latin1')).toString('latin1');}catch{return m[1];}}).join('\n');}

test('trace: external boundaries, holes, corners, noise and simplification',()=>{
  const w=10,h=10,mask=new Uint8Array(w*h);
  for(let y=1;y<9;y++)for(let x=1;x<9;x++)mask[y*w+x]=1;
  for(let y=3;y<7;y++)for(let x=3;x<7;x++)mask[y*w+x]=0;
  const outer=traceBoundaries(mask,w,h);expect(outer).toHaveLength(1);expect(signedArea(outer[0])).toBe(64);
  expect(traceBoundaries(mask,w,h,true)).toHaveLength(2);expect(simplifyClosed(outer[0],.1)).toHaveLength(4);
  const diagonal=new Uint8Array([1,0,0,1]);expect(traceBoundaries(diagonal,2,2)).toHaveLength(2);
  const touching=new Uint8Array([1,1,1,1]);expect(signedArea(traceBoundaries(touching,2,2)[0])).toBe(4);
  const noisy=new Uint8Array([1,0,0,0,1,1]);expect([...filterComponents(noisy,3,2,2,false)]).toEqual([0,0,0,0,1,1]);
  const gap=new Uint8Array([1,1,0,1,1]);expect([...closeMask(gap,5,1,1)]).toEqual([1,1,1,1,1]);
});

test('mask: background, luminosity, alpha, inversion and off-center ROI',()=>{
  const data=new Uint8ClampedArray([255,255,255,255,0,0,0,255,255,0,0,0,255,255,255,255]);
  const opts={mode:'background',threshold:10,background:[255,255,255],invert:false,region:null};
  expect([...makeMask(data,4,1,opts)]).toEqual([0,1,0,0]);
  expect([...makeMask(data,4,1,{...opts,mode:'dark',threshold:50})]).toEqual([0,1,0,0]);
  expect([...makeMask(data,4,1,{...opts,mode:'alpha'})]).toEqual([1,1,0,1]);
  expect([...makeMask(data,4,1,{...opts,invert:true})]).toEqual([1,0,0,1]);
  expect([...makeMask(data,4,1,{...opts,region:{x:2,y:0,w:2,h:1}})]).toEqual([0,0,0,0]);
  expect(guessBackground(data,4,1)).toEqual([255,255,255]);
});

test('standalone app runs offline, updates live and exports actual vector PDF and SVG',async({page})=>{
  const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await start(page);
  await page.screenshot({path:'test-results/contorno-desktop.png',fullPage:true});
  await range(page,'simplify',5);await expect(page.locator('#simplify-value')).toHaveText('5 px');
  await page.getByRole('button',{name:'Vetor',exact:true}).click();await page.locator('#points').check();
  await page.locator('#export-content').selectOption('vector');
  const pdfDownload=page.waitForEvent('download');await page.locator('#export-pdf').click();const pdf=await pdfDownload;
  const bytes=await readFile(await pdf.path());expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).not.toContain('/Subtype /Image');expect(streams(bytes)).toMatch(/\bc\b/);expect(streams(bytes)).toMatch(/\bS\b/);
  const svgDownload=page.waitForEvent('download');await page.locator('#export-svg').click();const s=await readFile(await (await svgDownload).path(),'utf8');expect(s).toContain('<path d=');expect(s).not.toContain('<image ');expect(s).toContain('Q');
  await page.locator('#export-content').selectOption('both');const bothDownload=page.waitForEvent('download');await page.locator('#export-pdf').click();const both=await readFile(await(await bothDownload).path());expect(both.toString('latin1')).toContain('/Subtype /Image');expect(streams(both)).toMatch(/\bc\b/);
  expect(errors).toEqual([]);expect(network).toEqual([]);
});

test('imports corner-positioned SVG, detects separated shapes and controls largest/noise',async({page})=>{
  await start(page);
  await svg(page,'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="white"/><rect x="8" y="20" width="60" height="80" fill="black"/><circle cx="260" cy="180" r="45" fill="black"/><rect x="300" y="20" width="2" height="2" fill="black"/></svg>');
  await expect(page.locator('#path-count')).toHaveText('2 contornos');
  await page.locator('#largest').check();await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.locator('#largest').uncheck();await range(page,'noise',1);await expect(page.locator('#path-count')).toHaveText('3 contornos');
  await page.locator('#mode').selectOption('dark');await expect(page.locator('#path-count')).toHaveText('3 contornos');
  await range(page,'threshold',100);await expect(page.locator('#path-count')).toHaveText('1 contorno');
});

test('imports transparent PNG, paint/erase/undo and ROI work',async({page})=>{
  await start(page);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(10,20,50,80);ctx.fillRect(130,110,40,40);return c.toDataURL().split(',')[1];});
  await page.locator('#file').setInputFiles({name:'transparente.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#filename')).toHaveText('transparente.png');await expect(page.locator('#mode')).toHaveValue('alpha');await expect(page.locator('#path-count')).toHaveText('2 contornos');
  // Work coordinates are displayed with a centered fit: the image is 200×200, with a 410px vertical workspace fit.
  const r=await page.locator('#canvas').boundingBox(),scale=Math.min((r.width-70)/200,(r.height-100)/200),ox=r.x+(r.width-200*scale)/2,oy=r.y+(r.height-200*scale)/2;
  await page.locator('[data-tool="region"]').click();await page.mouse.move(ox+5*scale,oy+10*scale);await page.mouse.down();await page.mouse.move(ox+80*scale,oy+105*scale);await page.mouse.up();await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.locator('#undo').click();await expect(page.locator('#path-count')).toHaveText('2 contornos');
  await page.locator('[data-tool="erase"]').click();await range(page,'brush',80);await page.mouse.click(ox+150*scale,oy+130*scale);await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.locator('#undo').click();await expect(page.locator('#path-count')).toHaveText('2 contornos');
  await page.locator('[data-tool="add"]').click();await range(page,'brush',15);await page.mouse.click(ox+100*scale,oy+170*scale);await expect(page.locator('#path-count')).toHaveText('3 contornos');
});

test('offline PDF worker renders pages and rejects invalid page',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  const pdf=new jsPDF({unit:'mm',format:[100,100]});pdf.setFillColor('#000000');pdf.rect(20,20,40,40,'F');pdf.addPage([100,100]);pdf.circle(50,50,25,'F');
  await page.locator('#file').setInputFiles({name:'duas-paginas.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf.output('arraybuffer'))});
  await expect(page.locator('#filename')).toHaveText('duas-paginas.pdf · página 1');await expect(page.locator('#path-count')).toHaveText('1 contorno');await expect(page.locator('#pdf-pages')).toHaveText('de 2');
  await page.locator('#pdf-page').fill('2');await page.locator('#load-page').click();await expect(page.locator('#filename')).toHaveText('duas-paginas.pdf · página 2');await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.locator('#pdf-page').fill('3');await page.locator('#load-page').click();await expect(page.locator('#toast')).toContainText('Escolha uma página de 1 a 2');
  expect(errors).toEqual([]);
});

test('SVG external content removed, empty selection disables export, mobile fits',async({page})=>{
  await start(page);const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await svg(page,'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script><image href="https://example.com/private.png" width="200" height="200"/><rect x="30" y="30" width="70" height="70" fill="black"/></svg>','seguro.svg');
  await expect(page.locator('#path-count')).toHaveText('1 contorno');expect(requests).toEqual([]);
  await page.locator('#mode').selectOption('alpha');await range(page,'threshold',100);await expect(page.locator('#path-count')).toHaveText('0 contornos');await expect(page.locator('#export-pdf')).toBeDisabled();
  await page.setViewportSize({width:390,height:844});await page.locator('#demo').click();await expect(page.locator('#path-count')).toHaveText('1 contorno');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/contorno-mobile.png',fullPage:true});
});

test('offset: exact distance, overlapping union, contraction, holes and convex envelope',async()=>{
  const {offsetContours,convexEnvelope,frameBounds}=await import('../src/geometry.js');
  const rect=[[0,0],[10,0],[10,10],[0,10]],second=rect.map(([x,y])=>[x+14,y]);
  expect(offsetContours([rect,second],0)).toHaveLength(2);
  expect(offsetContours([rect,second],1)).toHaveLength(2);
  expect(offsetContours([rect,second],3)).toHaveLength(1);
  const expanded=frameBounds(offsetContours([rect],2),10,10);expect(expanded.minX).toBeCloseTo(-2,2);expect(expanded.maxX).toBeCloseTo(12,2);
  const shrunk=offsetContours([rect],-2);expect(Math.min(...shrunk[0].map(p=>p[0]))).toBeCloseTo(2);expect(Math.max(...shrunk[0].map(p=>p[0]))).toBeCloseTo(8);
  expect(offsetContours([rect],-6)).toHaveLength(0);
  const hole=[[3,3],[3,7],[7,7],[7,3]];expect(offsetContours([rect,hole],1,true)).toHaveLength(2);expect(offsetContours([rect,hole],3,true)).toHaveLength(1);
  const envelope=convexEnvelope([rect,second]);expect(envelope).toHaveLength(1);expect(signedArea(envelope[0])).toBe(240);
});

async function downloadedSVG(page){const pending=page.waitForEvent('download');await page.locator('#export-svg').click();return readFile(await(await pending).path(),'utf8');}
function svgNumbers(text){const d=text.match(/<path d="([^"]+)"/)[1];return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>+m[0]);}

test('millimeter offset merges circular arrangement and general outline wraps the set',async({page})=>{
  await start(page);await page.locator('#demo-ring').click();await expect(page.locator('#path-count')).toHaveText('16 contornos');
  await range(page,'offset',1);await expect(page.locator('#path-count')).toHaveText('16 contornos');
  await range(page,'offset',12);await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.locator('#offset-zero').click();await expect(page.locator('#path-count')).toHaveText('16 contornos');
  await page.locator('#general').check();await expect(page.locator('#path-count')).toHaveText('1 contorno');await expect(page.locator('#holes')).toBeDisabled();
  await page.locator('#general').uncheck();await expect(page.locator('#path-count')).toHaveText('16 contornos');
});

test('physical width calibrates offsets, exports preserve overflow and negative offsets vanish',async({page})=>{
  await start(page);
  await svg(page,'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="0" y="0" width="40" height="40" fill="black"/></svg>');
  await page.locator('#image-width-mm').fill('100');await expect(page.locator('#width-mm')).toHaveValue('100');
  await range(page,'smooth',0);await range(page,'simplify',0);await range(page,'offset',5);await expect(page.locator('#offset-mm')).toHaveValue('5');
  await page.locator('#export-content').selectOption('vector');const first=await downloadedSVG(page);
  expect(first).toContain('viewBox="-10 -10 210 210"');expect(first).toContain('width="105mm"');expect(Math.min(...svgNumbers(first))).toBeCloseTo(-10,1);
  await page.locator('#width-mm').fill('200');await expect(page.locator('#image-width-mm')).toHaveValue('200');const second=await downloadedSVG(page);expect(second).toContain('viewBox="-5 -5 205 205"');expect(second).toContain('width="205mm"');
  const pending=page.waitForEvent('download');await page.locator('#export-pdf').click();const pdf=await readFile(await(await pending).path());
  const box=pdf.toString('latin1').match(/\/MediaBox \[([^\]]+)\]/)[1].trim().split(/\s+/).map(Number);expect(box[2]/(72/25.4)).toBeCloseTo(205.6,2);expect(box[3]/(72/25.4)).toBeCloseTo(205.6,2);
  const ops=streams(pdf),coordinates=[...ops.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) [ml]/g)];expect(coordinates.length).toBeGreaterThan(0);expect(coordinates.every(m=>+m[1]>=0 && +m[2]>=0)).toBe(true);
  await range(page,'offset',-20);await expect(page.locator('#path-count')).toHaveText('0 contornos');await expect(page.locator('#export-pdf')).toBeDisabled();
});

test('Save app offline downloads a complete reusable application without imported data',async({page})=>{
  await start(page);await svg(page,'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>','nome-privado.svg');
  const pending=page.waitForEvent('download');await page.locator('#save-app').click();const download=await pending;expect(download.suggestedFilename()).toBe('contorno-offline.html');
  const saved=await readFile(await download.path(),'utf8');expect(saved).toContain('id="offset"');expect(saved).not.toContain('nome-privado.svg');
  const reopened=await page.context().newPage();const errors=[];reopened.on('pageerror',e=>errors.push(e.message));await reopened.setContent(saved);await expect(reopened.locator('#path-count')).toHaveText('1 contorno');await reopened.locator('#demo-ring').click();await expect(reopened.locator('#path-count')).toHaveText('16 contornos');await range(reopened,'offset',12);await expect(reopened.locator('#path-count')).toHaveText('1 contorno');
  // The saved file must retain its bundled PDF worker, not an expired blob URL.
  const pdf=new jsPDF();pdf.rect(20,20,30,30,'F');await reopened.locator('#file').setInputFiles({name:'offline.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf.output('arraybuffer'))});await expect(reopened.locator('#filename')).toHaveText('offline.pdf · página 1');expect(errors).toEqual([]);await reopened.close();
});
