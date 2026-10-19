import { test, expect, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Библиотека открыта|сохранены/);
  await page.locator('#new-board').click();
  const title = `Popover ${Date.now()}`;
  await page.getByLabel('Название новой доски').fill(title);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.locator('#board-title')).toHaveText(title);
  await expect(page.locator('#status')).toContainText('сохранены');
  return (await page.locator('#canvas').getAttribute('data-board'))!;
}

async function geometry(page: Page) {
  return page.locator('#canvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height,
      camera: document.querySelector('#world')!.getAttribute('transform') };
  });
}

test('sending closes the popup only after acknowledgement for new comments and replies', async ({ page }) => {
  const id = await create(page);
  await page.locator('[data-tool="comment"]').click();
  await page.locator('#canvas').click({ position: { x: 260, y: 220 } });
  const before = await geometry(page);
  await page.keyboard.type('Первое сообщение');
  let release!: () => void;
  let entered = false;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/boards/${id}/apply**`, async route => {
    entered = true; await wait; await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: 'Отправить комментарий', exact: true }).click();
  await expect.poll(() => entered).toBeTruthy();
  await expect(page.locator('#comments')).toBeVisible();
  await expect(page.getByLabel('Комментарий', { exact: true })).toBeDisabled();
  release();
  await expect(page.locator('#comments')).toBeHidden();
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  expect(await geometry(page)).toEqual(before);
  await page.locator('.comment-pin').click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.type('Ответ в ветку');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#comments')).toBeHidden();
  await expect(page.locator('.comment-pin')).toBeFocused();
  const saved = await (await page.request.get(`/api/boards/${id}`)).json();
  expect(saved.comments[0].messages.map((message: { text: string }) => message.text)).toEqual(['Первое сообщение', 'Ответ в ветку']);
  expect(await geometry(page)).toEqual(before);
});

test('a delayed send keeps a different discussion open', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [
      { op: 'comment_create', author: 'user', text: 'Первая ветка', anchor: { type: 'point', x: 300, y: 170 } },
      { op: 'comment_create', author: 'user', text: 'Другая ветка', anchor: { type: 'point', x: 700, y: 170 } },
    ] } });
  await expect(page.locator('.comment-pin')).toHaveCount(2);
  await page.locator('.comment-pin[data-thread="1"]').click();
  await page.keyboard.type('Отправляемый ответ');
  let release!: () => void;
  let entered = false;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/boards/${id}/apply**`, async route => {
    entered = true; await wait; await route.continue();
  }, { times: 1 });
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => entered).toBeTruthy();
  await page.locator('.comment-pin[data-thread="2"]').click();
  await expect(page.locator('#comments-heading')).toHaveText('Комментарий #2');
  release();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeEnabled();
  await expect(page.locator('#comments')).toBeVisible();
  await expect(page.locator('#comments-heading')).toHaveText('Комментарий #2');
  const saved = await (await page.request.get(`/api/boards/${id}`)).json();
  expect(saved.comments[0].messages).toHaveLength(2);
  expect(saved.comments[1].messages).toHaveLength(1);
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#comments')).toBeHidden();
});

