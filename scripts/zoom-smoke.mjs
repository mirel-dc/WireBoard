// Run in a separate process so Playwright Test's device emulation cannot override browser zoom.
import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=`work/ux-zoom-${Date.now()}`;
await mkdir(`${root}/Default`,{recursive:true});
await writeFile(`${root}/Default/Preferences`,JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
const runtime=JSON.parse(await readFile('work/e2e-data/runtime.json','utf8'));
const context=await chromium.launchPersistentContext(root,{channel:'chromium',viewport:null,args:['--window-size=1440,1000']});
try{
  const page=context.pages()[0];

  await page.goto(runtime.endpoint);await expect(page.locator('#status')).toContainText(/Библиотека открыта|сохранены/);
  const metrics=await page.evaluate(()=>({dpr:devicePixelRatio,inner:innerWidth,outer:outerWidth}));
  expect(metrics.dpr).toBeCloseTo(2);expect(metrics.inner).toBeLessThan(metrics.outer*.6);
  await page.locator('#new-board').click();await page.locator('#create-title').fill('Zoom 200% UX');await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#board-title')).toHaveText('Zoom 200% UX');
  await page.locator('[data-tool="rectangle"]').click();await page.locator('#canvas').click({position:{x:220,y:170}});await expect(page.locator('#scene [data-id="1"]')).toBeVisible();await expect(page.locator('#status')).toContainText('сохранены');
  const shape=page.locator('#scene [data-id="1"] > rect');await shape.click();await expect(page.locator('[data-handle]')).toHaveCount(8);
  for(const name of ['n','ne','e','se','s','sw','w','nw']){let b;await expect.poll(async()=>{b=await page.locator(`[data-handle="${name}"] > rect`).first().boundingBox();return b?.width??0;}).toBeGreaterThanOrEqual(23.9);expect(b.height).toBeGreaterThanOrEqual(23.9);}
  await expect(page.locator('#undo')).toBeInViewport();
  let h;await expect.poll(async()=>{h=await page.locator('[data-handle="e"] > rect').first().boundingBox();return h?.width??0;}).toBeGreaterThan(0);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+40,h.y+h.height/2);await page.mouse.up();await expect(shape).toHaveAttribute('width','260');await expect(page.locator('#status')).toContainText('сохранены');await page.locator('#undo').click();await expect(shape).toHaveAttribute('width','220');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`${root}/zoom-200.png`});const report={passed:true,metrics,root,checks:['real browser zoom 200%','eight 24px handles','edge resize','own Undo','no horizontal overflow']};await writeFile(`${root}/verification.json`,JSON.stringify(report));console.log(JSON.stringify(report));
}finally{await context.close();}
