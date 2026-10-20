import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';

async function copy(page:Page){
  return page.evaluate(()=>{const event=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true});document.dispatchEvent(event);const data=event.clipboardData!;return Object.fromEntries(data.types.map(type=>[type,data.getData(type)]));});
}
async function paste(page:Page,data:Record<string,string>){
  await page.evaluate(data=>{const event=new ClipboardEvent('paste',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true});for(const [type,value]of Object.entries(data))event.clipboardData!.setData(type,value);document.dispatchEvent(event);},data);
}
async function selectCard(page:Page,id=1){const b=await box(page,id);await page.mouse.click(b.x+10,b.y+35);}
async function linkedFrame(page:Page,id:string){
  await apply(page,id,1,[
    {op:'create',element:{kind:'frame',x:60,y:60,width:650,height:400,text:'Outer'}},
    {op:'update',id:1,patch:{parentFrameId:2}},
    {op:'create',element:{kind:'frame',x:350,y:90,width:260,height:300,text:'Nested'}},
    {op:'create',element:{kind:'rectangle',x:380,y:130,width:180,height:100,text:'Inner'}},
    {op:'create',element:{kind:'connector',from:1,to:4,text:'Internal'}},
    {op:'create',element:{kind:'rectangle',x:900,y:100,text:'External'}},
    {op:'create',element:{kind:'connector',from:1,to:6,text:'External link'}},
    {op:'comment_create',anchor:{type:'element',elementId:1,u:.5,v:.5},author:'user',text:'Stay here'}
  ]);
  await expect(page.locator('#scene [data-id="2"] [data-frame-header-hit]')).toBeVisible();
  await page.locator('#fit').click();
  await page.locator('#scene [data-id="2"] [data-frame-header-hit]').click();
}

test('clipboard nested frame copies only internal links with atomic Undo/Redo',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);const data=await copy(page);
  expect(data['application/x-wireboard-elements']).toBeTruthy();
  await paste(page,data);await expect.poll(async()=>(await board(page,id)).elements.length).toBe(12);
  const b=await board(page,id),pasted=b.elements.filter((e:any)=>e.id>=8);
  expect(pasted.map((e:any)=>e.kind).sort()).toEqual(['connector','frame','frame','rectangle','rectangle']);
  const outer=pasted.find((e:any)=>e.text==='Outer'),nested=pasted.find((e:any)=>e.text==='Nested'),card=pasted.find((e:any)=>e.text==='Card'),inner=pasted.find((e:any)=>e.text==='Inner'),link=pasted.find((e:any)=>e.kind==='connector');
  expect(nested.parentFrameId).toBe(outer.id);expect(card.parentFrameId).toBe(outer.id);expect(inner.parentFrameId).toBe(nested.id);expect([link.from,link.to]).toEqual([card.id,inner.id]);expect([card.x,card.y]).toEqual([124,124]);expect(b.comments).toHaveLength(1);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(7);
  await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(12);
});

test('clipboard two pastes before ACK allocate distinct IDs and repeated offset',async({page})=>{
  const id=await setup(page);await selectCard(page);const data=await copy(page);let calls=0;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{calls++;const response=await route.fetch();if(calls===1)await new Promise(r=>setTimeout(r,800));await route.fulfill({response});});
  await paste(page,data);await paste(page,data);await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  const b=await board(page,id);expect(b.elements.map((e:any)=>[e.id,e.x,e.y])).toEqual([[1,100,100],[2,124,124],[3,148,148]]);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);
});

test('clipboard leaves native text fields alone and plain text creates text on canvas',async({page})=>{
  const id=await setup(page);await selectCard(page);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Native');
  expect(await copy(page)).toEqual({});await paste(page,{'text/plain':'Ordinary text'});expect((await board(page,id)).elements).toHaveLength(1);
  await page.locator('#text-draft').fill('Card');await page.locator('#text-draft').press('Escape');await page.locator('#canvas').focus();await paste(page,{'text/plain':'Readable pasted text'});
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);expect((await board(page,id)).elements[1]).toMatchObject({kind:'text',text:'Readable pasted text'});
});

