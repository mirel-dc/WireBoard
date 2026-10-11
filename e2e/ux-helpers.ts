import {expect,type Page,type Locator} from '@playwright/test';
export async function setup(page:Page) {
  await page.goto('/');await expect(page.locator('#status')).toContainText(/Библиотека открыта|сохранены/);
  await page.locator('#new-board').click();const title=`UX ${Date.now()}-${Math.random()}`;
  await page.locator('#create-title').fill(title);await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#board-title')).toHaveText(title);const id=(await page.locator('#canvas').getAttribute('data-board'))!;
  await apply(page,id,0,[{op:'create',element:{kind:'rectangle',x:100,y:100,text:'Card'}}]);
  await expect(page.locator('#scene [data-id="1"]')).toBeVisible();await expect(page.locator('#status')).toContainText('сохранены');
  return id;
}
export async function board(page:Page,id:string){return (await page.request.get(`/api/boards/${id}`)).json();}
export async function apply(page:Page,id:string,revision:number,operations:unknown[]){
  const r=await page.request.post(`/api/boards/${id}/apply`,{headers:{Origin:'http://127.0.0.1:19843'},data:{revision,operations}});expect(r.ok()).toBeTruthy();return r.json();
}
export async function box(page:Page,id=1){let result={x:0,y:0,width:0,height:0};await expect.poll(async()=>{result=await page.locator(`#scene [data-id="${id}"]`).evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};});return result.width;}).toBeGreaterThan(0);return result;}
export async function bounding(locator:Locator){let result={x:0,y:0,width:0,height:0};await expect.poll(async()=>{result=await locator.evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};});return result.width;}).toBeGreaterThan(0);return result;}
export async function drag(page:Page,dx:number,dy:number,id=1){
  const b=await box(page,id);await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+35+dx,b.y+35+dy,{steps:5});await page.mouse.up();
}
