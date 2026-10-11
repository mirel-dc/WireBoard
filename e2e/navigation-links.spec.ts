import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
async function camera(page:Page){return page.locator('#world').evaluate(e=>{const m=(e as SVGGElement).transform.baseVal.consolidate()!.matrix;return{x:m.e,y:m.f,zoom:m.a};});}
async function wheel(page:Page,data:Record<string,number|boolean>){return page.locator('#canvas').evaluate((e,data)=>{const invalid=Object.entries(data).filter(([,v])=>typeof v==='number'&&!Number.isFinite(v));const event=new WheelEvent('wheel',{...data,...Object.fromEntries(invalid.map(([k])=>[k,0])),bubbles:true,cancelable:true});for(const [key,value]of invalid)Object.defineProperty(event,key,{value});e.dispatchEvent(event);return event.defaultPrevented;},data);}
async function screen(page:Page,x:number,y:number){return page.locator('#world').evaluate((e,p)=>{const v=new DOMPoint(p.x,p.y).matrixTransform((e as SVGGraphicsElement).getScreenCTM()!);return{x:v.x,y:v.y};},{x,y});}

test('navigation scroll pans two axes without revision',async({page})=>{
  const id=await setup(page),a=await camera(page),canvas=await bounding(page.locator('#canvas'));
  await page.mouse.move(canvas.x+500,canvas.y+300);await page.mouse.wheel(40,80);
  await expect.poll(async()=>(await camera(page)).y).toBeCloseTo(a.y-80);expect(await camera(page)).toEqual({...a,x:a.x-40,y:a.y-80});expect((await board(page,id)).revision).toBe(1);await expect(page.locator('#undo')).toBeDisabled();
});
test('navigation modifier zoom anchors and clamps',async({page})=>{
  await setup(page);const a=await camera(page),p=await screen(page,300,180);await wheel(page,{deltaY:100,ctrlKey:true,clientX:p.x,clientY:p.y});const b=await camera(page);expect(b.zoom).toBeCloseTo(a.zoom*Math.exp(-.2),6);const same=await screen(page,300,180);expect(same.x).toBeCloseTo(p.x);expect(same.y).toBeCloseTo(p.y);
  await wheel(page,{deltaY:-2000,metaKey:true,clientX:p.x,clientY:p.y});expect((await camera(page)).zoom).toBe(4);await wheel(page,{deltaY:2000,ctrlKey:true});await wheel(page,{deltaY:2000,ctrlKey:true});expect((await camera(page)).zoom).toBeCloseTo(.1,6);
});
test('navigation camera limits and modal ignore',async({page})=>{
  const id=await setup(page),a=await camera(page);await page.locator('#new-board').click();expect(await wheel(page,{deltaY:100,ctrlKey:true})).toBe(false);expect(await camera(page)).toEqual(a);await page.locator('#create-dialog').getByRole('button',{name:'Отмена',exact:true}).click();
  await page.evaluate(id=>localStorage.setItem(`wireboard:view:${id}`,JSON.stringify({camera:{x:9999999,y:9999999,zoom:1},selected:[]})),id);await page.reload();await expect(page.locator('#canvas')).toHaveAttribute('data-board',id);await wheel(page,{deltaX:-1e100,deltaY:-1e100});expect(await camera(page)).toEqual({x:1e7,y:1e7,zoom:1});await wheel(page,{deltaY:-100,ctrlKey:true});expect(Math.abs((await camera(page)).x)).toBeLessThanOrEqual(1e7);
});
test('navigation line page Shift and zero invalid deltas',async({page})=>{
  await setup(page);const a=await camera(page);await wheel(page,{deltaY:2,deltaMode:1,shiftKey:true});expect(await camera(page)).toEqual({...a,x:a.x-32});const canvas=await bounding(page.locator('#canvas'));await wheel(page,{deltaX:1,deltaY:.5,deltaMode:2});const b=await camera(page);expect(b.x).toBeCloseTo(a.x-32-Math.min(2000,canvas.width));expect(b.y).toBeCloseTo(a.y-Math.min(2000,canvas.height*.5));await wheel(page,{deltaX:Infinity,deltaY:NaN});expect(await camera(page)).toEqual(b);await wheel(page,{deltaY:1e100});expect((await camera(page)).y).toBe(b.y-2000);
});
test('navigation draft follows camera and wheel during capture is ignored',async({page})=>{
  const id=await setup(page),b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Unsaved text');const draft=await bounding(page.locator('#text-form'));await wheel(page,{deltaX:25,deltaY:35});const moved=await bounding(page.locator('#text-form'));expect(moved.x).toBeCloseTo(draft.x-25);expect(moved.y).toBeCloseTo(draft.y-35);await expect(page.locator('#text-draft')).toHaveValue('Unsaved text');await page.locator('#draft-cancel').click();const card=await box(page);await page.mouse.move(card.x+35,card.y+35);await page.mouse.down();const before=await camera(page);await wheel(page,{deltaY:100,ctrlKey:true});expect(await camera(page)).toEqual(before);await page.keyboard.press('Escape');await page.mouse.up();expect((await board(page,id)).revision).toBe(1);
});
test('navigation finishes held arrows and ignores presentation canvas wheel',async({page})=>{
  const id=await setup(page),b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.down('ArrowRight');const a=await camera(page);await wheel(page,{deltaY:20});await page.keyboard.up('ArrowRight');await expect.poll(async()=>(await board(page,id)).revision).toBe(2);expect((await board(page,id)).elements[0].x).toBe(101);expect((await camera(page)).y).toBe(a.y-20);await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).revision).toBe(3);expect((await board(page,id)).elements[0].x).toBe(100);
  await apply(page,id,3,[{op:'create',element:{kind:'frame',x:0,y:0,width:700,height:450,text:'Slide'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();await page.locator('#present').click();await expect(page.locator('#app')).toHaveAttribute('inert','');const before=await camera(page);expect(await wheel(page,{deltaY:100,ctrlKey:true})).toBe(false);expect(await camera(page)).toEqual(before);
});

async function links(page:Page){const id=await setup(page);await apply(page,id,1,[
  {op:'create',element:{kind:'rectangle',x:500,y:100,text:'Right'}},
  {op:'create',element:{kind:'rectangle',x:500,y:350,text:'New target'}},
  {op:'create',element:{kind:'text',x:100,y:350,width:240,height:100,text:'Text target'}},
  {op:'create',element:{kind:'connector',from:1,to:2,fromPort:'right',toPort:'left',text:'Link'}},
  {op:'create',element:{kind:'frame',x:850,y:350,width:300,height:200,text:'Invalid target'}}
]);await expect(page.locator('#scene [data-id="5"]')).toBeVisible();return id;}
async function selectLink(page:Page){await page.keyboard.press('KeyV');const p=await page.locator('#scene [data-id="5"] path').first().evaluate(e=>{const path=e as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()*.5),v=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM()!);return{x:v.x,y:v.y};});await page.mouse.click(p.x,p.y);await expect(handle(page,'to')).toBeVisible({timeout:1000});}
const handle=(page:Page,end:'from'|'to')=>page.locator(`#selection [data-connector-end="5"][data-end="${end}"]`);
async function startEnd(page:Page,end:'from'|'to'){const b=await bounding(handle(page,end));await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();}
async function endMove(page:Page,x:number,y:number){const p=await screen(page,x,y);await page.mouse.move(p.x,p.y,{steps:5});}
async function link(page:Page,id:string){return (await board(page,id)).elements.find((e:any)=>e.id===5);}