test('clipboard malformed typed payload does not fall through to plain text',async({page})=>{
  const id=await setup(page);await selectCard(page);
  await paste(page,{'application/x-wireboard-elements':'{"type":"wireboard-elements","version":1,"elements":[]}', 'text/plain':'fallback'});
  await expect(page.locator('#toast')).toBeVisible();expect((await board(page,id)).elements).toHaveLength(1);
});

test('clipboard late acknowledgement keeps a newer selection',async({page})=>{
  const id=await setup(page);await selectCard(page);const data=await copy(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route(`**/api/boards/${id}/apply**`,async route=>{const response=await route.fetch();await gate;await route.fulfill({response});});
  await paste(page,data);await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);await selectCard(page,1);release();
  await expect(page.locator('#status')).toContainText('сохранены');await page.keyboard.press('Delete');await expect.poll(async()=>(await board(page,id)).elements.map((e:any)=>e.id)).toEqual([2]);
});

test('clipboard frame target geometry change conflicts instead of inserting with stale membership',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);const data=await copy(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);let sent=false;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{if(!sent){sent=true;await gate;}await route.continue();});
  await paste(page,data);await expect.poll(()=>sent).toBe(true);
  const state=await board(page,id);
  const remote=await page.request.post(`/api/boards/${id}/apply`,{headers:{Origin:'http://127.0.0.1:19843'},data:{revision:state.revision,operations:[{op:'move',ids:[2],dx:500,dy:0}]}});expect(remote.ok()).toBeTruthy();release();
  await expect(page.locator('#operation-dialog')).toBeVisible();expect((await board(page,id)).elements).toHaveLength(7);
});

test('clipboard native Ctrl+C and Ctrl+V use the system clipboard',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='webkit','Playwright WebKit on Windows drops copy-event writes to the OS clipboard; event payload integration is covered separately.');
  const id=await setup(page);await selectCard(page);await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);expect((await board(page,id)).elements[1]).toMatchObject({text:'Card',x:124,y:124});
});

test('clipboard cross board remaps the cluster and centers it in the visible canvas',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);const data=await copy(page);
  await page.locator('#new-board').click();await page.locator('#create-title').fill('Clipboard target');await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#board-title')).toHaveText('Clipboard target');
  const target=(await page.locator('#canvas').getAttribute('data-board'))!;const center=await page.evaluate(()=>{const r=document.querySelector('#canvas')!.getBoundingClientRect();const p=new DOMPoint(r.x+r.width/2,r.y+r.height/2).matrixTransform(document.querySelector<SVGGElement>('#world')!.getScreenCTM()!.inverse());return{x:p.x,y:p.y};});
  await paste(page,data);await expect.poll(async()=>(await board(page,target)).elements.length).toBe(5);
  const b=await board(page,target),root=b.elements.find((e:any)=>e.text==='Outer');expect(root.parentFrameId).toBeNull();expect(root.x+root.width/2).toBeCloseTo(center.x);expect(root.y+root.height/2).toBeCloseTo(center.y);expect(b.comments).toHaveLength(0);expect((await board(page,id)).elements).toHaveLength(7);
});

test('clipboard cycles dangling links and oversized clusters reject before writing',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);const data=await copy(page),source=JSON.parse(data['text/plain']);
  for(const mode of ['cycle','dangling','oversized']){
    const snapshot=structuredClone(source);if(mode==='cycle')snapshot.elements.find((e:any)=>e.text==='Outer').parentFrameId=3;
    if(mode==='dangling')snapshot.elements.find((e:any)=>e.kind==='connector').to=900;
    if(mode==='oversized')snapshot.elements=Array.from({length:51},(_,i)=>({...source.elements[0],id:i+20,parentFrameId:null}));
    await paste(page,{[ 'application/x-wireboard-elements']:JSON.stringify(snapshot)});await expect(page.locator('#toast')).toBeVisible();expect((await board(page,id)).revision).toBe(2);
  }
});

