import {test, expect} from '@playwright/test';

test('plain localhost opens a searchable library and the same board in another browser', async({page,browser})=>{
  await page.goto('/');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#library-location')).toContainText('boards');
  const title=`Библиотека ${Date.now()}`;
  await page.locator('#new-board').click();
  await page.locator('#create-title').fill(title);
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#board-title')).toHaveText(title);
  const url=page.url();
  expect(new URL(url).pathname).toMatch(/^\/b\/biblioteka-/);
  expect(new URL(url).searchParams.has('board')).toBe(false);
  await page.locator('#board-search').fill(title);
  await expect(page.locator('#boards .board-row')).toHaveCount(1);
  const context=await browser.newContext();
  try {
    const other=await context.newPage();
    await other.goto(url);
    await expect(other.locator('#board-title')).toHaveText(title);
    await expect(other.locator('#status')).toContainText('сохранены');
    await other.reload();
    await expect(other.locator('#board-title')).toHaveText(title);
  } finally {await context.close();}
  await page.locator('#board-search').fill('Нет такой доски 000');
  await expect(page.locator('#boards')).toContainText('Доски не найдены');
  await page.locator('#board-search').fill('');
  await expect(page.locator('#boards .board-row')).not.toHaveCount(0);
});

test('legacy UUID links become readable and remain stable after renaming',async({page})=>{
  await page.goto('/');
  const title=`Стабильная ссылка ${Date.now()}`;
  await page.locator('#new-board').click();
  await page.locator('#create-title').fill(title);
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#status')).toContainText('сохранены');
  const id=await page.locator('#canvas').getAttribute('data-board');
  const address=page.url();
  await page.goto(`/?board=${id}`);
  await expect(page.locator('#board-title')).toHaveText(title);
  await expect(page).toHaveURL(address);
  expect(new URL(address).pathname).toMatch(/^\/b\/stabilnaya-ssylka-/);
  await page.locator('#board-title').click();
  await page.locator('#rename-title').fill('Совсем другое имя');
  await page.getByRole('button',{name:'Переименовать',exact:true}).click();
  await expect(page.locator('#board-title')).toHaveText('Совсем другое имя');
  await expect(page).toHaveURL(address);
  await page.reload();
  await expect(page.locator('#board-title')).toHaveText('Совсем другое имя');
  await expect(page).toHaveURL(address);
});

test('an unknown slug keeps the library available without opening a different board',async({page})=>{
  await page.goto('/b/no-such-board-000');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#board-title')).toHaveText('Выберите доску');
  await expect(page.locator('#status')).toContainText('Доска по этой ссылке отсутствует');
});

test('an unavailable board link does not silently open an unrelated board',async({page})=>{
  await page.goto('/?board=00000000-0000-0000-0000-000000000000');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#board-title')).toHaveText('Выберите доску');
  await expect(page.locator('#status')).toContainText('Доска по этой ссылке отсутствует');
});

test('Back keeps a text draft and the address of its board',async({page})=>{
  await page.goto('/?board=00000000-0000-0000-0000-000000000000');
  await expect(page.locator('#board-title')).toHaveText('Выберите доску');
  await page.locator('#new-board').click();
  await page.locator('#create-title').fill(`Черновик ${Date.now()}`);
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#status')).toContainText('сохранены');
  await page.locator('[data-tool="rectangle"]').click();
  await page.locator('#canvas').click({position:{x:200,y:180}});
  await expect(page.locator('#scene [data-id="1"]')).toBeVisible();
  await expect(page.locator('#status')).toContainText('сохранены');
  await page.locator('#scene [data-id="1"]').dblclick();
  await page.locator('#text-draft').fill('Не потерять текст');
  const address=page.url();
  const id=await page.locator('#canvas').getAttribute('data-board');
  await page.goBack();
  await expect(page.locator('#text-draft')).toHaveValue('Не потерять текст');
  await expect(page.locator('#canvas')).toHaveAttribute('data-board',id!);
  await expect(page).toHaveURL(address);
});
