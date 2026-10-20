# Точки и «+» для блоков и связей — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Схема собирается как в Miro: у блока под курсором или выделенного видны четыре точки и четыре «+»; клик по «+» создаёт такой же блок со стрелкой, протягивание из точки соединяет с блоком или создаёт блок там, где отпустил.

**Architecture:** Чистый модуль `placement.ts` считает место нового блока (сбоку со сдвигом до свободного места или у точки отпускания) и собирает операции. `OverlayRenderer` получает постоянные узлы точек и «+» и превью протягиваемой стрелки. `CanvasView` решает, у какого блока показывать ручки. `Interaction` получает жест `connect` (клик по «+» или протягивание). `Editor` создаёт блок и стрелку одной командой через `createObjects` и открывает inline-ввод из этапа 2a.

**Tech Stack:** TypeScript 5.9 без фреймворка, Vite 7, SVG DOM; Playwright (e2e и node-side unit).

**Spec:** `docs/superpowers/specs/2026-10-20-connect-handles-design.md`

## Global Constraints

- Сервер, формат файла доски и CLI-контракт не меняются; новые зависимости не добавляются.
- Числа: зазор от исходного блока `80`, запас при проверке занятости `24`, предел шагов сдвига `50`; точки на `14` px экрана наружу от середины грани, радиус `5`, зона захвата `12`; «+» на `40` px экрана, радиус `11`; ручки скрыты, если блок на экране меньше `40` px по ширине или высоте; порог протягивания `4` px экрана; fade `80` мс, `prefers-reduced-motion: reduce` отключает fade; поле при подъезде камеры `40` px.
- Ручки только у `rectangle`, `text`, `image`; никогда у фрейма, стрелки, при выделении нескольких объектов, во время переноса, ресайза, рамки выделения, превью связи, протягивания и правки текста.
- Метки команд: `Новый блок со связью` (блок + стрелка) и `Новая связь` (только стрелка). Новый блок копирует вид, ширину, высоту, `fill`, `stroke`, `fontSize`, `fontWeight` (и `image` у картинки), текст пустой.
- DOM-атрибуты для тестов: точка `[data-connect="<id>"][data-side="left|right|top|bottom"]`, «+» `[data-add="<id>"][data-side=…]` (атрибут `data-connect`/`data-add` есть только у видимой ручки), превью стрелки `[data-wire-preview]`, подсветка цели — существующий `[data-connector-target="<id>"]`.
- Окончания строк: CRLF в `frontend/src/canvas.ts`, `editor.ts`, `interaction.ts`; LF в `overlay.ts` и новых файлах. Перед коммитом `git diff --stat` — правка строки не должна давать diff всего файла.
- Перед Playwright всегда `npm run build`. Тексты UI — русские, коммиты — английские `<type>: <description>`.

## Review Focus

- Курсор идёт с блока к «+» через пустой зазор и над фреймом-родителем: ручки не должны исчезнуть до клика (тест в Task 2).
- Клик по «+», когда место занято цепочкой блоков: новый блок не пересекает ни одного (unit в Task 1, e2e в Task 3).
- Агент меняет доску, пока команда «+» летит на сервер: редактор нового блока закрывается, показывается диалог очереди, блок агента не трогается (тест в Task 3).
- Отпускание стрелки обратно на исходный блок: ничего не создаётся (тест в Task 4).
- Esc во время протягивания: без команды и без висящего превью (тест в Task 4).

---

## Файлы

- Create `frontend/src/placement.ts`, `e2e/unit/placement.spec.ts`, `e2e/connect-handles.spec.ts`.
- Modify `frontend/src/overlay.ts`, `frontend/src/canvas.ts`, `frontend/src/interaction.ts`, `frontend/src/editor.ts`, `e2e/perf.spec.ts`, `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`.

### Task 1: Расчёт места и операции

**Files:**
- Create: `frontend/src/placement.ts`
- Test: `e2e/unit/placement.spec.ts`

**Interfaces:**
- Consumes: типы `Bounds`, `Element`, `Operation` из `frontend/src/types.ts`.
- Produces: `type Side='left'|'right'|'top'|'bottom'`; `SIDES:Side[]`; `ADD_GAP=80`, `CLEARANCE=24`, `MAX_STEPS=50`; `oppositeSide(side:Side):Side`; `besideBounds(source:Bounds,side:Side,others:Bounds[]):Bounds`; `dropBounds(source:Bounds,point:{x:number;y:number}):{bounds:Bounds;side:Side}`; `addOperations(source:Element,bounds:Bounds,fromPort:Side,toPort:Side,id:number):Operation[]`.

- [ ] **Step 1: Write the failing test**