test('clipboard lost response retries the receipt without a second insertion',async({page})=>{
  const id=await setup(page);await selectCard(page);const data=await copy(page);let first=true;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await paste(page,data);await expect(page.locator('#operation-dialog')).toBeVisible();await page.locator('#operation-retry').click();await expect(page.locator('#operation-dialog')).not.toBeVisible();
  expect((await board(page,id)).elements).toHaveLength(2);expect((await board(page,id)).revision).toBe(2);await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(1);
});

test('clipboard two frame pastes before ACK keep frame allocation guards coherent',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);const data=await copy(page);let first=true;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{const response=await route.fetch();if(first){first=false;await new Promise(r=>setTimeout(r,800));}await route.fulfill({response});});
  await paste(page,data);await paste(page,data);await expect.poll(async()=>(await board(page,id)).elements.length).toBe(17);expect((await board(page,id)).elements.filter((e:any)=>e.id>=8).map((e:any)=>e.id)).toEqual([8,9,10,11,12,13,14,15,16,17]);
});

test('clipboard Windows multiline text normalizes line endings and remains undoable',async({page})=>{
  const id=await setup(page);await selectCard(page);await paste(page,{'text/plain':'First\r\nSecond\rThird'});
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);
  expect((await board(page,id)).elements[1].text).toBe('First\nSecond\nThird');await expect(page.locator('#operation-dialog')).not.toBeVisible();
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(1);
});

test('arrows repeat and Shift steps form one Undo action',async({page})=>{
  const id=await setup(page);await selectCard(page);await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await page.keyboard.down('Shift');await page.keyboard.down('ArrowDown');await page.keyboard.up('ArrowRight');
  expect((await board(page,id)).elements[0]).toMatchObject({x:100,y:100});await page.keyboard.up('ArrowDown');await page.keyboard.up('Shift');
  await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.x,e.y];}).toEqual([103,110]);
  await page.keyboard.press('Control+z');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.x,e.y];}).toEqual([100,100]);
  await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.x,e.y];}).toEqual([103,110]);
});

test('arrows move frame descendants once and text input keeps native arrows',async({page})=>{
  const id=await setup(page);await linkedFrame(page,id);
  const b=await box(page,1);await page.keyboard.down('Shift');await page.mouse.click(b.x+10,b.y+35);await page.keyboard.up('Shift');
  await page.keyboard.press('Shift+ArrowRight');await expect.poll(async()=>(await board(page,id)).elements[0].x).toBe(110);expect((await board(page,id)).elements.find((e:any)=>e.id===4).x).toBe(390);
  await page.keyboard.press('Escape');await selectCard(page,1);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('abc');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowRight');expect((await board(page,id)).elements[0].x).toBe(110);
});

test('arrows Escape cancels preview and blur commits the series',async({page})=>{
  const id=await setup(page);await selectCard(page);const before=await box(page);
  await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await expect.poll(async()=>(await box(page)).x).toBeGreaterThan(before.x);
  await page.keyboard.press('Escape');await page.keyboard.up('ArrowRight');expect((await board(page,id)).elements[0].x).toBe(100);
  await selectCard(page);await page.keyboard.down('ArrowRight');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowRight');await expect.poll(async()=>(await board(page,id)).elements[0].x).toBe(101);
});

test('arrows early Undo finishes held series and preserves later agent text',async({page})=>{
  const id=await setup(page);await selectCard(page);await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await page.keyboard.press('Control+z');await page.keyboard.up('ArrowRight');
  await expect.poll(async()=>(await board(page,id)).revision).toBe(3);expect((await board(page,id)).elements[0].x).toBe(100);
  await page.keyboard.press('Shift+ArrowRight');await expect.poll(async()=>(await board(page,id)).elements[0].x).toBe(110);
  const current=await board(page,id);await apply(page,id,current.revision,[{op:'update',id:1,patch:{text:'Agent text'}}]);await expect(page.locator('#scene [data-id="1"]')).toContainText('Agent text');
  await page.keyboard.press('Control+z');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.x,e.text];}).toEqual([100,'Agent text']);
});