test('retry preserves edited text when the previous message was already saved', async ({ page }) => {
  const id = await create(page);
  await page.locator('[data-tool="comment"]').click();
  await page.locator('#canvas').click({ position: { x: 260, y: 220 } });
  await page.keyboard.type('Сохранённое сообщение');
  await page.route(`**/api/boards/${id}/apply**`, async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('button', { name: 'Повторить комментарий', exact: true })).toBeVisible();
  await expect(page.locator('#comments')).toBeVisible();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Сохранённое сообщение');
  await page.getByLabel('Комментарий', { exact: true }).fill('Следующий ответ');
  await page.getByRole('button', { name: 'Повторить комментарий', exact: true }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveValue('Следующий ответ');
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await expect(page.locator('#comments')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#comments')).toBeHidden();
  const saved = await (await page.request.get(`/api/boards/${id}`)).json();
  expect(saved.comments).toHaveLength(1);
  expect(saved.comments[0].messages.map((message: { text: string }) => message.text)).toEqual(['Сохранённое сообщение', 'Следующий ответ']);
});

test('dragging a discussion moves only the popup and retains its position through updates', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [{ op: 'comment_create', author: 'user', text: 'Обсуждение', anchor: { type: 'point', x: 400, y: 170 } }] } });
  const pin = page.locator('.comment-pin');
  await expect(pin).toHaveCount(1);
  const pinPosition = () => page.locator('#comment-pins').evaluate(layer => {
    const box = layer.querySelector('.comment-pin')!.getBoundingClientRect();
    return { x: box.x, y: box.y };
  });
  const pinBefore = await pinPosition();
  const before = await geometry(page);
  const boardBefore = await (await page.request.get(`/api/boards/${id}`)).json();
  await pin.click();
  await page.keyboard.type('Черновик');
  const heading = (await page.locator('#comments .panel-heading').boundingBox())!;
  const popup = (await page.locator('#comments').boundingBox())!;
  await page.mouse.move(heading.x + 70, heading.y + 20);
  await page.mouse.down();
  await page.mouse.move(heading.x + 70 + 24 - popup.x, heading.y + 20 + 90 - popup.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('#comments').boundingBox())!.x).toBeCloseTo(24, 0);
  expect((await page.locator('#comments').boundingBox())!.y).toBeCloseTo(90, 0);
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.type(' ответа');
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveValue('Черновик ответа');
  expect(await pinPosition()).toEqual(pinBefore);
  expect(await geometry(page)).toEqual(before);
  expect(await (await page.request.get(`/api/boards/${id}`)).json()).toEqual(boardBefore);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 1, operations: [{ op: 'comment_reply', threadId: 1, author: 'user', text: 'Новое сообщение', submitForReview: false }] } });
  await expect(page.locator('#comment-content')).toContainText('Новое сообщение');
  expect((await page.locator('#comments').boundingBox())!.x).toBeCloseTo(24, 0);
  expect((await page.locator('#comments').boundingBox())!.y).toBeCloseTo(90, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#comments')).toBeHidden();
});

test('dragging a new comment keeps its original anchor and clamps the popup to the viewport', async ({ page }) => {
  const id = await create(page);
  await page.locator('[data-tool="comment"]').click();
  await page.locator('#canvas').click({ position: { x: 260, y: 220 } });
  await page.keyboard.type('Исходная точка');
  const before = await geometry(page);
  const heading = (await page.locator('#comments .panel-heading').boundingBox())!;
  await page.mouse.move(heading.x + 70, heading.y + 20);
  await page.mouse.down();
  await page.mouse.move(-150, -150, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('#comments').boundingBox())!.x).toBeCloseTo(12, 0);
  expect((await page.locator('#comments').boundingBox())!.y).toBeCloseTo(12, 0);
  await expect(page.getByLabel('Комментарий', { exact: true })).toBeFocused();
  await page.locator('#comments-heading').focus();
  await page.keyboard.press('ArrowRight');
  expect((await page.locator('#comments').boundingBox())!.x).toBeCloseTo(22, 0);
  await page.getByRole('button', { name: 'Отправить комментарий', exact: true }).click();
  await expect(page.locator('#comments')).toBeHidden();
  const saved = await (await page.request.get(`/api/boards/${id}`)).json();
  expect(saved.comments[0].anchor).toEqual({ type: 'point', x: 180, y: 150 });
  expect(await geometry(page)).toEqual(before);
});

