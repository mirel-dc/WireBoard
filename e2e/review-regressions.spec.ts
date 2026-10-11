import {test,expect} from '@playwright/test';
import {setup,board,box,drag} from './ux-helpers';
test('property_axes_preserve_the_other_saved_axis',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.locator('#properties-open').click();
  await page.getByLabel('Ширина',{exact:true}).fill('299');await page.getByLabel('Ширина',{exact:true}).press('ArrowUp');await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  await page.getByLabel('Высота',{exact:true}).fill('149');await page.getByLabel('Высота',{exact:true}).press('ArrowUp');await expect.poll(async()=>(await board(page,id)).revision).toBe(3);
  const e=(await board(page,id)).elements[0];expect([e.width,e.height]).toEqual([300,150]);
});
test('truncated_committed_body_requires_receipt_confirmation',async({page})=>{
  const id=await setup(page);await page.route(`**/api/boards/${id}/apply`,async route=>{await route.fetch();await route.fulfill({status:200,contentType:'application/json',body:'{'});});
  await drag(page,40,0);await expect(page.locator('#operation-dialog')).toBeVisible();await expect(page.locator('#operation-discard')).toBeDisabled();await page.locator('#operation-retry').click();await expect(page.locator('#operation-dialog')).not.toBeVisible();
  expect((await board(page,id)).revision).toBe(2);expect((await board(page,id)).elements[0].x).toBe(140);
});
test('confirmed_lost_text_ack_closes_the_submitted_draft',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Recovered text');
  await page.route(`**/api/boards/${id}/apply`,async route=>{await route.fetch();await route.abort('failed');});await page.locator('#draft-save').click();await expect(page.locator('#operation-dialog')).toBeVisible();await page.locator('#operation-retry').click();
  await expect(page.locator('#text-dialog')).not.toBeVisible();expect((await board(page,id)).elements[0].text).toBe('Recovered text');expect((await board(page,id)).revision).toBe(2);
});
test('older_text_ack_does_not_close_a_new_draft',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Submitted A');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/api/boards/${id}/apply`,async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
  await page.locator('#draft-save').click();await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await page.locator('#draft-cancel').click();await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Unsaved B');release();await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await expect(page.locator('#text-draft')).toBeVisible();await expect(page.locator('#text-draft')).toHaveValue('Unsaved B');expect((await board(page,id)).elements[0].text).toBe('Submitted A');
});
test('typing_after_save_keeps_the_newer_text_draft',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Submitted');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/api/boards/${id}/apply`,async route=>{const response=await route.fetch();await held;await route.fulfill({response});});await page.locator('#draft-save').click();await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await page.locator('#text-draft').fill('Newer unsaved');release();await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await expect(page.locator('#text-draft')).toBeVisible();await expect(page.locator('#text-draft')).toHaveValue('Newer unsaved');expect((await board(page,id)).elements[0].text).toBe('Submitted');
});