test('arrows agent geometry during held series conflicts without overwriting it',async({page})=>{
  const id=await setup(page);await selectCard(page);await page.keyboard.down('ArrowRight');
  await apply(page,id,1,[{op:'move',ids:[1],dx:50,dy:0}]);await page.keyboard.up('ArrowRight');
  await expect(page.locator('#operation-dialog')).toBeVisible();expect((await board(page,id)).elements[0].x).toBe(150);
});

async function screen(page:Page,x:number,y:number){return page.evaluate(({x,y})=>{const p=new DOMPoint(x,y).matrixTransform(document.querySelector<SVGGElement>('#world')!.getScreenCTM()!);return{x:p.x,y:p.y};},{x,y});}
async function draw(page:Page,kind:'rectangle'|'text'|'frame',start:{x:number;y:number},end:{x:number;y:number},shift=false){
  await page.locator(`[data-tool="${kind}"]`).click();const a=await screen(page,start.x,start.y),b=await screen(page,end.x,end.y);await page.mouse.move(a.x,a.y);await page.mouse.down();if(shift)await page.keyboard.down('Shift');await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();if(shift)await page.keyboard.up('Shift');
}

test('creation reverse drag previews before commit and Undo removes one object',async({page})=>{
  const id=await setup(page);await page.locator('[data-tool="rectangle"]').click();const a=await screen(page,460,340),b=await screen(page,340,240);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});
  await expect(page.locator('[data-creation-preview]')).toBeVisible();expect((await board(page,id)).elements).toHaveLength(1);
  await page.mouse.up();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);const e=(await board(page,id)).elements[1];expect(e.x).toBeCloseTo(340);expect(e.y).toBeCloseTo(240);expect(e.width).toBeCloseTo(120);expect(e.height).toBeCloseTo(100);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(1);await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);
});

test('creation all kinds drag freely and Shift makes a square',async({page})=>{
  const id=await setup(page);await draw(page,'text',{x:400,y:220},{x:520,y:290});await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);
  expect((await board(page,id)).elements[1]).toMatchObject({kind:'text',width:120,height:70});
  await draw(page,'frame',{x:400,y:320},{x:510,y:370},true);await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  expect((await board(page,id)).elements[2]).toMatchObject({kind:'frame',width:110,height:110});
});

test('creation click defaults and cancellation do not leave phantom objects',async({page})=>{
  const id=await setup(page);await page.locator('[data-tool="text"]').click();const p=await screen(page,430,260);await page.mouse.click(p.x,p.y);
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);expect((await board(page,id)).elements[1]).toMatchObject({kind:'text',width:320,height:100});
  await page.locator('[data-tool="frame"]').click();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+90,p.y+70);await page.keyboard.press('Escape');await page.mouse.up();expect((await board(page,id)).elements).toHaveLength(2);
  await page.locator('[data-tool="rectangle"]').click();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+90,p.y+70);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect((await board(page,id)).elements).toHaveLength(2);
});

test('creation two drags before acknowledgement retain distinct IDs',async({page})=>{
  const id=await setup(page);let calls=0;await page.route(`**/api/boards/${id}/apply**`,async route=>{calls++;const response=await route.fetch();if(calls===1)await new Promise(r=>setTimeout(r,900));await route.fulfill({response});});
  await draw(page,'rectangle',{x:400,y:230},{x:460,y:280});await draw(page,'text',{x:500,y:300},{x:570,y:380});
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);expect((await board(page,id)).elements.map((e:any)=>e.id)).toEqual([1,2,3]);
  expect((await board(page,id)).elements[2]).toMatchObject({kind:'text',width:70,height:80});
});