test('resolved discussion never leaves a pin even while selected or shown in the archive', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [{ op: 'comment_create', author: 'user', text: 'Завершённая задача', anchor: { type: 'point', x: 400, y: 170 } }] } });
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  const before = await geometry(page);
  await page.locator('.comment-pin').click();
  await page.getByRole('button', { name: 'Отметить решённым', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть снова', exact: true })).toBeVisible();
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#comments')).toBeHidden();
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await page.locator('#comments-open').click();
  await page.locator('[data-comment-filter="resolved"]').click();
  await page.locator('.thread-row').filter({ hasText: 'Завершённая задача' }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть снова', exact: true }).click();
  await expect(page.locator('.comment-pin.open')).toHaveCount(1);
  expect(await geometry(page)).toEqual(before);
});

test('all pins can be hidden persistently while discussions stay accessible', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [
      { op: 'comment_create', author: 'user', text: 'Первая задача', anchor: { type: 'point', x: 400, y: 170 } },
      { op: 'comment_create', author: 'user', text: 'Вторая задача', anchor: { type: 'point', x: 450, y: 220 } },
    ] } });
  await expect(page.locator('.comment-pin')).toHaveCount(2);
  const before = await geometry(page);
  const boardBefore = await (await page.request.get(`/api/boards/${id}`)).json();
  await page.locator('#comments-open').click();
  await page.getByRole('button', { name: 'Скрыть метки на схеме', exact: true }).click();
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await expect(page.locator('.thread-row')).toHaveCount(2);
  await page.locator('.thread-row').filter({ hasText: 'Первая задача' }).click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await geometry(page)).toEqual(before);
  expect(await (await page.request.get(`/api/boards/${id}`)).json()).toEqual(boardBefore);
  await page.reload();
  await expect(page.locator('#comments-count')).toHaveText('2');
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 1, operations: [{ op: 'rename', title: 'Обновление при скрытых метках' }] } });
  await expect(page.locator('#board-title')).toHaveText('Обновление при скрытых метках');
  await expect(page.locator('.comment-pin')).toHaveCount(0);
  await page.locator('#comments-open').click();
  await page.getByRole('button', { name: 'Показать метки на схеме', exact: true }).click();
  await expect(page.locator('.comment-pin')).toHaveCount(2);
});

test('new comment opens beside click without moving canvas and focuses input', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [{ op: 'create', element: { kind: 'rectangle', x: 120, y: 170 } }] } });
  await expect(page.locator('#scene [data-id="1"]')).toBeVisible();
  const block = (await page.locator('#scene [data-id="1"]').boundingBox())!;
  const click = { x: block.x + 40, y: block.y + 40 };
  await page.locator('[data-tool="comment"]').click();
  const before = await geometry(page);
  await page.mouse.click(click.x, click.y);
  const input = page.getByLabel('Комментарий', { exact: true });
  await expect(input).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  const popup = (await page.locator('#comments').boundingBox())!;
  expect(popup.x).toBeCloseTo(click.x + 14, 0);
  expect(popup.y).toBeCloseTo(click.y + 14, 0);
  await page.keyboard.type('Можно сразу писать');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#comments')).toBeHidden();
  const saved = await (await page.request.get(`/api/boards/${id}`)).json();
  expect(saved.comments[0].messages[0].text).toBe('Можно сразу писать');
  expect(await geometry(page)).toEqual(before);
});

test('pin discussion focuses reply and keeps camera still through typing and updates', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [{ op: 'comment_create', author: 'user', text: 'Обсуждение', anchor: { type: 'point', x: 400, y: 170 } }] } });
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  const before = await geometry(page);
  await page.locator('.comment-pin').click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  await page.keyboard.type('Черновик');
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 1, operations: [{ op: 'comment_reply', threadId: 1, author: 'codex', text: 'Ответ агента', submitForReview: true }] } });
  await expect(page.locator('#comment-content')).toContainText('Ответ агента');
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.type(' ответа');
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveValue('Черновик ответа');
  await page.mouse.click(before.x + 80, before.y + before.height - 100);
  await expect(page.locator('#comments')).toBeHidden();
  await page.locator('.comment-pin').click();
  await expect(page.getByLabel('Ответ', { exact: true })).toHaveValue('Черновик ответа');
  expect(await geometry(page)).toEqual(before);
});

