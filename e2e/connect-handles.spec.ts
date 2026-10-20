import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
const dots=(page:Page,id=1)=>page.locator(`[data-connect="${id}"]`);
const adds=(page:Page,id=1)=>page.locator(`[data-add="${id}"]`);
async function hoverCard(page:Page,id=1){const b=await box(page,id);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);}
test('hovering_a_card_shows_four_dots_and_four_plus',async({page})=>{
  await setup(page);await hoverCard(page);await expect(dots(page)).toHaveCount(4);await expect(adds(page)).toHaveCount(4);
  for(const side of ['left','right','top','bottom'])await expect(page.locator(`[data-add="1"][data-side="${side}"]`)).toBeVisible();
  const card=await box(page),right=await bounding(page.locator('[data-connect="1"][data-side="right"]'));expect(Math.abs(right.x+right.width/2-(card.x+card.width)-14)).toBeLessThanOrEqual(1.5);
  await page.mouse.move(card.x+card.width+300,card.y+card.height+300);await expect(dots(page)).toHaveCount(0);
});
test('handles_stay_while_the_pointer_travels_to_the_plus',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'frame',x:40,y:40,width:600,height:400,text:'Frame'}},{op:'update',id:1,patch:{parentFrameId:2}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="right"]')),card=await box(page);
  for(let x=card.x+card.width-5;x<=plus.x+plus.width/2;x+=4){await page.mouse.move(x,card.y+card.height/2);await expect(adds(page)).toHaveCount(4);}
});
test('selected_card_keeps_handles_without_hover',async({page})=>{
  await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.mouse.move(b.x+b.width+300,b.y+b.height+300);await expect(dots(page)).toHaveCount(4);
});
test('no_handles_on_frames_connectors_multi_selection_or_while_editing',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'B'}},{op:'create',element:{kind:'connector',from:1,to:2,text:'link'}},{op:'create',element:{kind:'frame',x:100,y:400,width:300,height:200,text:'F'}}]);
  await expect(page.locator('#scene [data-id="4"]')).toBeVisible();const all=page.locator('[data-connect]');
  await hoverCard(page);await expect(all).toHaveCount(4);
  await page.locator('#scene [data-id="4"] [data-frame-header-hit]').hover();await expect(all).toHaveCount(0);
  await page.locator('#scene [data-id="3"] [data-connector-label]').hover();await expect(all).toHaveCount(0);
  const a=await box(page,1),b=await box(page,2);await page.mouse.click(a.x+35,a.y+35);await page.keyboard.down('Shift');await page.mouse.click(b.x+35,b.y+35);await page.keyboard.up('Shift');
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await expect(all).toHaveCount(0);
  await page.mouse.click(a.x+a.width/2,a.y+a.height+120);await page.mouse.click(a.x+35,a.y+35);await page.keyboard.press('Enter');await expect(page.locator('#text-editor')).toBeVisible();await expect(all).toHaveCount(0);
});
test('handles_hide_on_a_block_smaller_than_40px_on_screen',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,width:30,height:30,text:''}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await hoverCard(page,2);await expect(dots(page,2)).toHaveCount(0);
});
test('edge_resize_handle_still_wins_near_a_dot',async({page})=>{
  const id=await setup(page);const card=await box(page);await page.mouse.click(card.x+35,card.y+35);
  const b=await bounding(page.locator('[data-handle="e"]'));await page.mouse.move(b.x+b.width-2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-2+40,b.y+b.height/2,{steps:4});await page.mouse.up();
  await expect.poll(async()=>(await board(page,id)).elements[0].width).toBeGreaterThan(220);expect((await board(page,id)).elements).toHaveLength(1);
});
