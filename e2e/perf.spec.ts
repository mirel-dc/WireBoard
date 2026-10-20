import {test,expect,type Page} from '@playwright/test';
import {setup,apply,box,bounding} from './ux-helpers';
const FRAME_BUDGET_MS=16;
const p90=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.9))];};
type Stats={wireboardFrameStats:number[]};
async function bigBoard(page:Page){
  const id=await setup(page),operations:unknown[]=[];
  for(let i=0;i<239;i++)operations.push({op:'create',element:{kind:'rectangle',x:(i%20)*240,y:300+Math.floor(i/20)*180,width:200,height:112,title:`Блок ${i}`,text:'Описание блока для проверки переноса'}});
  for(let i=0;i<60;i++)operations.push({op:'create',element:{kind:'connector',from:2+i,to:3+i,text:i%3?'':'связь'}});
  let revision=1;for(let i=0;i<operations.length;i+=100)revision=(await apply(page,id,revision,operations.slice(i,i+100))).revision;
  await expect(page.locator('#scene > [data-kind="connector"]')).toHaveCount(60);await expect(page.locator('#status')).toContainText('сохранены');
}
async function frames(page:Page,action:()=>Promise<void>){
  await page.evaluate(()=>{(globalThis as unknown as Stats).wireboardFrameStats.length=0;});await action();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  return page.evaluate(()=>[...(globalThis as unknown as Stats).wireboardFrameStats]);
}
test.describe('smoothness budget on 300 elements',()=>{
  test.skip(({browserName})=>browserName!=='chromium','Budgets are calibrated for Chromium');
  test('drag_resize_pan_zoom_stay_within_the_frame_budget',async({page})=>{
    await bigBoard(page);const b=await box(page);
    const drag=await frames(page,async()=>{await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(b.x+35+i*4,b.y+35+i*2);await page.mouse.up();});
    await page.locator('#scene [data-id="1"]').click();const h=await bounding(page.locator('[data-handle="se"]'));
    const resize=await frames(page,async()=>{await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(h.x+h.width/2+i*3,h.y+h.height/2+i*2);await page.mouse.up();});
    const canvas=(await page.locator('#canvas').boundingBox())!;await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
    const pan=await frames(page,async()=>{for(let i=0;i<30;i++)await page.mouse.wheel(0,40);});
    const zoom=await frames(page,async()=>{await page.keyboard.down('Control');for(let i=0;i<10;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(40);}await page.keyboard.up('Control');await page.waitForTimeout(300);});
    for(const [name,values]of Object.entries({drag,resize,pan,zoom})){expect(values.length,name).toBeGreaterThan(5);expect(p90(values),name).toBeLessThanOrEqual(FRAME_BUDGET_MS);}
  });
  test('drop_handler_and_next_frame_fit_one_frame',async({page})=>{
    await bigBoard(page);const b=await box(page);
    await page.evaluate(()=>{const w=window as unknown as {upStart:number;upEnd:number};addEventListener('pointerup',()=>{w.upStart=performance.now();},{capture:true});addEventListener('pointerup',()=>{w.upEnd=performance.now();});});
    await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+135,b.y+75,{steps:10});
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await page.evaluate(()=>{(globalThis as unknown as Stats).wireboardFrameStats.length=0;});
    await page.mouse.up();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const result=await page.evaluate(()=>{const w=globalThis as unknown as Stats&{upStart:number;upEnd:number};return {handler:w.upEnd-w.upStart,frame:w.wireboardFrameStats[0]??0};});
    expect(result.handler+result.frame).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
  test('typing_in_the_inline_editor_fits_one_frame',async({page})=>{
    await bigBoard(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await expect(page.locator('#text-editor')).toBeVisible();
    await page.evaluate(()=>{const w=window as unknown as {inputs:number[];inputStart:number};w.inputs=[];addEventListener('input',()=>{w.inputStart=performance.now();},{capture:true});addEventListener('input',()=>{w.inputs.push(performance.now()-w.inputStart);});});
    const typing=await frames(page,async()=>{await page.keyboard.type('Длинное описание для проверки роста блока при наборе '.repeat(6),{delay:20});});
    const handlers=await page.evaluate(()=>(window as unknown as {inputs:number[]}).inputs);
    expect(handlers.length).toBeGreaterThan(20);expect(typing.length).toBeGreaterThan(5);expect(p90(handlers)+p90(typing)).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
});
