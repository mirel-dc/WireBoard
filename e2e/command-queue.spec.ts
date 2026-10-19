import {test,expect} from '@playwright/test';
import {setup,board,apply,box,drag,bounding} from './ux-helpers';
test('early_undo_waits_for_delayed_move',async({page})=>{
  const id=await setup(page);
  await page.route(`**/api/boards/${id}/apply**`,async route=>{await new Promise(r=>setTimeout(r,800));await route.continue();});
  await drag(page,40,20);await page.keyboard.press('Control+z');
  await expect.poll(async()=>(await board(page,id)).revision).toBe(3);
  expect((await board(page,id)).elements[0].x).toBe(100);
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
});
test('second_drag_is_not_dropped',async({page})=>{
  const id=await setup(page);
  await page.route(`**/api/boards/${id}/apply**`,async route=>{await new Promise(r=>setTimeout(r,800));await route.continue();});
  await drag(page,40,0);await drag(page,30,0);
  await expect.poll(async()=>(await board(page,id)).elements[0].x).toBe(170);
  expect((await board(page,id)).revision).toBe(3);
});
test('lost_response_retries_same_payload',async({page})=>{
  const id=await setup(page);let lost=true;const requests:unknown[]=[];
  await page.route(`**/api/boards/${id}/apply**`,async route=>{
    requests.push(route.request().postDataJSON());
    if(lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await drag(page,40,0);await expect(page.locator('#operation-dialog')).toBeVisible();
  await page.locator('#operation-retry').click();
  await expect(page.locator('#operation-dialog')).not.toBeVisible();
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  const saved=await board(page,id);expect(saved.elements[0].x).toBe(140);expect(saved.revision).toBe(2);
  if(requests.length>1)expect(requests[1]).toEqual(requests[0]);
});
test('own_sse_before_ack_does_not_double_move',async({page})=>{
  const id=await setup(page);const initial=await box(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/boards/${id}/apply**`,async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
  await drag(page,40,0);
  await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  await apply(page,id,2,[{op:'update',id:1,patch:{text:'Agent'}}]);
  await expect.poll(async()=>(await box(page)).x).toBeCloseTo(initial.x+40,0);
  await expect(page.locator('#scene')).toContainText('Agent');
  expect((await box(page)).x).toBeCloseTo(initial.x+40,0);release();
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  expect((await board(page,id)).elements[0].x).toBe(140);
  await expect(page.locator('#scene')).toContainText('Agent');
});
test('agent_text_merges_but_position_blocks_queue',async({page})=>{
  const id=await setup(page);const b=await box(page);
  await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+75,b.y+35);
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Agent text'}}]);await page.mouse.up();
  await expect.poll(async()=>(await board(page,id)).revision).toBe(3);
  expect((await board(page,id)).elements[0].text).toBe('Agent text');expect((await board(page,id)).elements[0].x).toBe(140);
  const next=await box(page);await page.mouse.move(next.x+35,next.y+35);await page.mouse.down();await page.mouse.move(next.x+75,next.y+35);
  await apply(page,id,3,[{op:'update',id:1,patch:{x:500}}]);await page.mouse.up();
  await expect(page.locator('#operation-dialog')).toBeVisible();expect((await board(page,id)).elements[0].x).toBe(500);
});
test('resize_does_not_recapture_remote_geometry_after_pending_ack',async({page})=>{
  const id=await setup(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let first=true;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{if(!first){await route.continue();return;}first=false;const response=await route.fetch();await held;await route.fulfill({response});});
  await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  const handle=page.locator('[data-handle="e"]');await expect(handle).toBeVisible();const h=await bounding(handle);
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+20,h.y+h.height/2);
  await apply(page,id,2,[{op:'update',id:1,patch:{width:300}}]);release();await expect(page.locator('#status')).toHaveText('Все изменения сохранены');await page.mouse.up();
  await expect(page.locator('#operation-dialog')).toBeVisible();expect((await board(page,id)).elements[0].width).toBe(300);expect((await board(page,id)).revision).toBe(3);
});
test('discard_conflict_retains_an_independent_queued_gesture',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'Second'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let first=true;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{if(first){first=false;await held;}await route.continue();});
  await drag(page,40,0);await drag(page,30,0,2);await apply(page,id,2,[{op:'update',id:1,patch:{x:500}}]);release();await expect(page.locator('#operation-dialog')).toBeVisible();await page.locator('#operation-discard').click();
  await expect.poll(async()=>(await board(page,id)).elements.find((e:any)=>e.id===2).x).toBe(450);expect((await board(page,id)).elements[0].x).toBe(500);await expect(page.locator('#operation-dialog')).not.toBeVisible();
});
test('discard_conflict_blocks_a_dependent_gesture_without_stale_send',async({page})=>{
  const id=await setup(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let requests=0;
  await page.route(`**/api/boards/${id}/apply**`,async route=>{requests++;if(requests===1)await held;await route.continue();});
  await drag(page,40,0);await drag(page,30,0);await apply(page,id,1,[{op:'update',id:1,patch:{x:500}}]);release();await expect(page.locator('#operation-dialog')).toBeVisible();await page.locator('#operation-discard').click();
  await expect(page.locator('#operation-dialog')).toBeVisible();await expect(page.locator('#operation-message')).toContainText('зависит');expect(requests).toBe(1);expect((await board(page,id)).elements[0].x).toBe(500);
});
test('late_snapshot_does_not_erase_projection',async({page})=>{
  const id=await setup(page);const initial=await box(page);let release!:()=>void,seen!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),captured=new Promise<void>(resolve=>{seen=resolve;});let first=true;
  await page.route(`**/api/boards/${id}/edit-state**`,async route=>{if(!first||route.request().url().includes('commandId=')){await route.continue();return;}first=false;const response=await route.fetch();seen();await held;await route.fulfill({response});});
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Agent snapshot'}}]);await captured;await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(3);await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  const late=page.waitForResponse(r=>r.url().includes(`/api/boards/${id}/edit-state`)&&!r.url().includes('commandId='));release();await(await late).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.locator('#scene')).toContainText('Agent snapshot');await expect.poll(async()=>(await box(page)).x).toBeCloseTo(initial.x+40,0);expect((await board(page,id)).elements[0].x).toBe(140);
});
