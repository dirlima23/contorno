import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const html=await readFile('index.html','utf8');
let server,url;
test.beforeAll(async()=>{
  server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
async function open(page){await page.context().setOffline(true);await page.setContent(html);await expect(page.locator('#path-count')).toHaveText('1 contorno');}

test('Ctrl+V imports a PNG from the real browser clipboard while offline',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.goto(url);await expect(page.locator('#path-count')).toHaveText('1 contorno');await context.setOffline(true);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=160;const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(30,20,100,100);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
  });
  await page.keyboard.press('Control+V');await expect(page.locator('#filename')).toHaveText('Imagem colada.png');await expect(page.locator('#dimensions')).toContainText('200 × 160 px');await expect(page.locator('#path-count')).toHaveText('1 contorno');await expect(page.locator('#mode')).toHaveValue('alpha');expect(errors).toEqual([]);
});

test('image paste also works through file payloads; text paste is not intercepted',async({page})=>{
  await open(page);
  const textAllowed=await page.evaluate(()=>{
    const transfer=new DataTransfer();transfer.setData('text/plain','150');const input=document.getElementById('width-mm');input.focus();
    return input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  });expect(textAllowed).toBe(true);await expect(page.locator('#filename')).toHaveText('Exemplo • flor em vaso');
  const intercepted=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(10,10,60,60);
    const png=await new Promise(resolve=>canvas.toBlob(resolve));const file=new File([png],'captura.png',{type:'image/png'});
    const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[],files:[file]}});return !document.dispatchEvent(event);
  });expect(intercepted).toBe(true);await expect(page.locator('#filename')).toHaveText('captura.png');await expect(page.locator('#path-count')).toHaveText('1 contorno');
});

async function redBounds(page){return page.locator('#canvas').evaluate(canvas=>{
  const ctx=canvas.getContext('2d'),{data}=ctx.getImageData(0,0,canvas.width,canvas.height);let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(data[i]>170 && data[i+1]<120 && data[i+2]<170){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  return {left,right,top,bottom};
});}

test('mouse wheel zoom anchors the cursor, prevents preview scroll and retains geometry',async({page})=>{
  await open(page);
  await page.locator('#file').setInputFiles({name:'zoom.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="50" y="50" width="100" height="100" fill="black"/></svg>')});
  await expect(page.locator('#filename')).toHaveText('zoom.svg');await expect(page.locator('#processing-status')).toContainText('Rastreio em');
  await page.locator('#smooth').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#processing-status')).toContainText('Rastreio em');
  const r=await page.locator('#canvas').boundingBox(),before=await redBounds(page),status=await page.locator('#processing-status').textContent();
  const scale=Math.min((r.width-70)/200,(r.height-100)/200),ox=r.x+(r.width-200*scale)/2,oy=r.y+(r.height-200*scale)/2;
  await page.mouse.move(ox+50*scale,oy+75*scale);await page.mouse.wheel(0,-112);await expect(page.locator('#zoom-value')).toHaveText('125%');
  const after=await redBounds(page);expect(Math.abs(after.left-before.left)).toBeLessThanOrEqual(1);expect(Math.abs((after.right-after.left)/(before.right-before.left)-1.25)).toBeLessThan(.03);
  expect(await page.evaluate(()=>scrollY)).toBe(0);expect(await page.locator('#processing-status').textContent()).toBe(status);await expect(page.locator('#width-mm')).toHaveValue('150');await expect(page.locator('#path-count')).toHaveText('1 contorno');
  await page.mouse.wheel(0,112);await expect(page.locator('#zoom-value')).toHaveText('100%');const restored=await redBounds(page);expect(Math.abs(restored.left-before.left)).toBeLessThanOrEqual(1);
  await page.locator('#canvas').evaluate(canvas=>{for(let i=0;i<20;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,bubbles:true,cancelable:true}));});await expect(page.locator('#zoom-value')).toHaveText('800%');
  await page.locator('#canvas').evaluate(canvas=>{for(let i=0;i<20;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:300,bubbles:true,cancelable:true}));});await expect(page.locator('#zoom-value')).toHaveText('25%');
  await page.locator('#zoom-fit').click();await expect(page.locator('#zoom-value')).toHaveText('100%');
  await page.mouse.move(100,200);await page.mouse.wheel(0,300);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
});

test('keyboard plus/minus and numpad zoom, leaving fields and browser shortcuts alone',async({page})=>{
  await open(page);await page.keyboard.press('+');await expect(page.locator('#zoom-value')).toHaveText('125%');await page.keyboard.press('-');await expect(page.locator('#zoom-value')).toHaveText('100%');
  await page.keyboard.press('NumpadAdd');await expect(page.locator('#zoom-value')).toHaveText('125%');await page.keyboard.press('NumpadSubtract');await expect(page.locator('#zoom-value')).toHaveText('100%');
  await page.keyboard.press('=');await expect(page.locator('#zoom-value')).toHaveText('125%');
  await page.locator('#width-mm').focus();await page.keyboard.press('-');await expect(page.locator('#zoom-value')).toHaveText('125%');
  const browserShortcutAllowed=await page.evaluate(()=>{
    document.getElementById('width-mm').blur();return document.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,bubbles:true,cancelable:true}));
  });expect(browserShortcutAllowed).toBe(true);await expect(page.locator('#zoom-value')).toHaveText('125%');
  await page.locator('#zoom-fit').click();await expect(page.locator('#zoom-value')).toHaveText('100%');
});
