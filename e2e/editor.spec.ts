import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
const exec = promisify(execFile);
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Библиотека открыта|сохранены/);
});
const exe = process.platform === 'win32' ? 'target/debug/wireboard.exe' : 'target/debug/wireboard';
async function newBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новая доска', exact: true }).click();
  const title = `Проверка ${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.getByLabel('Название новой доски').fill(title);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#board-title')).toHaveText(title);
  return await page.locator('#canvas').getAttribute('data-board');
}
async function board(page: Page, id: string | null) { return (await page.request.get(`/api/boards/${id}`)).json(); }

test('editor commits blocks, connector, text, movement and history to real Rust', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const id = await newBoard(page);
  await page.getByRole('button', { name: 'Блок (R)', exact: true }).click(); await page.locator('#canvas').click({ position: { x: 200, y: 180 } });
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(1);
  await page.getByRole('button', { name: 'Блок (R)', exact: true }).click(); await page.locator('#canvas').click({ position: { x: 600, y: 180 } });
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(2);
  await page.getByRole('button', { name: 'Связь (L)', exact: true }).click();
  await page.locator('[data-id="1"]').first().click(); await page.locator('[data-id="2"]').first().click();
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(3);
  await page.getByRole('button', { name: 'Выделение (V)', exact: true }).click();
  await page.locator('[data-id="1"]').first().dblclick(); await page.getByLabel('Текст объекта').fill('Кириллица и <script>');
  await page.getByRole('button', { name: 'Сохранить текст', exact: true }).click();
  await expect.poll(async () => (await board(page, id)).elements[0].text).toBe('Кириллица и <script>');
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await expect(page.locator('#scene [data-id="1"]')).toBeVisible();
  const before = await board(page, id); const box = await page.locator('#scene [data-id="1"]').evaluate(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; }); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 40, box!.y + 35); await page.mouse.down(); await page.mouse.move(box!.x + 120, box!.y + 75, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await board(page, id)).elements[0].x).not.toBe(before.elements[0].x);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(async () => (await board(page, id)).elements[0].x).toBe(before.elements[0].x);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(async () => (await board(page, id)).elements[0].x).not.toBe(before.elements[0].x);
  expect(errors).toEqual([]);
});

test('CLI updates through SSE and remote edit preserves text draft', async ({ page }) => {
  const id = await newBoard(page);
  const library = await (await page.request.get('/api/library')).json();
  const dataDir = dirname(library.path);
  const ops = `work/cli-e2e-${Date.now()}.json`;
  await fs.writeFile(ops, JSON.stringify([{ op: 'create', element: { kind: 'rectangle', x: 100, y: 100, text: 'Из CLI' } }]));
  await exec(exe, ['--data-dir', dataDir, 'apply', id!, '--revision', '0', '--file', ops]);
  await expect(page.locator('#scene')).toContainText('Из CLI');
  await page.locator('[data-id="1"]').first().dblclick(); await page.getByLabel('Текст объекта').fill('Мой черновик');
  await fs.writeFile(ops, JSON.stringify([{ op: 'update', id: 1, patch: { text: 'Изменено агентом' } }]));
  await exec(exe, ['--data-dir', dataDir, 'apply', id!, '--revision', '1', '--file', ops]);
  await expect(page.locator('#status')).toContainText('черновик');
  await expect(page.getByLabel('Текст объекта')).toHaveValue('Мой черновик');
  await page.getByRole('button', { name: 'Сохранить текст', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить на свежей версии', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить на свежей версии', exact: true }).click();
  await expect.poll(async () => (await board(page, id)).elements[0].text).toBe('Мой черновик');
});

test('image, portable JSON import and slide presentation', async ({ page }) => {
  const id = await newBoard(page);
  await page.getByRole('button', { name: 'Слайд (F)', exact: true }).click(); await page.locator('#canvas').click({ position: { x: 200, y: 180 } });
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(1);
  await page.locator('#image-file').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: await page.screenshot({ clip: { x: 0, y: 0, width: 24, height: 24 } }) });
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(2);
  await page.getByRole('button', { name: 'Презентация', exact: true }).click();
  await expect(page.locator('#presentation')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('#presentation')).not.toBeVisible();
  const data = await board(page, id);
  await page.locator('#import-file').setInputFiles({ name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect.poll(async () => page.locator('#canvas').getAttribute('data-board')).not.toBe(id);
  const imported = await board(page, await page.locator('#canvas').getAttribute('data-board'));
  expect(imported.elements).toEqual(data.elements);
  await page.screenshot({ path: `work/editor-${test.info().project.name}.png`, fullPage: true });
});

test('drag merges independent agent text without manual overwrite', async ({ page }) => {
  const id=await newBoard(page);
  await page.getByRole('button',{name:'Блок (R)',exact:true}).click();await page.locator('#canvas').click({position:{x:240,y:230}});
  await expect.poll(async()=>(await board(page,id)).revision).toBe(1);
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await expect(page.locator('#scene [data-id="1"]')).toBeVisible();
  const box=await page.locator('#scene [data-id="1"]').evaluate(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; });const before=await board(page,id);
  await page.mouse.move(box!.x+40,box!.y+30);await page.mouse.down();await page.mouse.move(box!.x+120,box!.y+70,{steps:4});
  const response=await page.request.post(`/api/boards/${id}/apply`,{headers:{Origin:'http://127.0.0.1:19843'},data:{revision:1,operations:[{op:'update',id:1,patch:{text:'От агента'}}]}});expect(response.ok()).toBeTruthy();
  await page.mouse.up();await expect(page.locator('#operation-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await board(page,id)).elements[0].x).not.toBe(before.elements[0].x);
  expect((await board(page,id)).elements[0].text).toBe('От агента');
});

test('focused properties can save repeatedly and native buttons activate with keyboard', async ({page})=>{
  const id=await newBoard(page);await page.getByRole('button',{name:'Блок (R)',exact:true}).click();await page.locator('#canvas').click({position:{x:240,y:230}});
  await expect.poll(async()=>(await board(page,id)).revision).toBe(1);
  await page.getByRole('button',{name:'Свойства',exact:true}).click();
  const color=page.getByLabel('Заливка');await color.focus();await color.evaluate((input:HTMLInputElement)=>{input.value='#e7efda';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(async()=>(await board(page,id)).elements[0].fill).toBe('#e7efda');
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await color.focus();await color.evaluate((input:HTMLInputElement)=>{input.value='#e4eee9';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(async()=>(await board(page,id)).elements[0].fill).toBe('#e4eee9');
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.getByRole('button',{name:'Новая доска',exact:true}).focus();await page.keyboard.press('Space');
  await expect(page.getByLabel('Название новой доски')).toBeVisible();
});

test('camera and selection survive reopening a board', async ({ page }) => {
  const id = await newBoard(page);
  await page.getByRole('button', { name: 'Блок (R)', exact: true }).click();
  await page.locator('#canvas').click({ position: { x: 240, y: 230 } });
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.locator('#zoom-in').click();
  const camera = await page.locator('#world').getAttribute('transform');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  expect(await page.locator('#canvas').getAttribute('data-board')).toBe(id);
  await expect(page.locator('#world')).toHaveAttribute('transform', camera!);
  await page.getByRole('button',{name:'Свойства',exact:true}).click();
  await expect(page.getByLabel('Заливка')).toBeVisible();
});

test('keyboard duplication, resize and confirmed board deletion', async ({ page }) => {
  const id = await newBoard(page);
  await page.getByRole('button', { name: 'Блок (R)', exact: true }).click();
  await page.locator('#canvas').click({ position: { x: 240, y: 230 } });
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.getByRole('button',{name:'Свойства',exact:true}).click();
  await expect(page.getByLabel('Ширина', { exact: true })).toBeVisible();
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await board(page, id)).elements.length).toBe(2);
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.getByLabel('Ширина', { exact: true }).fill('300');
  await page.getByLabel('Ширина', { exact: true }).press('Tab');
  await expect.poll(async () => (await board(page, id)).elements[0].width).toBe(300);
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Выровнять по левому краю', exact: true }).click();
  await expect.poll(async () => { const data = await board(page, id); return data.elements[0].x === data.elements[1].x; }).toBe(true);
  await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  const title = await page.locator('#board-title').textContent();
  if(!await page.locator('#sidebar').isVisible())await page.locator('#toggle-sidebar').click();
  await page.locator('#delete-board').click();
  await page.getByLabel('Название удаляемой доски').fill(title!);
  await page.locator('#delete-form button[type=submit]').click();
  await expect.poll(async () => (await page.request.get(`/api/boards/${id}`)).status()).toBe(404);
});
