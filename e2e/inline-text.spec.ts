import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
import {projectScene} from '../frontend/src/preview';
const editor=(page:Page)=>page.locator('#text-editor');
async function open(page:Page,id=1){const b=await box(page,id);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await expect(editor(page)).toBeVisible();}
async function camera(page:Page){return page.locator('#world').evaluate(e=>{const m=(e as SVGGElement).transform.baseVal.consolidate()!.matrix;return{x:m.e,y:m.f,zoom:m.a};});}
async function wheel(page:Page,init:WheelEventInit){await page.locator('#canvas').evaluate(async(e,init)=>{e.dispatchEvent(new WheelEvent('wheel',{...init,bubbles:true,cancelable:true}));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));},init);}
test('double_click_edits_inside_the_block',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.dblclick(b.x+35,b.y+35);
  await expect(editor(page)).toBeVisible();await expect(page.locator('#text-dialog')).toHaveCount(0);
  const e=await bounding(editor(page));for(const k of ['x','y','width','height'] as const)expect(Math.abs(e[k]-b[k])).toBeLessThanOrEqual(1.5);
  await expect(page.locator('#scene [data-id="1"] text')).toHaveCount(0);await expect(page.locator('[data-handle="e"]')).toBeHidden();
  await expect(page.locator('#text-draft')).toBeFocused();await page.keyboard.type(' plus');await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Card plus');await expect(page.locator('#scene [data-id="1"]')).toContainText('Card plus');
});
test('enter_in_the_title_splits_the_card',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#title-draft').click();await page.keyboard.type('AB');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
  await expect(page.locator('#title-draft')).toHaveValue('A');await expect(page.locator('#text-draft')).toHaveValue('B\nCard');await expect(page.locator('#text-draft')).toBeFocused();
  await page.keyboard.press('Escape');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.title,e.text];}).toEqual(['A','B\nCard']);
});
test('backspace_at_the_description_start_joins_the_title',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{title:'A',text:'B\nCard'}}]);await expect(page.locator('#scene [data-id="1"]')).toContainText('Card');
  await open(page);await page.locator('#text-draft').evaluate(t=>(t as HTMLTextAreaElement).setSelectionRange(0,0));await page.keyboard.press('Backspace');
  await expect(page.locator('#title-draft')).toHaveValue('AB');await expect(page.locator('#text-draft')).toHaveValue('Card');await expect(page.locator('#title-draft')).toBeFocused();
  await page.keyboard.press('Escape');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.title,e.text];}).toEqual(['AB','Card']);
});
test('multi_line_paste_into_the_title_moves_the_rest_down',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#title-draft').focus();
  await page.locator('#title-draft').evaluate(t=>{const event=new ClipboardEvent('paste',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true});event.clipboardData!.setData('text/plain','Заголовок\r\nпервая строка');t.dispatchEvent(event);});
  await expect(page.locator('#title-draft')).toHaveValue('Заголовок');await expect(page.locator('#text-draft')).toHaveValue('первая строка\nCard');
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements[0].title).toBe('Заголовок');
});
test('typing_grows_the_block_and_one_undo_reverts_text_and_height',async({page})=>{
  const id=await setup(page);const before=await box(page);await open(page);await page.locator('#text-draft').fill('Длинное описание '.repeat(20));
  await expect.poll(async()=>(await box(page)).height).toBeGreaterThan(before.height+20);
  expect(Math.abs((await bounding(editor(page))).height-(await box(page)).height)).toBeLessThanOrEqual(1.5);
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).revision).toBe(2);expect((await board(page,id)).elements[0].height).toBeGreaterThan(112);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).revision).toBe(3);const e=(await board(page,id)).elements[0];expect([e.text,e.height]).toEqual(['Card',112]);
});
test('unchanged_text_sends_nothing',async({page})=>{
  const id=await setup(page);await open(page);await page.keyboard.press('Escape');await expect(editor(page)).toBeHidden();await page.waitForTimeout(200);
  expect((await board(page,id)).revision).toBe(1);await expect(page.locator('#undo')).toBeDisabled();
});
test('clicking_another_block_saves_and_selects_it',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'Second'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await open(page);await page.locator('#text-draft').fill('Saved by click');const second=await box(page,2);await page.mouse.click(second.x+35,second.y+35);
  await expect(editor(page)).toBeHidden();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Saved by click');
  const handle=await bounding(page.locator('[data-handle="e"]'));expect(handle.x).toBeGreaterThan(second.x+second.width/2);
});
test('editor_follows_wheel_pan_and_zoom',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Черновик');const start=await bounding(editor(page));
  await wheel(page,{deltaX:25,deltaY:35});await expect.poll(async()=>(await bounding(editor(page))).x).toBeCloseTo(start.x-25,0);
  await wheel(page,{deltaY:-100,ctrlKey:true,clientX:start.x,clientY:start.y});
  await expect.poll(async()=>{const e=await bounding(editor(page)),b=await box(page);return Math.abs(e.width-b.width)+Math.abs(e.x-b.x)+Math.abs(e.y-b.y);}).toBeLessThanOrEqual(3);
  await expect(page.locator('#text-draft')).toHaveValue('Черновик');await expect(page.locator('#text-draft')).toBeFocused();expect((await board(page,id)).revision).toBe(1);
});
test('window_blur_keeps_the_draft_open',async({page})=>{
  const id=await setup(page);await open(page);const text='Длинное описание '.repeat(20);await page.locator('#text-draft').fill(text);
  await expect.poll(async()=>(await box(page)).height).toBeGreaterThan(150);const grown=(await box(page)).height;
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await expect(editor(page)).toBeVisible();await expect(page.locator('#text-draft')).toHaveValue(text);expect((await box(page)).height).toBeCloseTo(grown,0);expect((await board(page,id)).revision).toBe(1);
});
test('delete_keys_in_the_field_keep_the_block',async({page})=>{
  const id=await setup(page);await open(page);await page.keyboard.press('Delete');await page.keyboard.press('Backspace');await expect(page.locator('#text-draft')).toHaveValue('Car');
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.map((e:{text:string})=>e.text)).toEqual(['Car']);
});
test('composition_keys_do_not_commit_or_split',async({page})=>{
  const id=await setup(page);await open(page);
  await page.locator('#text-draft').dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true});await expect(editor(page)).toBeVisible();
  await page.locator('#title-draft').fill('AB');await page.locator('#title-draft').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true});
  await expect(page.locator('#title-draft')).toHaveValue('AB');await expect(page.locator('#text-draft')).toHaveValue('Card');expect((await board(page,id)).revision).toBe(1);
});
test('agent_text_change_while_typing_offers_replace',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Мой текст');
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Агент'}}]);await expect(page.locator('#status')).toContainText('черновик');
  await page.locator('#text-draft').press('Escape');const bar=page.locator('#text-conflict');await expect(bar).toBeVisible();await expect(bar).toContainText('Текст изменился в другом клиенте');
  await expect(page.locator('#text-draft')).toHaveValue('Мой текст');await expect(page.locator('#operation-dialog')).not.toBeVisible();
  await page.locator('#text-draft').press('Escape');await expect(bar).toBeVisible();
  await page.locator('#text-replace').click();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Мой текст');
  await expect(bar).toBeHidden();await expect(editor(page)).toBeHidden();
});
test('agent_text_change_can_be_kept_by_cancelling',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Мой текст');
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Агент'}}]);await expect(page.locator('#status')).toContainText('черновик');
  await page.locator('#text-draft').press('Escape');await expect(page.locator('#text-conflict')).toBeVisible();
  await page.locator('#text-discard').click();await expect(editor(page)).toBeHidden();await expect(page.locator('#text-conflict')).toBeHidden();
  await expect(page.locator('#scene [data-id="1"]')).toContainText('Агент');await page.waitForTimeout(200);const b=await board(page,id);expect([b.revision,b.elements[0].text]).toEqual([2,'Агент']);
});
test('agent_deleting_the_block_closes_the_editor',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Пропадёт');await apply(page,id,1,[{op:'delete',ids:[1]}]);
  await expect(editor(page)).toBeHidden();await expect(page.locator('#toast')).toContainText('Объект удалён другим клиентом');
});
test('editor_fields_line_up_with_the_layout',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{title:'Заголовок',text:'Описание'}}]);await expect(page.locator('#scene [data-id="1"]')).toContainText('Описание');
  const metrics=await (await page.request.get('/api/layout-metrics')).json(),title=projectScene(await board(page,id),metrics).elements[0].title[0];
  await open(page);const field=await bounding(page.locator('#title-draft')),canvas=await bounding(page.locator('#canvas')),cam=await camera(page);
  expect(Math.abs(field.y-(canvas.y+cam.y+(title.y-title.size)*cam.zoom))).toBeLessThanOrEqual(2);
});
test('agent_deleting_the_block_during_a_conflict_clears_it',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Мой текст');
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Агент'}}]);await expect(page.locator('#status')).toContainText('черновик');
  await page.locator('#text-draft').press('Escape');await expect(page.locator('#text-conflict')).toBeVisible();
  await apply(page,id,2,[{op:'delete',ids:[1]}]);
  await expect(editor(page)).toBeHidden();await expect(page.locator('#text-conflict')).toBeHidden();await expect(page.locator('#toast')).toContainText('Объект удалён другим клиентом');
  await expect(page.locator('#operation-return')).toBeHidden();
  await apply(page,id,3,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'Next'}}]);
  const next=(await board(page,id)).elements[0].id;await expect(page.locator(`#scene [data-id="${next}"]`)).toBeVisible();
  await open(page,next);await page.locator('#text-draft').fill('Saved');await page.keyboard.press('Escape');
  await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Saved');
});