Create `e2e/unit/placement.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {addOperations,besideBounds,dropBounds,oppositeSide} from '../../frontend/src/placement';
import {element} from './fixtures';
const source={x:100,y:100,width:220,height:112};
test('a copy is placed beside the source with a gap, centred on the other axis',()=>{
  expect(besideBounds(source,'right',[])).toEqual({x:400,y:100,width:220,height:112});
  expect(besideBounds(source,'left',[])).toEqual({x:-200,y:100,width:220,height:112});
  expect(besideBounds(source,'top',[])).toEqual({x:100,y:-92,width:220,height:112});
  expect(besideBounds(source,'bottom',[])).toEqual({x:100,y:292,width:220,height:112});
});
test('an occupied spot pushes the copy further along the same axis',()=>{
  expect(besideBounds(source,'right',[{x:400,y:100,width:220,height:112}]).x).toBe(644);
  expect(besideBounds(source,'right',[{x:400,y:100,width:220,height:112},{x:644,y:100,width:220,height:112}]).x).toBe(888);
  expect(besideBounds(source,'left',[{x:-200,y:100,width:220,height:112}]).x).toBe(-444);
  expect(besideBounds(source,'right',[{x:400,y:300,width:220,height:112}]).x).toBe(400);
});
test('the search stops after the step limit',()=>{
  const chain=Array.from({length:60},(_,i)=>({x:400+i*244,y:100,width:220,height:112}));
  expect(besideBounds(source,'right',chain).x).toBe(400+50*244);
});
test('a drop puts the side facing the source on the drop point',()=>{
  expect(dropBounds(source,{x:700,y:400})).toEqual({bounds:{x:700,y:344,width:220,height:112},side:'right'});
  expect(dropBounds(source,{x:-300,y:156})).toEqual({bounds:{x:-520,y:100,width:220,height:112},side:'left'});
  expect(dropBounds(source,{x:210,y:-300})).toEqual({bounds:{x:100,y:-412,width:220,height:112},side:'top'});
  expect(dropBounds(source,{x:210,y:600})).toEqual({bounds:{x:100,y:600,width:220,height:112},side:'bottom'});
});
test('the copy keeps the style without text and is linked by one connector',()=>{
  const card=element({id:1,kind:'rectangle',x:100,y:100,title:'T',text:'Body',fill:'#fff0b8',stroke:'#ccad49',fontSize:20,fontWeight:600});
  expect(oppositeSide('right')).toBe('left');expect(oppositeSide('top')).toBe('bottom');
  expect(addOperations(card,{x:400,y:100,width:220,height:112},'right','left',5)).toEqual([
    {op:'create',element:{id:5,kind:'rectangle',x:400,y:100,width:220,height:112,fill:'#fff0b8',stroke:'#ccad49',fontSize:20,fontWeight:600,title:'',text:''}},
    {op:'create',element:{id:6,kind:'connector',from:1,to:5,fromPort:'right',toPort:'left'}},
  ]);
  const picture=element({id:2,kind:'image',image:'data:image/png;base64,AA=='});
  expect((addOperations(picture,{x:0,y:0,width:220,height:112},'bottom','top',7)[0] as {element:{image?:string}}).element.image).toBe('data:image/png;base64,AA==');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit e2e/unit/placement.spec.ts`
Expected: FAIL — `Cannot find module '../../frontend/src/placement'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/placement.ts`:

```ts
import type {Bounds,Element,Operation} from './types';
export type Side='left'|'right'|'top'|'bottom';
export const SIDES:Side[]=['left','right','top','bottom'];
export const ADD_GAP=80,CLEARANCE=24,MAX_STEPS=50;
export const oppositeSide=(side:Side):Side=>({left:'right',right:'left',top:'bottom',bottom:'top'} as const)[side];
const horizontal=(side:Side)=>side==='left'||side==='right';
const overlaps=(a:Bounds,b:Bounds,pad:number)=>a.x-pad<b.x+b.width&&a.x+a.width+pad>b.x&&a.y-pad<b.y+b.height&&a.y+a.height+pad>b.y;
// "+" places the copy beside the source; an occupied spot pushes it past the obstacle along the same axis.
export function besideBounds(source:Bounds,side:Side,others:Bounds[]):Bounds{
  const forward=side==='right'||side==='bottom',{width,height}=source;
  let b:Bounds=horizontal(side)?{x:forward?source.x+width+ADD_GAP:source.x-ADD_GAP-width,y:source.y,width,height}:{x:source.x,y:forward?source.y+height+ADD_GAP:source.y-ADD_GAP-height,width,height};
  for(let step=0;step<MAX_STEPS;step++){
    const hit=others.find(o=>overlaps(b,o,CLEARANCE));if(!hit)return b;
    b=horizontal(side)?{...b,x:forward?hit.x+hit.width+CLEARANCE:hit.x-CLEARANCE-width}:{...b,y:forward?hit.y+hit.height+CLEARANCE:hit.y-CLEARANCE-height};
  }
  return b;
}
// A drop in empty space puts the middle of the copy's side that faces the source on the drop point.
export function dropBounds(source:Bounds,point:{x:number;y:number}):{bounds:Bounds;side:Side}{
  const dx=point.x-(source.x+source.width/2),dy=point.y-(source.y+source.height/2),{width,height}=source;
  const side:Side=Math.abs(dx)>=Math.abs(dy)?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
  const x=side==='right'?point.x:side==='left'?point.x-width:point.x-width/2,y=side==='bottom'?point.y:side==='top'?point.y-height:point.y-height/2;
  return{bounds:{x,y,width,height},side};
}
export function addOperations(source:Element,bounds:Bounds,fromPort:Side,toPort:Side,id:number):Operation[]{
  const copy={id,kind:source.kind,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,fill:source.fill,stroke:source.stroke,fontSize:source.fontSize,fontWeight:source.fontWeight,title:'',text:'',...(source.kind==='image'?{image:source.image}:{})};
  return[{op:'create',element:copy},{op:'create',element:{id:id+1,kind:'connector',from:source.id,to:id,fromPort,toPort}}];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit e2e/unit/placement.spec.ts` — Expected: PASS (5 tests). Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/placement.ts e2e/unit/placement.spec.ts
git commit -m "feat: compute where a new linked block goes"
```

### Task 2: Точки и «+» в оверлее

**Files:**
- Modify: `frontend/src/overlay.ts`, `frontend/src/canvas.ts`, `frontend/src/interaction.ts` (`hover`)
- Test: create `e2e/connect-handles.spec.ts`

**Interfaces:**
- Consumes: `SIDES`, `Side` из Task 1.
- Produces: `OverlayState.connect:Element|null`; `export const HANDLE_REACH=52` в `overlay.ts` (40 + 11 + 1, экранные px); `CanvasView.hovered():Element|null`; приватный `CanvasView.connectSource():Element|null`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/connect-handles.spec.ts`:

