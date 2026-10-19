import {test,expect} from '@playwright/test';
import {setup,board,apply,box,drag} from './ux-helpers';
test('editor_paints_the_scene_without_server_svg',async({page})=>{
  const renders:string[]=[];page.on('request',r=>{if(r.url().includes('/render?format=svg')&&!r.url().includes('frame='))renders.push(r.url());});
  const id=await setup(page);
  await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'B'}},{op:'create',element:{kind:'connector',from:1,to:2}}]);
  await expect(page.locator('#scene-defs marker#arrow-3')).toBeAttached();
  await expect(page.locator('#scene [data-id="3"] path').first()).toHaveAttribute('marker-end','url(#arrow-3)');
  await page.reload();await expect(page.locator('#scene [data-id="3"]')).toBeAttached();await expect(page.locator('#scene [data-id="2"]')).toContainText('B');
  expect(renders).toEqual([]);
});
test('drag_moves_block_without_recreating_its_text',async({page})=>{
  const id=await setup(page);const text=page.locator('#scene [data-id="1"] text').first();await text.evaluate(n=>{(n as unknown as {mark:boolean}).mark=true;});
  const b=await box(page);await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+95,b.y+65,{steps:6});
  await expect.poll(async()=>(await box(page)).x).toBeCloseTo(b.x+60,0);expect(await text.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
  await page.mouse.up();await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await expect(page.locator('#status')).toContainText('сохранены');
  expect(await text.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
});
test('agent_deleting_the_selected_block_hides_its_handles',async({page})=>{
  const id=await setup(page);await page.locator('#scene [data-id="1"]').click();await expect(page.locator('[data-handle="e"]')).toBeVisible();
  await apply(page,id,1,[{op:'delete',ids:[1]}]);
  await expect(page.locator('#scene [data-id="1"]')).toHaveCount(0);await expect(page.locator('[data-handle="e"]')).toBeHidden();
});
test('undo_restores_a_deleted_block_on_the_canvas',async({page})=>{
  const id=await setup(page);await page.locator('#scene [data-id="1"]').click();await page.keyboard.press('Delete');
  await expect(page.locator('#scene [data-id="1"]')).toHaveCount(0);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  await page.keyboard.press('Control+z');await expect(page.locator('#scene [data-id="1"]')).toBeVisible();await expect(page.locator('#scene [data-id="1"]')).toContainText('Card');
});
const zoomSamples=(page:import('@playwright/test').Page)=>page.evaluate(()=>new Promise<number[]>(resolve=>{
  const svg=document.querySelector('#canvas')!,r=svg.getBoundingClientRect(),out:number[]=[];
  svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,ctrlKey:true,clientX:r.x+300,clientY:r.y+300,bubbles:true,cancelable:true}));
  const tick=()=>{out.push((document.querySelector('#world') as SVGGElement).transform.baseVal.consolidate()!.matrix.a);if(out.length<20)requestAnimationFrame(tick);else resolve(out);};requestAnimationFrame(tick);
}));
test('wheel_zoom_eases_to_the_target',async({page})=>{
  await setup(page);const samples=await zoomSamples(page);
  expect(new Set(samples.map(v=>v.toFixed(4))).size).toBeGreaterThan(2);expect(samples.at(-1)).toBeCloseTo(Math.exp(.2),3);
});
test('reduced_motion_zooms_in_one_step',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await setup(page);const samples=await zoomSamples(page);
  expect(new Set(samples.map(v=>v.toFixed(4))).size).toBe(1);expect(samples[0]).toBeCloseTo(Math.exp(.2),3);
});
test('fast_zoom_button_clicks_accumulate',async({page})=>{
  await setup(page);for(let i=0;i<3;i++)await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-value')).toHaveText('173%');
});
test('hover_outlines_a_block_without_selecting_it',async({page})=>{
  await setup(page);await page.keyboard.press('Escape');const b=await box(page);
  await page.mouse.move(b.x+20,b.y+20);await expect(page.locator('#selection [data-hover]')).toBeVisible();await expect(page.locator('[data-handle="e"]')).toBeHidden();
  await page.mouse.move(b.x+b.width+150,b.y+b.height+150);await expect(page.locator('#selection [data-hover]')).toBeHidden();
});
test('pan_gesture_stops_a_running_zoom_animation',async({page})=>{
  await setup(page);const matrix=()=>page.evaluate(()=>{const m=(document.querySelector('#world') as SVGGElement).transform.baseVal.consolidate()!.matrix;return{a:m.a,e:m.e,f:m.f};});
  const before=await matrix(),b=await box(page);
  await page.evaluate(()=>new Promise<void>(resolve=>{
    const svg=document.querySelector('#canvas')!,r=svg.getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,ctrlKey:true,clientX:r.x+300,clientY:r.y+300,bubbles:true,cancelable:true}));
    requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()));
  }));
  await page.mouse.move(b.x+400,b.y+300);await page.mouse.down({button:'middle'});await page.mouse.move(b.x+440,b.y+300,{steps:2});await page.mouse.up({button:'middle'});
  const panned=await matrix();await page.waitForTimeout(300);const settled=await matrix();
  expect(panned.a).toBeGreaterThan(before.a);expect(panned.a).toBeLessThan(Math.exp(.2)-.001);
  expect(settled.a).toBeCloseTo(panned.a,6);expect(settled.e).toBeCloseTo(panned.e,3);expect(settled.f).toBeCloseTo(panned.f,3);
});
test('pins_follow_the_camera_without_being_recreated',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'comment_create',author:'user',text:'Пин',anchor:{type:'element',elementId:1,u:.5,v:.5}}]);
  const pin=page.locator('.comment-pin');await expect(pin).toHaveCount(1);await pin.evaluate(n=>{(n as unknown as {mark:boolean}).mark=true;});
  const before=(await pin.boundingBox())!;const canvas=(await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.wheel(0,120);
  await expect.poll(async()=>(await pin.boundingBox())!.y).toBeLessThan(before.y-50);
  expect(await pin.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
});
test('closing_a_thread_returns_focus_to_its_displaced_pin',async({page})=>{
  const id=await setup(page);const anchor={type:'element',elementId:1,u:.5,v:.5};
  await apply(page,id,1,[{op:'comment_create',author:'user',text:'Пин 1',anchor},{op:'comment_create',author:'user',text:'Пин 2',anchor}]);
  await expect(page.locator('.comment-pin')).toHaveCount(2);
  await page.locator('.comment-pin[data-thread="1"]').click();await expect(page.locator('#comments')).toBeVisible();
  await page.getByRole('button',{name:'Все комментарии'}).click();await page.locator('.thread-row').filter({hasText:'Пин 2'}).click();
  await expect(page.locator('#comments-heading')).toHaveText('Комментарий #2');
  await expect(page.locator('.pin-leader[data-thread="1"]')).toHaveCount(1);
  await page.locator('#comments-close').click();
  await expect(page.locator('.comment-pin[data-thread="1"]')).toBeFocused();
});

test('own_drag_sends_exactly_one_request',async({page})=>{
  const id=await setup(page);await page.waitForTimeout(1200);const calls:string[]=[];
  page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))calls.push(`${r.method()} ${url.pathname}${url.search}`);});
  await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.waitForTimeout(1200);
  expect(calls).toEqual([`POST /api/boards/${id}/apply?state=1`]);
});