test('global list and offscreen discussion never reposition the canvas', async ({ page }) => {
  const id = await create(page);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' },
    data: { revision: 0, operations: [{ op: 'comment_create', author: 'user', text: 'За экраном', anchor: { type: 'point', x: 6000, y: 4000 } }] } });
  await expect(page.locator('#comments-count')).toHaveText('1');
  const before = await geometry(page);
  await page.locator('#comments-open').click();
  expect(await geometry(page)).toEqual(before);
  await page.locator('.thread-row').click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  await expect(page.locator('#comments-close')).toBeInViewport();
});

test('long discussion opens with reply field and send button visible and focused', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  const id = await create(page);
  const operations = [{ op: 'comment_create', author: 'user', text: 'Длинное обсуждение', anchor: { type: 'point', x: 100, y: 170 } },
    ...Array.from({ length: 12 }, (_, n) => ({ op: 'comment_reply', threadId: 1, author: 'user', text: `Сообщение ${n}: ${'Подробности обсуждения. '.repeat(10)}`, submitForReview: false }))];
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' }, data: { revision: 0, operations } });
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  const before = await geometry(page);
  await page.locator('.comment-pin').click();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Ответ', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Отправить комментарий', exact: true })).toBeInViewport();
  await page.keyboard.type('Видимый ответ');
  expect(await geometry(page)).toEqual(before);
});

test('global list keeps reading position when a new comment arrives', async ({ page }) => {
  const id = await create(page);
  const operations = Array.from({ length: 24 }, (_, n) => ({ op: 'comment_create', author: 'user', text: `Обсуждение ${n}`, anchor: { type: 'point', x: 100, y: n * 50 } }));
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' }, data: { revision: 0, operations } });
  await expect(page.locator('#comments-count')).toHaveText('24');
  await page.locator('#comments-open').click();
  const content = page.locator('#comment-content');
  await content.evaluate(el => { el.scrollTop = 180; });
  expect(await content.evaluate(el => el.scrollTop)).toBe(180);
  await page.request.post(`/api/boards/${id}/apply`, { headers: { Origin: 'http://127.0.0.1:19843' }, data: { revision: 1,
    operations: [{ op: 'comment_create', author: 'user', text: 'Новое обсуждение', anchor: { type: 'point', x: 200, y: 200 } }] } });
  await expect(page.locator('.thread-row')).toHaveCount(25);
  expect(await content.evaluate(el => el.scrollTop)).toBe(180);
});

for (const width of [1440, 375]) {
  test(`popup stays within viewport near every corner at ${width}px and restores new draft`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await create(page);
    const before = await geometry(page);
    for (const corner of [{ x: 30, y: 140 }, { x: before.width - 25, y: 140 },
      { x: 30, y: before.height - 90 }, { x: before.width - 25, y: before.height - 90 }]) {
      await page.locator('[data-tool="comment"]').click();
      await page.locator('#canvas').click({ position: corner });
      await expect(page.getByLabel('Комментарий', { exact: true })).toBeFocused();
      const box = (await page.locator('#comments').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(12);
      expect(box.y).toBeGreaterThanOrEqual(12);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 11);
      expect(box.y + box.height).toBeLessThanOrEqual(801);
      expect(await geometry(page)).toEqual(before);
      await page.keyboard.press('Escape');
    }
    await page.locator('[data-tool="comment"]').click();
    await page.locator('#canvas').click({ position: { x: 100, y: 240 } });
    await page.keyboard.type('Сохранить черновик');
    await page.keyboard.press('Escape');
    await page.locator('[data-tool="comment"]').click();
    await page.locator('#canvas').click({ position: { x: 100, y: 240 } });
    await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Сохранить черновик');
    await expect(page.getByLabel('Комментарий', { exact: true })).toBeFocused();
  });
}
