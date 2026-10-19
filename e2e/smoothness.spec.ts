import {test,expect} from '@playwright/test';
import {setup,board,apply,box} from './ux-helpers';
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