test('connector both ends snap ports and one Undo Redo',async({page})=>{
  const id=await links(page);await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);await expect(page.locator('[data-connector-target="3"]')).toBeVisible();await expect(page.locator('[data-connector-preview="5"]')).toBeVisible();expect((await board(page,id)).revision).toBe(2);await page.mouse.up();await expect.poll(async()=>(await link(page,id)).to).toBe(3);expect((await link(page,id)).toPort).toBe('top');
  await startEnd(page,'from');await endMove(page,339,400);await page.mouse.up();await expect.poll(async()=>(await link(page,id)).from).toBe(4);expect((await link(page,id)).fromPort).toBe('right');await page.keyboard.press('Control+z');await expect.poll(async()=>(await link(page,id)).from).toBe(1);expect((await link(page,id)).to).toBe(3);await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await link(page,id)).from).toBe(4);
});
test('connector handles stay 24 CSS pixels at low and high zoom',async({page})=>{
  await links(page);await selectLink(page);for(const deltaY of [900,-1800]){const p=await screen(page,500,156);await wheel(page,{deltaY,ctrlKey:true,clientX:p.x,clientY:p.y});const b=await bounding(handle(page,'to'));expect(Math.abs(b.width-24)).toBeLessThan(.1);expect(Math.abs(b.height-24)).toBeLessThan(.1);}
});
test('connector empty self frame and click drops keep original link',async({page})=>{
  const id=await links(page);await selectLink(page);for(const p of [[410,156],[200,150],[950,450]]){await startEnd(page,'to');await endMove(page,p[0],p[1]);await page.mouse.up();expect((await board(page,id)).revision).toBe(2);expect((await link(page,id)).to).toBe(2);}await startEnd(page,'to');await page.mouse.up();expect((await board(page,id)).revision).toBe(2);
});
test('connector Escape blur lost capture and tool change cancel',async({page})=>{
  const id=await links(page);for(const action of ['escape','blur','capture','tool']){await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);if(action==='escape')await page.keyboard.press('Escape');else if(action==='tool')await page.keyboard.press('KeyR');else await page.locator('#canvas').evaluate((e,action)=>{if(action==='blur')window.dispatchEvent(new Event('blur'));else e.dispatchEvent(new Event('lostpointercapture'));},action);await page.mouse.up();await expect(page.locator('[data-connector-preview]')).toHaveCount(0);expect((await board(page,id)).revision).toBe(2);}
});
test('connector independent agent text merges and own Undo preserves it',async({page})=>{
  const id=await links(page);await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);await apply(page,id,2,[{op:'update',id:5,patch:{text:'Agent caption'}},{op:'update',id:3,patch:{text:'Agent target'}}]);await page.mouse.up();await expect.poll(async()=>(await board(page,id)).revision).toBe(4);expect((await link(page,id)).to).toBe(3);await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).revision).toBe(5);expect((await link(page,id)).to).toBe(2);expect((await link(page,id)).text).toBe('Agent caption');
});
for(const conflict of ['geometry','ABA','endpoint','deletion'])test(`connector agent ${conflict} conflicts with captured gesture`,async({page})=>{
  const id=await links(page);await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);
  if(conflict==='geometry'||conflict==='ABA'){await apply(page,id,2,[{op:'update',id:3,patch:{x:510}}]);if(conflict==='ABA')await apply(page,id,3,[{op:'update',id:3,patch:{x:500}}]);}
  else await apply(page,id,2,conflict==='deletion'?[{op:'delete',ids:[3]}]:[{op:'update',id:5,patch:{from:4,fromPort:'right'}}]);await page.mouse.up();await expect(page.locator('#operation-dialog')).toBeVisible();expect((await link(page,id)).to).toBe(2);
});
test('connector two rewires before ACK and lost response remain one action each',async({page})=>{
  const id=await links(page);await selectLink(page);let calls=0;await page.route(`**/api/boards/${id}/apply`,async route=>{calls++;if(calls===1){const response=await route.fetch();await new Promise(r=>setTimeout(r,1000));await route.fulfill({response});}else await route.continue();});await startEnd(page,'to');await endMove(page,550,351);await page.mouse.up();await startEnd(page,'from');await endMove(page,339,400);await page.mouse.up();await expect.poll(async()=>(await board(page,id)).revision).toBe(4);expect([(await link(page,id)).from,(await link(page,id)).to]).toEqual([4,3]);expect(calls).toBe(2);await page.keyboard.press('Control+z');await expect.poll(async()=>(await link(page,id)).from).toBe(1);
  await page.unroute(`**/api/boards/${id}/apply`);let first=true;await page.route(`**/api/boards/${id}/apply`,async route=>{if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});await startEnd(page,'from');await endMove(page,339,400);await page.mouse.up();await expect(page.locator('#operation-dialog')).toBeVisible();await page.locator('#operation-retry').click();await expect(page.locator('#operation-dialog')).not.toBeVisible();expect((await board(page,id)).revision).toBe(6);expect((await link(page,id)).from).toBe(4);
});
test('connector overlapping visible target and border halo',async({page})=>{
  const id=await links(page);await apply(page,id,2,[{op:'create',element:{kind:'rectangle',x:520,y:330,width:200,height:150,text:'Front'}}]);await expect(page.locator('#scene [data-id="7"]')).toBeVisible();await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);await expect(page.locator('[data-connector-target="7"]')).toBeVisible();await endMove(page,515,400);await expect(page.locator('[data-connector-target="3"]')).toBeVisible();await endMove(page,515,470);await expect(page.locator('[data-connector-target="7"]')).toBeVisible();await page.mouse.up();await expect.poll(async()=>(await link(page,id)).to).toBe(7);expect((await link(page,id)).toPort).toBe('left');
});
for(const control of ['toolbar','zoom'])test(`review connector ${control} focus cancels before release`,async({page})=>{
  const id=await links(page);await selectLink(page);await startEnd(page,'to');await endMove(page,550,351);const a=await camera(page);await page.locator(control==='toolbar'?'[data-tool="rectangle"]':'#zoom-in').focus();await expect(page.locator('[data-connector-preview]')).toHaveCount(0);if(control==='zoom'){await page.keyboard.press('Enter');expect((await camera(page)).zoom).toBeCloseTo(a.zoom*1.2,6);}await page.mouse.up();expect((await board(page,id)).revision).toBe(2);expect((await link(page,id)).to).toBe(2);
});
test('review connector chooses the nearest actual side midpoint',async({page})=>{
  const id=await links(page);await apply(page,id,2,[{op:'update',id:3,patch:{width:1000,height:20}}]);await expect(page.locator('#scene [data-id="3"] > rect')).toHaveAttribute('height','20');await selectLink(page);await startEnd(page,'to');await endMove(page,510,359);await page.mouse.up();await expect.poll(async()=>(await link(page,id)).to).toBe(3);expect((await link(page,id)).toPort).toBe('left');
});