```ts
import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
const dots=(page:Page,id=1)=>page.locator(`[data-connect="${id}"]`);
const adds=(page:Page,id=1)=>page.locator(`[data-add="${id}"]`);
async function hoverCard(page:Page,id=1){const b=await box(page,id);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);}
test('hovering_a_card_shows_four_dots_and_four_plus',async({page})=>{
  await setup(page);await hoverCard(page);await expect(dots(page)).toHaveCount(4);await expect(adds(page)).toHaveCount(4);
  for(const side of ['left','right','top','bottom'])await expect(page.locator(`[data-add="1"][data-side="${side}"]`)).toBeVisible();
  const card=await box(page),right=await bounding(page.locator('[data-connect="1"][data-side="right"]'));expect(Math.abs(right.x+right.width/2-(card.x+card.width)-14)).toBeLessThanOrEqual(1.5);
  await page.mouse.move(card.x+card.width+300,card.y+card.height+300);await expect(dots(page)).toHaveCount(0);
});
test('handles_stay_while_the_pointer_travels_to_the_plus',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'frame',x:40,y:40,width:600,height:400,text:'Frame'}},{op:'update',id:1,patch:{parentFrameId:2}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="right"]')),card=await box(page);
  for(let x=card.x+card.width-5;x<=plus.x+plus.width/2;x+=4){await page.mouse.move(x,card.y+card.height/2);await expect(adds(page)).toHaveCount(4);}
});
test('selected_card_keeps_handles_without_hover',async({page})=>{
  await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.mouse.move(b.x+b.width+300,b.y+b.height+300);await expect(dots(page)).toHaveCount(4);
});
test('no_handles_on_frames_connectors_multi_selection_or_while_editing',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'B'}},{op:'create',element:{kind:'connector',from:1,to:2,text:'link'}},{op:'create',element:{kind:'frame',x:100,y:400,width:300,height:200,text:'F'}}]);
  await expect(page.locator('#scene [data-id="4"]')).toBeVisible();const all=page.locator('[data-connect]');
  await page.locator('#scene [data-id="4"] [data-frame-header-hit]').hover();await expect(all).toHaveCount(0);
  await page.locator('#scene [data-id="3"] [data-connector-label]').hover();await expect(all).toHaveCount(0);
  const a=await box(page,1),b=await box(page,2);await page.mouse.click(a.x+35,a.y+35);await page.keyboard.down('Shift');await page.mouse.click(b.x+35,b.y+35);await page.keyboard.up('Shift');
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await expect(all).toHaveCount(0);
  await page.mouse.click(a.x+35,a.y+35);await page.keyboard.press('Enter');await expect(page.locator('#text-editor')).toBeVisible();await expect(all).toHaveCount(0);
});
test('handles_hide_on_a_block_smaller_than_40px_on_screen',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,width:30,height:30,text:''}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await hoverCard(page,2);await expect(dots(page,2)).toHaveCount(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts`
Expected: FAIL — `[data-connect="1"]` count 0 in the first three tests.

- [ ] **Step 3: Overlay nodes**

`frontend/src/overlay.ts` (LF):
- Add `import {SIDES} from './placement';` after the `import {setAttrs,svgElement} from './svg';` line.
- After the `const ACCENT='#7e4bb2';` line add:

```ts
// Screen pixels from the block edge to the farthest handle edge (40 + radius 11 + 1): hover stays alive within this reach.
export const HANDLE_REACH=52;
const OUT={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]} as const;
```

- In `OverlayState` add `connect:Element|null;` before `zoom:number`.
- After the `private marquee=...;` field line add:

```ts
  private connect=svgElement('g');private connectKey='';
  private dots=SIDES.map(side=>{const g=svgElement('g',{'data-side':side,cursor:'crosshair',display:'none','aria-label':'Протянуть связь'});g.append(svgElement('circle',{fill:'transparent'}),svgElement('circle',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private adds=SIDES.map(side=>{const g=svgElement('g',{'data-side':side,cursor:'pointer',display:'none','aria-label':'Добавить блок со связью'});g.append(svgElement('circle',{fill:ACCENT}),svgElement('path',{fill:'none',stroke:'#ffffff','stroke-linecap':'round','pointer-events':'none'}));return g;});
```

- In the constructor replace `root.replaceChildren(this.hover,this.drop,this.create,this.target,this.frames,this.controls,this.marquee);` with `this.connect.append(...this.dots,...this.adds);root.replaceChildren(this.hover,this.drop,this.create,this.target,this.frames,this.connect,this.controls,this.marquee);`. The handles sit below `controls`, so where a resize handle overlaps a connection dot the resize handle wins (final-review ruling).
- In `render`, before the `const key=s.selected.map(e=>e.id).join(',');` line add:

