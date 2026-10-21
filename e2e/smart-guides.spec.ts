import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
const guides=(page:Page,type:string,axis?:string)=>page.locator(axis?`[data-guide="${type}"][data-axis="${axis}"]`:`[data-guide="${type}"]`);
const element=async(page:Page,id:string,n:number)=>(await board(page,id)).elements.find((e:{id:number})=>e.id===n);
async function add(page:Page,id:string,elements:unknown[],last:number){await apply(page,id,1,elements);await expect(page.locator(`#scene [data-id="${last}"]`)).toBeVisible();}
// Presses block n 35px inside its corner and moves the pointer by (dx,dy) screen pixels, leaving the button down.
async function press(page:Page,n:number,dx:number,dy:number){const b=await box(page,n);await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+35+dx,b.y+35+dy,{steps:8});}
test('moving_snaps_a_left_edge_to_a_neighbour_and_shows_a_guide',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);await expect(guides(page,'align','y')).toHaveCount(0);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);expect((await element(page,id,1)).y).toBe(100);await expect(guides(page,'align')).toHaveCount(0);
});
test('moving_snaps_a_centre_to_a_neighbour_centre',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,444,0);await page.mouse.up();await expect.poll(async()=>(await element(page,id,1)).x).toBe(540);
});
test('a_group_snaps_by_its_common_bounds',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:100,y:300,text:'B'}},{op:'create',element:{kind:'rectangle',x:900,y:500,text:'C'}}],3);
  const a=await box(page,1),c=await box(page,2);await page.mouse.click(a.x+35,a.y+35);await page.keyboard.down('Shift');await page.mouse.click(c.x+35,c.y+35);await page.keyboard.up('Shift');
  await press(page,1,797,0);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(900);expect((await element(page,id,2)).x).toBe(900);
});
test('a_block_between_two_neighbours_snaps_to_equal_gaps',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:700,y:100,text:'B'}},{op:'create',element:{kind:'rectangle',x:300,y:400,text:'C'}}],3);
  await press(page,3,103,-300);await expect(guides(page,'gap','x')).toHaveCount(2);await expect(guides(page,'gap','x').first()).toContainText('80');await expect(guides(page,'gap','x').last()).toContainText('80');await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,3)).x).toBe(400);
});
test('a_block_repeats_the_step_of_its_row',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:100,text:'B'}},{op:'create',element:{kind:'rectangle',x:100,y:400,text:'C'}}],3);
  await press(page,3,603,-300);await expect(guides(page,'gap','x')).toHaveCount(2);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,3)).x).toBe(700);
});
test('snapping_still_drops_a_block_into_a_frame',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'frame',x:500,y:300,width:400,height:300,text:'F'}}],2);
  await press(page,1,403,320);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);const card=await element(page,id,1);expect([card.y,card.parentFrameId]).toEqual([420,2]);
});
test('a_moved_frame_is_not_pulled_by_its_own_children',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'frame',x:100,y:300,width:400,height:300,text:'F'}},{op:'create',element:{kind:'rectangle',x:150,y:350,text:'Child'}},{op:'update',id:3,patch:{parentFrameId:2}}],3);
  const header=await bounding(page.locator('#scene [data-id="2"] [data-frame-header-hit]'));
  await page.mouse.move(header.x+header.width/2,header.y+header.height/2);await page.mouse.down();await page.mouse.move(header.x+header.width/2+47,header.y+header.height/2,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,2)).x).toBe(147);expect((await element(page,id,3)).x).toBe(197);
});
test('a_click_or_a_tiny_press_near_a_neighbour_line_moves_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:103,y:400,width:300,height:112,text:'B'}}],2);
  const b=await box(page,1);await page.mouse.click(b.x+35,b.y+35);await press(page,1,2,0);await page.mouse.up();await page.waitForTimeout(300);
  const doc=await board(page,id);expect(doc.revision).toBe(2);expect(doc.elements.find((e:{id:number})=>e.id===1).x).toBe(100);
});
test('alt_moves_freely_repaints_without_moving_and_never_reaches_the_browser',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await page.evaluate(()=>{const w=window as unknown as {altPrevented:boolean[]};w.altPrevented=[];addEventListener('keyup',e=>{if(e.key==='Alt')w.altPrevented.push(e.defaultPrevented);});});
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);
  await page.keyboard.down('Alt');await expect(guides(page,'align')).toHaveCount(0);
  await page.keyboard.up('Alt');await expect(guides(page,'align','x')).toHaveCount(1);
  await page.keyboard.down('Alt');await page.mouse.up();await page.keyboard.up('Alt');
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(503);
  expect(await page.evaluate(()=>(window as unknown as {altPrevented:boolean[]}).altPrevented)).toEqual([true,true]);
});
test('window_blur_during_a_move_clears_guides_and_moves_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(2);
});
test('escape_clears_guides_and_one_undo_reverts_a_snapped_move',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.keyboard.press('Escape');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(2);
  await press(page,1,403,0);await page.mouse.up();await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await element(page,id,1)).x).toBe(100);
});
// Selects card 1, holds `hold` if given, presses its resize handle and moves the pointer by (dx,dy), leaving the button down. A Shift-click would deselect the card, so the key goes down after the click.
async function grabHandle(page:Page,handle:string,dx:number,dy:number,hold?:string){const b=await box(page,1);await page.mouse.click(b.x+35,b.y+35);const h=await bounding(page.locator(`[data-handle="${handle}"]`)),x=h.x+h.width/2,y=h.y+h.height/2;if(hold)await page.keyboard.down(hold);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});}
test('resizing_snaps_an_edge_to_a_neighbour_edge',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:300,text:'B'}}],2);
  await grabHandle(page,'se',77,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(300);const card=await element(page,id,1);expect([card.x,card.height]).toEqual([100,112]);
});
test('resizing_matches_a_neighbour_size_and_marks_both_blocks',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:300,width:300,height:150,text:'B'}}],2);
  await grabHandle(page,'e',77,0);await expect(guides(page,'size','x')).toHaveCount(2);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(300);
});
test('alt_and_shift_resize_without_snapping',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:300,text:'B'}}],2);
  await grabHandle(page,'e',77,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.keyboard.down('Alt');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.keyboard.up('Alt');
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(297);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await element(page,id,1)).width).toBe(220);
  await grabHandle(page,'e',77,0,'Shift');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.keyboard.up('Shift');
  await expect.poll(async()=>(await element(page,id,1)).width).toBeCloseTo(297,3);
});
test('pressing_a_handle_without_moving_near_a_neighbour_line_changes_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:323,y:300,text:'B'}}],2);
  await grabHandle(page,'e',0,0);await page.mouse.up();await page.waitForTimeout(300);
  const doc=await board(page,id);expect(doc.revision).toBe(2);expect(doc.elements.find((e:{id:number})=>e.id===1).width).toBe(220);
});
