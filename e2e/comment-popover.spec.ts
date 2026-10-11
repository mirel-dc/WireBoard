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
  await expect(page.locator('#comment-content')).toContainText('Можно сразу писать');
  await expect(page.getByLabel('Ответ', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#comments')).toBeHidden();
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