```ts
    const c=s.connect,visible=!!c&&c.width*z>=40&&c.height*z>=40;
    SIDES.forEach((side,i)=>{
      const dot=this.dots[i],add=this.adds[i];show(dot,visible);show(add,visible);
      if(!visible||!c){dot.removeAttribute('data-connect');add.removeAttribute('data-add');return;}
      const [ox,oy]=OUT[side],mx=c.x+c.width*(ox?(ox>0?1:0):.5),my=c.y+c.height*(oy?(oy>0?1:0):.5),dx=mx+ox*14/z,dy=my+oy*14/z,ax=mx+ox*40/z,ay=my+oy*40/z,p=5/z;
      setAttrs(dot,{'data-connect':c.id});setAttrs(dot.children[0],{cx:dx,cy:dy,r:12/z});setAttrs(dot.children[1],{cx:dx,cy:dy,r:5/z,'stroke-width':1.5/z});
      setAttrs(add,{'data-add':c.id});setAttrs(add.children[0],{cx:ax,cy:ay,r:11/z});setAttrs(add.children[1],{d:`M ${ax-p} ${ay} H ${ax+p} M ${ax} ${ay-p} V ${ay+p}`,'stroke-width':2/z});
    });
    const connectKey=visible&&c?String(c.id):'';
    if(connectKey!==this.connectKey){this.connectKey=connectKey;if(connectKey&&!reducedMotion())this.connect.animate([{opacity:0},{opacity:1}],{duration:80,easing:'ease-out'});}
```

- [ ] **Step 4: Which block shows handles**

`frontend/src/canvas.ts` (CRLF):
- After the `setHover(id:number|null){...}` line add:

```ts
  hovered():Element|null{const e=this.hover===null?null:this.board?.elements.find(e=>e.id===this.hover);return e?this.project(e):null;}
  // The hovered block wins over a single selected one; any gesture, preview or open text editor hides the handles.
  private connectSource():Element|null{
    const board=this.board;if(!board||this.editing!==null||this.selected.length>1||this.preview||this.resizePreview||this.marqueeBounds||this.creation||this.connectorPreview)return null;
    const usable=(e:Element|undefined)=>!!e&&['rectangle','text','image'].includes(e.kind);
    const hover=this.hover===null?undefined:board.elements.find(e=>e.id===this.hover);if(usable(hover))return this.project(hover!);
    const selected=this.selected.length===1?board.elements.find(e=>e.id===this.selected[0]):undefined;return usable(selected)?this.project(selected!):null;
  }
```

- In `paintOverlay` replace `create:this.creation,connectorTarget,zoom:this.camera.zoom` with `create:this.creation,connectorTarget,connect:this.connectSource(),zoom:this.camera.zoom`.

`frontend/src/interaction.ts` (CRLF):
- Add `import {HANDLE_REACH} from './overlay';` after `import {isDiscreteZoom} from './camera';`.
- Replace the whole `private hover(event:PointerEvent){...}` line with:

```ts
  private hover(event:PointerEvent){
    if(this.tool!=='select'||this.space){this.view.setHover(null);return;}
    const target=this.view.elementAt(event.target);if(target&&target.kind!=='connector'&&target.kind!=='frame'){this.view.setHover(target.id);return;}
    // The handles sit outside the block: keep its hover while the pointer travels to them across empty space or a parent frame.
    const current=this.view.hovered(),point=this.view.worldPoint(event.clientX,event.clientY),reach=HANDLE_REACH/this.view.camera.zoom;
    if(current&&point.x>=current.x-reach&&point.x<=current.x+current.width+reach&&point.y>=current.y-reach&&point.y<=current.y+current.height+reach)return;
    this.view.setHover(null);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts e2e/smoothness.spec.ts e2e/editor-ux.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend e2e/connect-handles.spec.ts
git commit -m "feat: show connection dots and plus buttons around a block"
```

### Task 3: Клик по «+»

**Files:**
- Modify: `frontend/src/interaction.ts` (gesture `connect`, `down`, `move`, `up`, `Callbacks`), `frontend/src/canvas.ts` (`revealBounds`), `frontend/src/editor.ts` (callbacks, `addBeside`, `addBlock`)
- Test: `e2e/connect-handles.spec.ts`

**Interfaces:**
- Consumes: `besideBounds`, `oppositeSide`, `addOperations`, `Side` (Task 1); ручки `[data-add]`/`[data-connect]` с `data-side` (Task 2); `Editor.createObjects(operations,ids,base,label)` и `Editor.editText(id)` (этап 2a; отклонённое создание закрывает редактор через `createRejected`).
- Produces: gesture `{type:'connect';source:Element;side:Side;add:boolean;screen:Point;dragged:boolean;point:Point;target:ConnectorTarget|null;base:EditState}`; `Callbacks.addBeside(id:number,side:Side):void`; `CanvasView.revealBounds(b:Bounds):void`; `Editor.addBlock(base,source,bounds,fromPort,toPort)` (Task 4 использует).

- [ ] **Step 1: Write the failing tests**

Append to `e2e/connect-handles.spec.ts`:

