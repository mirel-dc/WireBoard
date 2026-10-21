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
async function clickPlus(page:Page,side:string,id=1){await hoverCard(page,id);const plus=page.locator(`[data-add="${id}"][data-side="${side}"]`);await expect(plus).toBeVisible();await plus.click();}
test('plus_creates_a_linked_copy_in_each_direction',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{fill:'#fff0b8',stroke:'#ccad49'}}]);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  const expected:Record<string,[number,number]>={right:[400,100],left:[-200,100],top:[100,-92],bottom:[100,292]};let revision=2;
  for(const [side,[x,y]]of Object.entries(expected)){
    await clickPlus(page,side);await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');
    revision++;await expect.poll(async()=>(await board(page,id)).revision).toBe(revision);
    const b=await board(page,id),block=b.elements.at(-2),link=b.elements.at(-1);
    expect([block.kind,block.x,block.y,block.width,block.height,block.fill,block.stroke,block.title,block.text]).toEqual(['rectangle',x,y,220,112,'#fff0b8','#ccad49','','']);
    expect([link.kind,link.from,link.to,link.fromPort,link.toPort]).toEqual(['connector',1,block.id,side,{right:'left',left:'right',top:'bottom',bottom:'top'}[side]]);
  }
});
test('plus_is_one_undo_step_and_opens_text_input',async({page})=>{
  const id=await setup(page);await clickPlus(page,'right');await expect(page.locator('#title-draft')).toBeFocused();await page.keyboard.type('Оплата');await page.keyboard.press('Escape');
  await expect.poll(async()=>(await board(page,id)).elements.find((e:{id:number})=>e.id===2)?.title).toBe('Оплата');
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(1);
});
test('plus_skips_an_occupied_spot',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:400,y:100,text:'Busy'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await clickPlus(page,'right');await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(4);
  const block=(await board(page,id)).elements.find((e:{id:number})=>e.id===3);expect([block.x,block.y]).toEqual([644,100]);
});
test('clicking_a_dot_without_dragging_creates_nothing',async({page})=>{
  const id=await setup(page);await hoverCard(page);await page.locator('[data-connect="1"][data-side="right"]').click();await page.waitForTimeout(200);
  expect((await board(page,id)).revision).toBe(1);
});
test('plus_far_off_screen_moves_the_camera_to_show_the_block',async({page})=>{
  await setup(page);const canvas=await bounding(page.locator('#canvas'));
  const b=await box(page);await page.locator('#canvas').evaluate((e,dx)=>e.dispatchEvent(new WheelEvent('wheel',{deltaX:dx,bubbles:true,cancelable:true})),b.x-canvas.x-100);
  await clickPlus(page,'left');await expect(page.locator('#text-editor')).toBeVisible();
  const editor=await bounding(page.locator('#text-editor'));expect(editor.x).toBeGreaterThanOrEqual(canvas.x+39);
});
test('agent_change_during_plus_closes_the_new_block_editor',async({page})=>{
  const id=await setup(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/boards/${id}/apply**`,async route=>{await held;await route.continue();},{times:1});
  await clickPlus(page,'right');await expect(page.locator('#text-editor')).toBeVisible();
  await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:900,y:500,text:'Agent'}}]);release();
  await expect(page.locator('#text-editor')).toBeHidden();await expect(page.locator('#operation-dialog')).toBeVisible();
  const agent=(await board(page,id)).elements.find((e:{text:string})=>e.text==='Agent');expect(agent).toBeTruthy();
});
async function screen(page:Page,x:number,y:number){return page.locator('#world').evaluate((e,p)=>{const v=new DOMPoint(p.x,p.y).matrixTransform((e as SVGGraphicsElement).getScreenCTM()!);return{x:v.x,y:v.y};},{x,y});}
async function grabDot(page:Page,side='right',id=1){await hoverCard(page,id);const d=await bounding(page.locator(`[data-connect="${id}"][data-side="${side}"]`));await page.mouse.move(d.x+d.width/2,d.y+d.height/2);await page.mouse.down();return d;}
test('dragging_from_a_dot_onto_a_block_connects_them',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:500,y:300,text:'B'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await grabDot(page);const p=await screen(page,510,356);await page.mouse.move(p.x,p.y,{steps:8});
  await expect(page.locator('[data-wire-preview]')).toBeVisible();await expect(page.locator('[data-connector-target="2"]')).toBeVisible();await page.mouse.up();
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);const link=(await board(page,id)).elements[2];
  expect([link.kind,link.from,link.to,link.fromPort,link.toPort]).toEqual(['connector',1,2,'right','left']);await expect(page.locator('#text-editor')).toBeHidden();
});
test('dragging_into_empty_space_creates_a_linked_block_at_the_drop',async({page})=>{
  const id=await setup(page);await grabDot(page);const p=await screen(page,700,400);await page.mouse.move(p.x,p.y,{steps:8});await page.mouse.up();
  await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  const [,block,link]=(await board(page,id)).elements;expect([block.x,block.y]).toEqual([700,344]);expect([link.from,link.to,link.fromPort,link.toPort]).toEqual([1,block.id,'right','left']);
});
test('dropping_back_on_the_source_creates_nothing',async({page})=>{
  const id=await setup(page);await grabDot(page);const p=await screen(page,210,156);await page.mouse.move(p.x+80,p.y,{steps:4});await page.mouse.move(p.x,p.y,{steps:4});await page.mouse.up();
  await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);await expect(page.locator('[data-wire-preview]')).toBeHidden();
});
test('escape_cancels_a_drag_without_a_command',async({page})=>{
  const id=await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+120,d.y+60,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('[data-wire-preview]')).toBeHidden();await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('dragging_from_a_plus_works_like_a_dot',async({page})=>{
  const id=await setup(page);await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="bottom"]'));
  await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2);await page.mouse.down();const p=await screen(page,210,520);await page.mouse.move(p.x,p.y,{steps:8});await page.mouse.up();
  await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  const [,block,link]=(await board(page,id)).elements;expect([block.x,block.y]).toEqual([100,520]);expect([link.fromPort,link.toPort]).toEqual(['bottom','top']);
});
test('wheel_during_a_drag_pans_and_the_preview_follows',async({page})=>{
  await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+150,d.y,{steps:6});const before=await bounding(page.locator('[data-wire-preview]'));
  await page.mouse.wheel(0,120);await expect.poll(async()=>(await bounding(page.locator('[data-wire-preview]'))).height).not.toBeCloseTo(before.height,0);
  await page.keyboard.press('Escape');await page.mouse.up();
});
test('plus_on_an_empty_text_block_then_escape_leaves_no_connector',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'text',x:100,y:400,width:320,height:100,text:'T'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await clickPlus(page,'right',2);await expect(page.locator('#text-editor')).toBeVisible();
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(4);await page.keyboard.press('Escape');
  await expect.poll(async()=>{const els=(await board(page,id)).elements;return[els.some((e:{kind:string})=>e.kind==='connector'),els.some((e:{id:number;kind:string})=>e.id===2&&e.kind==='text'),els.length];}).toEqual([false,true,2]);
});
test('window_blur_during_a_drag_creates_nothing',async({page})=>{
  const id=await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+120,d.y,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('[data-wire-preview]')).toBeHidden();
  await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('pressing_a_plus_keeps_the_handles_on_its_block',async({page})=>{
  const id=await setup(page);await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="right"]'));
  await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2);await page.mouse.down();await page.waitForTimeout(300);await expect(adds(page)).toHaveCount(4);
  await page.mouse.up();await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
});
test('pressing_a_plus_does_not_move_the_handles_to_the_selected_block',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'B'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  const b=await box(page,2);await page.mouse.click(b.x+35,b.y+35);await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="left"]'));
  await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2);await page.mouse.down();await page.waitForTimeout(300);
  await expect(adds(page,1)).toHaveCount(4);await expect(adds(page,2)).toHaveCount(0);await page.mouse.up();
});
test('handles_show_only_under_the_select_tool',async({page})=>{
  await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await expect(dots(page)).toHaveCount(4);
  await page.keyboard.press('KeyR');await expect(dots(page)).toHaveCount(0);await page.keyboard.press('KeyV');await expect(dots(page)).toHaveCount(4);
});
test('delete_and_undo_during_a_drag_change_nothing',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);
  const d=await grabDot(page);await page.mouse.move(d.x+100,d.y,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.keyboard.press('Delete');await page.waitForTimeout(200);expect((await board(page,id)).elements.some((e:{id:number})=>e.id===1)).toBe(true);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-wire-preview]')).toBeHidden();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
  await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('switching_tool_during_a_drag_cancels_it',async({page})=>{
  const id=await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+120,d.y+60,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.keyboard.press('KeyR');await expect(page.locator('[data-wire-preview]')).toBeHidden();await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('focus_leaving_the_canvas_during_a_drag_cancels_it',async({page})=>{
  const id=await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+120,d.y+60,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.locator('[data-tool="hand"]').focus();await expect(page.locator('[data-tool="hand"]')).toBeFocused();await expect(page.locator('[data-wire-preview]')).toBeHidden();await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('a_slipped_click_on_a_plus_still_counts_as_a_click',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:400,y:100,text:'Busy'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="right"]')),p={x:plus.x+plus.width/2,y:plus.y+plus.height/2};await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x,p.y+6,{steps:3});await page.mouse.up();
  await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(4);
  const block=(await board(page,id)).elements.find((e:{id:number})=>e.id===3);expect([block.x,block.y]).toEqual([644,100]);
});
test('handles_hide_during_move_resize_and_marquee',async({page})=>{
  await setup(page);const b=await box(page),all=page.locator('[data-connect]');
  await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+65,b.y+35,{steps:4});await expect(all).toHaveCount(0);await page.mouse.up();await expect(all).toHaveCount(4);
  const se=await bounding(page.locator('[data-handle="se"]'));await page.mouse.move(se.x+se.width/2,se.y+se.height/2);await page.mouse.down();await page.mouse.move(se.x+se.width/2+30,se.y+se.height/2+30,{steps:4});await expect(all).toHaveCount(0);await page.mouse.up();
  // Shift keeps the card selected, so only the marquee gate can hide its dots.
  const c=await box(page);await page.mouse.move(c.x+c.width+150,c.y+c.height+120);await expect(all).toHaveCount(4);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(c.x+c.width+250,c.y+c.height+200,{steps:4});await expect(page.locator('#selection rect[fill="#7e4bb220"]')).toBeVisible();await expect(all).toHaveCount(0);await page.mouse.up();await page.keyboard.up('Shift');
});
test('plus_on_an_image_copies_the_image',async({page})=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'image',x:100,y:400,width:200,height:120,image}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await clickPlus(page,'bottom',2);await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(4);
  const copy=(await board(page,id)).elements.find((e:{id:number})=>e.id===3);expect([copy.kind,copy.image,copy.width,copy.height]).toEqual(['image',image,200,120]);
});