```ts
async function clickPlus(page:Page,side:string,id=1){await hoverCard(page,id);const plus=page.locator(`[data-add="${id}"][data-side="${side}"]`);await expect(plus).toBeVisible();await plus.click();}
test('plus_creates_a_linked_copy_in_each_direction',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{fill:'#fff0b8',stroke:'#ccad49'}}]);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  const expected:Record<string,[number,number]>={right:[400,100],left:[-200,100],top:[100,-92],bottom:[100,292]};let revision=2;
  for(const [side,[x,y]]of Object.entries(expected)){
    await clickPlus(page,side);await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');
    revision++;await expect.poll(async()=>(await board(page,id)).revision).toBe(revision);
    const b=await board(page,id),block=b.elements.at(-2),link=b.elements.at(-1);
    expect([block.kind,block.x,block.y,block.width,block.height,block.fill,block.stroke,block.title,block.text]).toEqual(['rectangle',x,y,220,112,'#fff0b8','#ccad49','','']);
    expect([link.kind,link.from,link.to,link.fromPort]).toEqual(['connector',1,block.id,side]);
  }
});
test('plus_is_one_undo_step_and_opens_text_input',async({page})=>{
  const id=await setup(page);await clickPlus(page,'right');await expect(page.locator('#title-draft')).toBeFocused();await page.keyboard.type('Оплата');await page.keyboard.press('Escape');
  await expect.poll(async()=>(await board(page,id)).elements.find((e:{id:number})=>e.id===2)?.title).toBe('Оплата');
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(1);
});
test('plus_skips_an_occupied_spot',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:400,y:100,text:'Busy'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await clickPlus(page,'right');await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(4);
  const block=(await board(page,id)).elements.find((e:{id:number})=>e.id===3);expect([block.x,block.y]).toEqual([644,100]);
});
test('clicking_a_dot_without_dragging_creates_nothing',async({page})=>{
  const id=await setup(page);await hoverCard(page);await page.locator('[data-connect="1"][data-side="right"]').click();await page.waitForTimeout(200);
  expect((await board(page,id)).revision).toBe(1);
});
test('plus_far_off_screen_moves_the_camera_to_show_the_block',async({page})=>{
  await setup(page);const canvas=await bounding(page.locator('#canvas'));
  const b=await box(page);await page.locator('#canvas').evaluate((e,dx)=>e.dispatchEvent(new WheelEvent('wheel',{deltaX:dx,bubbles:true,cancelable:true})),b.x-canvas.x-100);
  await clickPlus(page,'left');await expect(page.locator('#text-editor')).toBeVisible();
  const editor=await bounding(page.locator('#text-editor'));expect(editor.x).toBeGreaterThanOrEqual(canvas.x+39);
});
test('agent_change_during_plus_closes_the_new_block_editor',async({page})=>{
  const id=await setup(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/boards/${id}/apply**`,async route=>{await held;await route.continue();},{times:1});
  await clickPlus(page,'right');await expect(page.locator('#text-editor')).toBeVisible();
  await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:900,y:500,text:'Agent'}}]);release();
  await expect(page.locator('#text-editor')).toBeHidden();await expect(page.locator('#operation-dialog')).toBeVisible();
  const agent=(await board(page,id)).elements.find((e:{text:string})=>e.text==='Agent');expect(agent).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts -g "plus|dot"`
Expected: FAIL — клик по «+» ничего не создаёт.

- [ ] **Step 3: Gesture and callback in Interaction**

`frontend/src/interaction.ts` (CRLF):
- Add `import type {Side} from './placement';` after the `import {HANDLE_REACH} from './overlay';` line.
- In `interface Callbacks{...}` add `addBeside(id:number,side:Side):void;` before `report(error:unknown):void`.
- In `type Gesture=(...)` add the variant `|{type:'connect';source:Element;side:Side;add:boolean;screen:Point;dragged:boolean;point:Point;target:ConnectorTarget|null;base:EditState}` before `)&{pointer:number};`.
- In `down`, directly before the line `const endpoint=(event.target as globalThis.Element).closest('[data-connector-end]');` insert:

```ts
    const grip=(event.target as globalThis.Element).closest('[data-connect],[data-add]');
    if(grip&&this.tool==='select'){
      const base=this.callbacks.editState(),id=Number(grip.getAttribute('data-connect')??grip.getAttribute('data-add')),source=base.board.elements.find(e=>e.id===id);
      if(source){this.begin({type:'connect',pointer:event.pointerId,source:structuredClone(source),side:grip.getAttribute('data-side') as Side,add:grip.hasAttribute('data-add'),screen:{x:event.clientX,y:event.clientY},dragged:false,point,target:null,base});event.preventDefault();}
      return;
    }
```

- In `move`, directly before `else if(g.type==='create'){` insert `else if(g.type==='connect'){g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>4;g.point=point;}`
- In `up`, directly after the line that starts with `if(g.type==='create'){` add the line `if(g.type==='connect'&&!g.dragged&&g.add)this.callbacks.addBeside(g.source.id,g.side);`

- [ ] **Step 4: Camera reveal**

`frontend/src/canvas.ts` (CRLF), after the `reveal(point:Point){...}` line add:

```ts
  // Shifts the camera by the least amount that brings b fully into view with a 40px margin.
  revealBounds(b:Bounds){
    const rect=this.svg.getBoundingClientRect(),z=this.camera.zoom,m=40,left=this.camera.x+b.x*z,top=this.camera.y+b.y*z,right=left+b.width*z,bottom=top+b.height*z;
    let dx=0,dy=0;if(right>rect.width-m)dx=right-(rect.width-m);if(left-dx<m)dx=left-m;if(bottom>rect.height-m)dy=bottom-(rect.height-m);if(top-dy<m)dy=top-m;
    if(dx||dy){this.zoomAnimation.stop();this.pan(dx,dy);}
  }
```

- [ ] **Step 5: Create the block in the editor**

`frontend/src/editor.ts` (CRLF):
- After `import { CanvasView, orderedFrames } from './canvas';` add `import {addOperations,besideBounds,oppositeSide,type Side} from './placement';`. In the `import type { Board, ... } from './types';` list add `Bounds`.
- In the `interaction = new Interaction(...)` line, directly after `this.editText(base.board.nextId,element.kind==='frame');},` insert `addBeside:(id,side)=>this.addBeside(id,side),`
- After the `private createRejected(...){...}` method (it ends with `  }` after the `if(this.draft&&ids.includes(this.draft.id))...` line) add:

```ts
  private addBeside(id:number,side:Side){
    const base=this.queue?.projectedState(),source=base?.board.elements.find(e=>e.id===id);if(!base||!source||this.opening)return;
    const others=base.board.elements.filter(e=>e.id!==id&&e.kind!=='frame'&&e.kind!=='connector');
    this.addBlock(base,source,besideBounds(source,side,others),side,oppositeSide(side));
  }
  // One command creates the block and its connector, so a single undo removes both.
  private addBlock(base:EditState,source:BoardElement,bounds:Bounds,fromPort:Side,toPort:Side){
    const id=base.board.nextId;this.createObjects(addOperations(source,bounds,fromPort,toPort,id),[id],base,'Новый блок со связью');this.view.revealBounds(bounds);this.editText(id);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts e2e/inline-text.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend e2e/connect-handles.spec.ts
git commit -m "feat: add a linked block with the plus buttons"
```

### Task 4: Протягивание стрелки

**Files:**
- Modify: `frontend/src/overlay.ts` (`wire`), `frontend/src/canvas.ts` (`previewWire`, `clearPreview`, `connectSource`, `paintOverlay`), `frontend/src/interaction.ts` (`move`, `up`, `wheel`, `Callbacks`, gesture `client`), `frontend/src/editor.ts` (`addAt`, `connectBlocks`)
- Test: `e2e/connect-handles.spec.ts`

**Interfaces:**
- Consumes: gesture `connect` и `Editor.addBlock` (Task 3); `dropBounds`, `oppositeSide` (Task 1); `connectorTarget`, `connectorPreviewPoints`, `ConnectorTarget` из `anchors.ts`.
- Produces: `OverlayState.wire:Point[]|null` (`[data-wire-preview]`); `CanvasView.previewWire(points:Point[],target:{element:Element;port:Point}|null)`; `Callbacks.addAt(id:number,side:Side,point:Point)`, `Callbacks.connect(id:number,side:Side,target:ConnectorTarget)`.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/connect-handles.spec.ts`:

```ts
async function screen(page:Page,x:number,y:number){return page.locator('#world').evaluate((e,p)=>{const v=new DOMPoint(p.x,p.y).matrixTransform((e as SVGGraphicsElement).getScreenCTM()!);return{x:v.x,y:v.y};},{x,y});}
async function grabDot(page:Page,side='right',id=1){await hoverCard(page,id);const d=await bounding(page.locator(`[data-connect="${id}"][data-side="${side}"]`));await page.mouse.move(d.x+d.width/2,d.y+d.height/2);await page.mouse.down();return d;}
test('dragging_from_a_dot_onto_a_block_connects_them',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:500,y:300,text:'B'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await grabDot(page);const p=await screen(page,510,356);await page.mouse.move(p.x,p.y,{steps:8});
  await expect(page.locator('[data-wire-preview]')).toBeVisible();await expect(page.locator('[data-connector-target="2"]')).toBeVisible();await page.mouse.up();
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);const link=(await board(page,id)).elements[2];
  expect([link.kind,link.from,link.to,link.fromPort,link.toPort]).toEqual(['connector',1,2,'right','left']);await expect(page.locator('#text-editor')).toBeHidden();
});
test('dragging_into_empty_space_creates_a_linked_block_at_the_drop',async({page})=>{
  const id=await setup(page);await grabDot(page);const p=await screen(page,700,400);await page.mouse.move(p.x,p.y,{steps:8});await page.mouse.up();
  await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  const [,block,link]=(await board(page,id)).elements;expect([block.x,block.y]).toEqual([700,344]);expect([link.from,link.to,link.fromPort,link.toPort]).toEqual([1,block.id,'right','left']);
});
test('dropping_back_on_the_source_creates_nothing',async({page})=>{
  const id=await setup(page);await grabDot(page);const p=await screen(page,210,156);await page.mouse.move(p.x+80,p.y,{steps:4});await page.mouse.move(p.x,p.y,{steps:4});await page.mouse.up();
  await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);await expect(page.locator('[data-wire-preview]')).toBeHidden();
});
test('escape_cancels_a_drag_without_a_command',async({page})=>{
  const id=await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+120,d.y+60,{steps:6});await expect(page.locator('[data-wire-preview]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('[data-wire-preview]')).toBeHidden();await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(1);
});
test('dragging_from_a_plus_works_like_a_dot',async({page})=>{
  const id=await setup(page);await hoverCard(page);const plus=await bounding(page.locator('[data-add="1"][data-side="bottom"]'));
  await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2);await page.mouse.down();const p=await screen(page,210,600);await page.mouse.move(p.x,p.y,{steps:8});await page.mouse.up();
  await expect(page.locator('#text-editor')).toBeVisible();await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.length).toBe(3);
  const [,block,link]=(await board(page,id)).elements;expect([block.x,block.y]).toEqual([100,600]);expect([link.fromPort,link.toPort]).toEqual(['bottom','top']);
});
test('wheel_during_a_drag_pans_and_the_preview_follows',async({page})=>{
  await setup(page);const d=await grabDot(page);await page.mouse.move(d.x+150,d.y,{steps:6});const before=await bounding(page.locator('[data-wire-preview]'));
  await page.mouse.wheel(0,120);await expect.poll(async()=>(await bounding(page.locator('[data-wire-preview]'))).height).not.toBeCloseTo(before.height,0);
  await page.keyboard.press('Escape');await page.mouse.up();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts -g "drag|drop|escape|wheel"`
Expected: FAIL — `[data-wire-preview]` не найден.

- [ ] **Step 3: Wire preview in the overlay and the canvas**

`frontend/src/overlay.ts`:
- In `OverlayState` add `wire:Point[]|null;` before `zoom:number`.
- Add a field `private wire=svgElement('path',{'data-wire-preview':'',fill:'none',stroke:ACCENT,'stroke-linecap':'round','pointer-events':'none',display:'none'});` after the `private target=...` field line.
- In the constructor `root.replaceChildren(...)` insert `this.wire,` right before `this.target,`.
- In `render`, after the line that starts with `show(this.target,!!s.connectorTarget);` and its following `if/else` lines, add: `show(this.wire,!!s.wire?.length);if(s.wire?.length)setAttrs(this.wire,{d:s.wire.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),'stroke-width':2/z});`

`frontend/src/canvas.ts` (CRLF):
- Add a field after the `private connectorPreview:...` line: `private wire:{points:Point[];target:{element:Element;port:Point}|null}|null=null;`
- After the `previewConnector(...)` line add `previewWire(points:Point[],target:{element:Element;port:Point}|null){this.wire={points,target};this.frames.invalidate('overlay');}`
- In `clearPreview()` insert `this.wire=null;` right before `this.previewChanged(ids);`.
- In `connectSource()` replace `||this.connectorPreview)return null;` with `||this.connectorPreview||this.wire)return null;`.
- In `paintOverlay` replace `create:this.creation,connectorTarget,connect:` with `create:this.creation,connectorTarget:this.wire?.target??connectorTarget,wire:this.wire?.points??null,connect:`.

- [ ] **Step 4: Drag in Interaction**

`frontend/src/interaction.ts` (CRLF):
- Replace `import {connectorTarget,type ConnectorEnd,type ConnectorTarget} from './anchors';` with `import {connectorPreviewPoints,connectorTarget,type ConnectorEnd,type ConnectorTarget} from './anchors';`
- After the `const clamp=...;` line add `// A connector that exists only while dragging: from the source's side towards the pointer.` and `const wireLink=(source:Element,side:Side):Element=>({...source,id:-1,kind:'connector',from:source.id,to:source.id,fromPort:side,toPort:'auto'});`
- In `Callbacks` add `addAt(id:number,side:Side,point:Point):void;connect(id:number,side:Side,target:ConnectorTarget):void;` after `addBeside(id:number,side:Side):void;`.
- In the `connect` gesture variant add `client:Point;` after `screen:Point;`, and in `down`'s `this.begin({type:'connect',...})` add `client:{x:event.clientX,y:event.clientY},` after `screen:{x:event.clientX,y:event.clientY},`.
- In `move` replace `else if(g.type==='connect'){g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>4;g.point=point;}` with `else if(g.type==='connect'){g.dragged ||= Math.hypot(event.clientX-g.screen.x,event.clientY-g.screen.y)>4;g.point=point;g.client={x:event.clientX,y:event.clientY};if(g.dragged)this.previewConnect(g);}`
- After the `private wheel(e:WheelEvent){...}` method add:

```ts
  private previewConnect(g:Extract<Gesture,{type:'connect'}>){
    const board=g.base.board,link=wireLink(g.source,g.side);g.target=connectorTarget(board,link,'to',g.point,this.view.camera.zoom);
    const points=connectorPreviewPoints(board,link,'to',g.point,g.target),target=g.target?board.elements.find(e=>e.id===g.target!.id):undefined;
    this.view.previewWire(points,target&&points.length?{element:this.view.project(target),port:points.at(-1)!}:null);
  }
```

- In `wheel`, replace `e.preventDefault();if(this.gesture)return;` with `e.preventDefault();if(this.gesture&&this.gesture.type!=='connect')return;`, and at the end of the method (after the `...else view.pan(intent.dx,intent.dy);` statement, inside the method) add: `const g=this.gesture;if(g?.type==='connect'&&g.dragged){g.point=view.worldPoint(g.client.x,g.client.y);this.previewConnect(g);}`
- In `up`, replace the Task 3 line `if(g.type==='connect'&&!g.dragged&&g.add)this.callbacks.addBeside(g.source.id,g.side);` with:

```ts
    if(g.type==='connect'){
      const s=g.source,halo=12/this.view.camera.zoom,onSource=g.point.x>=s.x-halo&&g.point.x<=s.x+s.width+halo&&g.point.y>=s.y-halo&&g.point.y<=s.y+s.height+halo;
      if(!g.dragged){if(g.add)this.callbacks.addBeside(s.id,g.side);}else if(g.target)this.callbacks.connect(s.id,g.side,g.target);else if(!onSource)this.callbacks.addAt(s.id,g.side,g.point);
    }
```

- [ ] **Step 5: Editor callbacks**

`frontend/src/editor.ts` (CRLF):
- Change the placement import to `import {addOperations,besideBounds,dropBounds,oppositeSide,type Side} from './placement';` and add `import type {ConnectorTarget} from './anchors';` after it.
- In the `interaction = new Interaction(...)` line, after `addBeside:(id,side)=>this.addBeside(id,side),` insert `addAt:(id,side,point)=>this.addAt(id,side,point),connect:(id,side,target)=>this.connectBlocks(id,side,target),`
- After the `addBlock` method add:

```ts
  private addAt(id:number,fromSide:Side,point:{x:number;y:number}){
    const base=this.queue?.projectedState(),source=base?.board.elements.find(e=>e.id===id);if(!base||!source||this.opening)return;
    const drop=dropBounds(source,point);this.addBlock(base,source,drop.bounds,fromSide,oppositeSide(drop.side));
  }
  private connectBlocks(id:number,side:Side,target:ConnectorTarget){
    const base=this.queue?.projectedState();if(!base||this.opening||!base.board.elements.some(e=>e.id===id)||!base.board.elements.some(e=>e.id===target.id))return;
    const linkId=base.board.nextId;this.createObjects([{op:'create',element:{id:linkId,kind:'connector',from:id,to:target.id,fromPort:side,toPort:target.port}}],[linkId],base,'Новая связь');
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/connect-handles.spec.ts e2e/navigation-links.spec.ts e2e/ux-actions.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend e2e/connect-handles.spec.ts
git commit -m "feat: drag a connector from a dot to a block or empty space"
```

### Task 5: Бюджет, полная проверка и документы

**Files:**
- Modify: `frontend/src/editor.ts` (комментарий в `openText`), `e2e/perf.spec.ts`, `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, `docs/superpowers/plans/2026-10-20-connect-handles.md` (раздел «Результаты»)

**Interfaces:**
- Consumes: `bigBoard`, `frames`, `p90`, `FRAME_BUDGET_MS`, `box`, `bounding` из `e2e/perf.spec.ts`; ручки из Tasks 2–4.
- Produces: тест бюджета ручек; записанные замеры.

- [ ] **Step 1: Fix the comment from stage 2a**

`frontend/src/editor.ts` (CRLF): replace `zoom around the block so it stays under the cursor.` with `zoom around the block's centre.`

- [ ] **Step 2: Budget test**

In `e2e/perf.spec.ts`, inside `test.describe('smoothness budget on 300 elements',...)`, after the last test add:

```ts
  test('hovering_blocks_and_dragging_a_connector_stay_within_the_frame_budget',async({page})=>{
    await bigBoard(page);const b=await box(page),away={x:b.x+b.width+150,y:b.y+b.height/2};
    const hover=await frames(page,async()=>{for(let i=0;i<30;i++)await page.mouse.move(i%2?away.x:b.x+b.width/2,i%2?away.y:b.y+b.height/2);});
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);const dot=await bounding(page.locator('[data-connect="1"][data-side="right"]'));
    const drag=await frames(page,async()=>{await page.mouse.move(dot.x+dot.width/2,dot.y+dot.height/2);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(dot.x+dot.width/2+i*8,dot.y+dot.height/2+i*5);await page.keyboard.press('Escape');await page.mouse.up();});
    for(const [name,values]of Object.entries({hover,drag})){expect(values.length,name).toBeGreaterThan(5);expect(p90(values),name).toBeLessThanOrEqual(FRAME_BUDGET_MS);}
  });
```

Run: `npm run build && npx playwright test --project=chromium e2e/perf.spec.ts -g hovering` — Expected: PASS. If red, it is a budget violation: find the hot spot and fix the code (not the budget); record the cause.

- [ ] **Step 3: Full verification on the final tree**

Run in order: `cargo test`, `npm run typecheck`, `npm run build`, `npx playwright test` (unit, chromium, firefox, webkit). Expected: all green. A red test is shown with output; a flaky one is re-run alone 5 times and recorded.

- [ ] **Step 4: Record results and the roadmap**

- Append `## Результаты` to `docs/superpowers/plans/2026-10-20-connect-handles.md`: p90 кадра при наведении и протягивании, итог каждого проекта Playwright, `cargo test` (one paragraph per line).
- In `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, section «Дорожная карта», after the 2a line added in stage 2a, add the line `Этап 2b (точки и «+» для блоков и связей, спек 2026-10-20-connect-handles-design.md) реализован; дальше этап 3.`

- [ ] **Step 5: Commit**

```bash
git add frontend e2e docs/superpowers
git commit -m "test: budget connect handles and record stage 2b results"
```

## Результаты

Бюджет кадра, доска из 300 элементов, Chromium, тест `hovering_blocks_and_dragging_a_connector_stay_within_the_frame_budget` (бюджет p90 кадра 16 мс), три прогона подряд: наведение (30 кадров, указатель прыгает с блока в пустоту и обратно) p90 0.4 / 0.4 / 0.4 мс; протягивание связи от точки (32 кадра, 30 шагов указателя, Escape) p90 0.4 / 0.4 / 0.3 мс. Горячих мест нет, правок кода ради бюджета не понадобилось.

Полный прогон `npm run build && npx playwright test` на коммите, предшествующем этому (код и тесты те же), 915 с: 588 прошли, 11 пропущены (бюджеты откалиброваны только для Chromium), 0 упали, 0 нестабильных. По проектам: unit 35 прошли; chromium 188 прошли; firefox 183 прошли, 5 пропущены; webkit 182 прошли, 6 пропущены. В этом прогоне красных тестов не было.

Первый полный прогон, до правки теста, дал 587 прошли, 11 пропущены, 1 упал: `dragging_from_a_plus_works_like_a_dot` в Firefox, 5 из 5 при повторе по одному (`expect(locator('#text-editor')).toBeVisible()` не дождался, элемент скрыт). Причина в тесте, а не в коде: точка сброса по миру (210, 600) давала экранную y≈734 при окне 720 px, а Firefox не доставляет события указателя за пределами окна, Chromium и WebKit доставляют. Точку сброса сменили на (210, 520), ожидаемый блок на (100, 520); проверяемое поведение то же (блок появляется под точкой сброса, порты `bottom` и `top`). После правки тест проходит 5 из 5 в chromium, firefox и webkit.

Тест этапа 1 `drop_handler_and_next_frame_fit_one_frame` (бюджет 16 мс) один раз упал в Chromium при выборочном прогоне `connect-handles.spec.ts` и `perf.spec.ts` сразу в трёх браузерах (значение не записано); в полном прогоне выше он прошёл, по одному с `--repeat-each=8` проходит 8 из 8, обработчик pointerup плюс кадр 8.9–12.1 мс (11.7, 10.4, 9.6, 10.7, 12.1, 8.9, 11.3, 11.1). Это тот же разброс, что и на этапе 1 (8.8–12.5 мс), к ручкам этапа 2b он отношения не имеет; бюджет не менялся.

`cargo test`: 98 прошли, 0 упали. `npm run typecheck` без ошибок, `npm run build` собирается.
