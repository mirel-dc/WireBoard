# Умные направляющие и равные отступы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При переносе и ресайзе блок прилипает к краям, центрам, равным промежуткам и размерам видимых соседей, как в Miro; розовые линии и метки показывают, к чему он прилип; Alt отключает привязку.

**Architecture:** Чистый модуль `snap.ts` считает поправку и геометрию направляющих по рамкам целей. `Interaction` собирает цели в начале жеста и применяет поправку в ветках `move` и `resize` до превью; клавиша Alt пересчитывает превью без движения мыши. `CanvasView` хранит направляющие и передаёт их в `OverlayRenderer`, который рисует их пулом постоянных узлов.

**Tech Stack:** TypeScript 5.9 без фреймворка, Vite 7, SVG DOM; Playwright (e2e и node-side unit).

**Spec:** `docs/superpowers/specs/2026-10-21-smart-guides-design.md`

## Global Constraints

- Сервер, формат файла доски и CLI-контракт не меняются; новые зависимости не добавляются; команды переноса и ресайза остаются прежними (`moveOperations`; `update` + `resize`).
- Числа: порог `SNAP_PX = 6` px экрана (в мире `6/zoom`); порог клика `2` px экрана — до него привязки нет; совпадение линий для направляющих — расхождение меньше `0.5` мировой единицы; пределы размера `20`–`10000`; метка размера на `8` px экрана снаружи грани; засечки `4` px экрана; цвет `#e8467c`; линия `1` px экрана; число метки `Golos Text` `11` px экрана на белой подложке.
- Цели — только `rectangle`, `text`, `image`, `frame`, пересекающие видимую область; стрелки, перетаскиваемые объекты и члены перетаскиваемых фреймов — не цели.
- DOM-атрибуты для тестов: каждая направляющая — `[data-guide="align|gap|size"][data-axis="x|y"]` внутри `[data-guides]`; у скрытого узла пула этих атрибутов нет; у метки отступа текст — величина промежутка, округлённая до целого.
- Окончания строк: CRLF в `frontend/src/canvas.ts` и `frontend/src/interaction.ts`; LF в `frontend/src/overlay.ts` и новых файлах. Правьте через Edit, не через `sed -i` (в Git Bash он теряет CR и даёт diff всего файла). Перед коммитом `git diff --stat` — правка строки не должна давать diff всего файла.
- Перед Playwright всегда `npm run build`. Тексты UI — русские, коммиты — английские `<type>: <description>`.
- Firefox не доставляет события указателя за пределами окна 1280×720: в e2e указатель всегда внутри окна. Firefox включает обводку SVG в `getBoundingClientRect`: точные координаты проверяйте по серверу, а не по экранным рамкам.

## Review Focus

- Клик или нажатие на хэндл без движения рядом с линией соседа: блок не двигается, команды нет (тесты в Task 3 и Task 4).
- Перенос фрейма с детьми: дети не притягивают свой фрейм к старому положению (тест в Task 3).
- Alt, отпущенный после конца жеста: отпускание глушится, иначе Firefox откроет меню окна (тест в Task 3).
- Привязанное значение доходит до сервера ровно, без дробного хвоста (e2e сверяют точные координаты на сервере в Task 3 и Task 4).
- Ресайз с Shift: пропорция не ломается привязкой (тест в Task 4).

---

## Файлы

- Create `frontend/src/snap.ts`, `e2e/unit/snap.spec.ts`, `e2e/smart-guides.spec.ts`.
- Modify `frontend/src/overlay.ts`, `frontend/src/canvas.ts`, `frontend/src/interaction.ts`, `e2e/perf.spec.ts`, `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, этот план (раздел «Результаты»).

### Task 1: Выравнивание, цели и ресайз в `snap.ts`

**Files:**
- Create: `frontend/src/snap.ts` (LF)
- Test: `e2e/unit/snap.spec.ts` (LF)

**Interfaces:**
- Consumes: `Board`, `Bounds` из `frontend/src/types.ts`; тип `ResizeHandle` из `frontend/src/interaction.ts` (только `import type`, чтобы не было цикла во время выполнения); `board`, `element` из `e2e/unit/fixtures.ts` (у `element` по умолчанию `kind:'rectangle'`, `width:220`, `height:112`).
- Produces: `SNAP_PX`, `type Axis`, `type Guide`, `interface MoveSnap{dx;dy;guides}`, `interface ResizeSnap{bounds;guides}`, `snapTargets(board,exclude,view):Bounds[]`, `unionBounds(bounds):Bounds|null`, `snapMove(moving,targets,threshold):MoveSnap` (в этой задаче только выравнивание), `snapResize(bounds,handle,targets,threshold):ResizeSnap`. Внутренние `nearest`, `alignGuides`, `lines`, `start`, `end`, `length`, `other`, `AXES` использует Task 2.

- [ ] **Step 1: Write the failing tests**

Create `e2e/unit/snap.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {snapMove,snapResize,snapTargets,unionBounds} from '../../frontend/src/snap';
import {board,element} from './fixtures';
const b=(x:number,y:number,width=220,height=112)=>({x,y,width,height});
test('targets are visible blocks and frames without connectors or excluded ids',()=>{
  const doc=board([element({id:1}),element({id:2,kind:'frame',x:300,width:400,height:300}),element({id:3,kind:'connector',from:1,to:2}),element({id:4,x:5000}),element({id:5,kind:'text',y:300}),element({id:6,kind:'image',y:500})]);
  expect(snapTargets(doc,[1],b(-100,-100,1500,1000))).toEqual([b(300,0,400,300),b(0,300),b(0,500)]);
});
test('the union of a group is its common bounds',()=>{
  expect(unionBounds([b(100,100),b(100,300)])).toEqual(b(100,100,220,312));
  expect(unionBounds([])).toBeNull();
});
test('a left edge within the threshold snaps to a neighbour edge and draws one guide',()=>{
  const s=snapMove(b(503,100),[b(500,400,300)],6);
  expect([s.dx,s.dy]).toEqual([-3,0]);
  expect(s.guides).toEqual([{type:'align',axis:'x',at:500,from:100,to:512}]);
});
test('the threshold is in world units, so the caller scales it by zoom',()=>{
  expect(snapMove(b(507,100),[b(500,400,300)],6).dx).toBe(0);
  expect(snapMove(b(507,100),[b(500,400,300)],12).dx).toBe(-7);
  expect(snapMove(b(503.5,100),[b(500,400,300)],3).dx).toBe(0);
});
test('the smallest correction wins across edges and centres',()=>{
  const s=snapMove(b(504,100),[b(500,400,300),b(100,600,1026)],6);
  expect(s.dx).toBe(-1);
  expect(s.guides).toEqual([{type:'align',axis:'x',at:613,from:100,to:712}]);
});
test('both axes snap independently',()=>{
  const s=snapMove(b(503,297),[b(500,600,300),b(900,300,200,150)],6);
  expect([s.dx,s.dy]).toEqual([-3,3]);
});
test('a dragged edge snaps to a neighbour edge',()=>{
  const s=snapResize(b(100,100,297,112),'se',[b(400,300)],6);
  expect(s.bounds).toEqual(b(100,100,300,112));
  expect(s.guides).toContainEqual({type:'align',axis:'x',at:400,from:100,to:412});
});
test('the west handle moves the left edge and keeps the right one',()=>{
  expect(snapResize(b(103,100,217,112),'w',[b(100,400,300)],6).bounds).toEqual(b(100,100,220,112));
});
test('a size within the threshold matches a neighbour and marks both blocks',()=>{
  const s=snapResize(b(100,100,297,112),'e',[b(500,300,300,150)],6);
  expect(s.bounds).toEqual(b(100,100,300,112));
  expect(s.guides.filter(g=>g.type==='size')).toEqual([{type:'size',axis:'x',bounds:b(100,100,300,112)},{type:'size',axis:'x',bounds:b(500,300,300,150)}]);
});
test('a snap that would break the size limits is skipped',()=>{
  expect(snapResize(b(100,100,22,112),'e',[b(117,500,300)],6).bounds).toEqual(b(100,100,22,112));
});
test('a resize with nothing near keeps its bounds and draws nothing',()=>{
  const s=snapResize(b(100,100,250,112),'e',[b(500,300,300,150)],6);
  expect(s).toEqual({bounds:b(100,100,250,112),guides:[]});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=unit e2e/unit/snap.spec.ts`
Expected: FAIL — `Cannot find module '../../frontend/src/snap'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/snap.ts`:

```ts
import type {Board,Bounds} from './types';
import type {ResizeHandle} from './interaction';
// Screen pixels within which an edge, centre, gap or size snaps; callers divide by zoom.
export const SNAP_PX=6;
// Coordinates closer than this (world units) are the same line when drawing guides.
const SAME=.5;
// The size limits of resizeBounds.
const MIN_SIZE=20,MAX_SIZE=10000;
export type Axis='x'|'y';
export type Guide=
  // axis 'x': the vertical line x=at from y=from to y=to; axis 'y': the horizontal line y=at.
  {type:'align';axis:Axis;at:number;from:number;to:number}|
  // axis 'x': a horizontal gap from x=start to x=end drawn at y=at; axis 'y': a vertical gap drawn at x=at.
  {type:'gap';axis:Axis;start:number;end:number;at:number}|
  // A block whose width (axis 'x') or height (axis 'y') equals the resized one.
  {type:'size';axis:Axis;bounds:Bounds};
export interface MoveSnap{dx:number;dy:number;guides:Guide[]}
export interface ResizeSnap{bounds:Bounds;guides:Guide[]}
const SNAPPABLE=new Set(['rectangle','text','image','frame']);
const AXES=['x','y'] as const;
const other=(a:Axis):Axis=>a==='x'?'y':'x';
const start=(b:Bounds,a:Axis)=>a==='x'?b.x:b.y;
const length=(b:Bounds,a:Axis)=>a==='x'?b.width:b.height;
const end=(b:Bounds,a:Axis)=>start(b,a)+length(b,a);
const lines=(b:Bounds,a:Axis)=>[start(b,a),start(b,a)+length(b,a)/2,end(b,a)];
const intersects=(a:Bounds,b:Bounds)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
export function snapTargets(board:Board,exclude:number[],view:Bounds):Bounds[]{
  const skip=new Set(exclude);
  return board.elements.filter(e=>SNAPPABLE.has(e.kind)&&!skip.has(e.id)&&intersects(e,view)).map(({x,y,width,height})=>({x,y,width,height}));
}
export function unionBounds(bounds:Bounds[]):Bounds|null{
  if(!bounds.length)return null;
  const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y));
  return{x,y,width:Math.max(...bounds.map(b=>b.x+b.width))-x,height:Math.max(...bounds.map(b=>b.y+b.height))-y};
}
// The smallest correction within the threshold that puts one of `from` on one of `to`.
function nearest(from:number[],to:number[],threshold:number):number|null{
  let best:number|null=null;
  for(const a of from)for(const b of to){const d=b-a;if(Math.abs(d)<=threshold&&(best===null||Math.abs(d)<Math.abs(best)))best=d;}
  return best;
}
// One guide per position of `b` that some target shares, spanning b and every such target.
function alignGuides(b:Bounds,targets:Bounds[],axis:Axis,positions:number[]):Guide[]{
  const o=other(axis),guides:Guide[]=[];
  for(const at of new Set(positions)){
    const hits=targets.filter(t=>lines(t,axis).some(v=>Math.abs(v-at)<SAME));if(!hits.length)continue;
    const all=[b,...hits];guides.push({type:'align',axis,at,from:Math.min(...all.map(n=>start(n,o))),to:Math.max(...all.map(n=>end(n,o)))});
  }
  return guides;
}
export function snapMove(moving:Bounds,targets:Bounds[],threshold:number):MoveSnap{
  const delta={x:0,y:0};
  for(const axis of AXES)delta[axis]=nearest(lines(moving,axis),targets.flatMap(t=>lines(t,axis)),threshold)??0;
  const snapped={...moving,x:moving.x+delta.x,y:moving.y+delta.y};
  return{dx:delta.x,dy:delta.y,guides:AXES.flatMap(axis=>alignGuides(snapped,targets,axis,lines(snapped,axis)))};
}
// Only the dragged edges snap: to target edges and centres, or so that the size matches a target; the nearer one wins, an edge on a tie.
export function snapResize(bounds:Bounds,handle:ResizeHandle,targets:Bounds[],threshold:number):ResizeSnap{
  let b={...bounds};
  const dragged=AXES.map(axis=>({axis,low:handle.includes(axis==='x'?'w':'n'),high:handle.includes(axis==='x'?'e':'s')})).filter(d=>d.low||d.high);
  for(const {axis,low} of dragged){
    const size=length(b,axis),toEdge=nearest([low?start(b,axis):end(b,axis)],targets.flatMap(t=>lines(t,axis)),threshold);
    // A larger size moves the dragged edge outward.
    const toSize=nearest([size],targets.map(t=>length(t,axis)),threshold),sizeShift=toSize===null?null:low?-toSize:toSize;
    const d=toEdge!==null&&(sizeShift===null||Math.abs(toEdge)<=Math.abs(sizeShift))?toEdge:sizeShift;if(d===null)continue;
    const next=low?size-d:size+d;if(next<MIN_SIZE||next>MAX_SIZE)continue;
    b=axis==='x'?{...b,x:low?b.x+d:b.x,width:next}:{...b,y:low?b.y+d:b.y,height:next};
  }
  const guides:Guide[]=[];
  for(const {axis,low} of dragged){
    guides.push(...alignGuides(b,targets,axis,[low?start(b,axis):end(b,axis)]));
    const same=targets.filter(t=>Math.abs(length(t,axis)-length(b,axis))<SAME);
    if(same.length)guides.push({type:'size',axis,bounds:b},...same.map(t=>({type:'size' as const,axis,bounds:t})));
  }
  return{bounds:b,guides};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test --project=unit e2e/unit/snap.spec.ts` and `npm run typecheck`
Expected: 11 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/snap.ts e2e/unit/snap.spec.ts
git commit -m "feat: compute edge, centre and size snapping for moves and resizes"
```

### Task 2: Равные отступы в `snapMove`

**Files:**
- Modify: `frontend/src/snap.ts` (LF)
- Test: `e2e/unit/snap.spec.ts`

**Interfaces:**
- Consumes: `nearest`, `alignGuides`, `lines`, `start`, `end`, `length`, `other`, `AXES` из Task 1.
- Produces: `snapMove` с тем же контрактом, теперь с кандидатами равных отступов и направляющими `{type:'gap'}`.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/unit/snap.spec.ts`:

```ts
test('a block between two neighbours snaps to equal gaps',()=>{
  const s=snapMove(b(403,100),[b(100,100),b(700,100)],6);
  expect(s.dx).toBe(-3);
  expect(s.guides.filter(g=>g.type==='gap')).toEqual([{type:'gap',axis:'x',start:320,end:400,at:156},{type:'gap',axis:'x',start:620,end:700,at:156}]);
});
test('a block repeats the step of its row on either side',()=>{
  const left=snapMove(b(703,100),[b(100,100),b(400,100)],6);
  expect(left.dx).toBe(-3);
  expect(left.guides.filter(g=>g.type==='gap')).toEqual([{type:'gap',axis:'x',start:320,end:400,at:156},{type:'gap',axis:'x',start:620,end:700,at:156}]);
  expect(snapMove(b(97,100),[b(400,100),b(700,100)],6).dx).toBe(3);
});
test('equal gaps work in columns too',()=>{
  const s=snapMove(b(100,295),[b(100,100),b(100,500)],6);
  expect(s.dy).toBe(5);
  expect(s.guides.filter(g=>g.type==='gap')).toEqual([{type:'gap',axis:'y',start:212,end:300,at:210},{type:'gap',axis:'y',start:412,end:500,at:210}]);
});
test('alignment wins a tie with equal gaps',()=>{
  const s=snapMove(b(403,100),[b(100,100),b(700,100),b(400,400,300)],6);
  expect(s.dx).toBe(-3);
  expect(s.guides.some(g=>g.type==='gap')).toBe(false);
  expect(s.guides).toContainEqual({type:'align',axis:'x',at:400,from:100,to:512});
});
test('a nearer equal gap beats a farther alignment',()=>{
  const s=snapMove(b(402,100),[b(100,100),b(700,100),b(397,400,300)],6);
  expect(s.dx).toBe(-2);
  expect(s.guides.filter(g=>g.type==='gap')).toHaveLength(2);
});
test('blocks outside the row do not count for gaps',()=>{
  expect(snapMove(b(403,100),[b(100,400),b(700,400)],6).dx).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=unit e2e/unit/snap.spec.ts`
Expected: FAIL — four tests: `a block between two neighbours…`, `a block repeats the step…`, `equal gaps work in columns too` (shift 0, no gap guides) and `a nearer equal gap beats a farther alignment` (dx -5). `alignment wins a tie…` and `blocks outside the row…` pass already; they guard the new code.

- [ ] **Step 3: Write the implementation**

In `frontend/src/snap.ts`, add before `snapMove`:

```ts
// Blocks overlapping `b` on the cross axis form its row (axis 'x') or column (axis 'y').
const sameRow=(a:Bounds,b:Bounds,axis:Axis)=>{const o=other(axis);return start(a,o)<end(b,o)&&start(b,o)<end(a,o);};
interface GapSnap{delta:number;gaps:[number,number][]}
// Equal spacing in the row: centred between the nearest neighbours, or repeating the step between a neighbour and the block beyond it.
function gapSnap(m:Bounds,targets:Bounds[],axis:Axis,threshold:number):GapSnap|null{
  const row=targets.filter(t=>sameRow(t,m,axis)),size=length(m,axis);
  const before=row.filter(t=>end(t,axis)<=start(m,axis)).sort((p,q)=>end(q,axis)-end(p,axis)),after=row.filter(t=>start(t,axis)>=end(m,axis)).sort((p,q)=>start(p,axis)-start(q,axis));
  const l=before[0],r=after[0],candidates:{at:number;gaps:(at:number)=>[number,number][]}[]=[];
  if(l&&r){const gap=(start(r,axis)-end(l,axis)-size)/2;if(gap>=0)candidates.push({at:end(l,axis)+gap,gaps:at=>[[end(l,axis),at],[at+size,start(r,axis)]]});}
  const l2=l?before.find(t=>end(t,axis)<=start(l,axis)):undefined;
  if(l&&l2){const step=start(l,axis)-end(l2,axis);candidates.push({at:end(l,axis)+step,gaps:at=>[[end(l2,axis),start(l,axis)],[end(l,axis),at]]});}
  const r2=r?after.find(t=>start(t,axis)>=end(r,axis)):undefined;
  if(r&&r2){const step=start(r2,axis)-end(r,axis);candidates.push({at:start(r,axis)-step-size,gaps:at=>[[at+size,start(r,axis)],[end(r,axis),start(r2,axis)]]});}
  let best:GapSnap|null=null;
  for(const c of candidates){const delta=c.at-start(m,axis);if(Math.abs(delta)<=threshold&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,gaps:c.gaps(c.at)};}
  return best;
}
```

Replace the whole `snapMove` function with:

```ts
export function snapMove(moving:Bounds,targets:Bounds[],threshold:number):MoveSnap{
  const delta={x:0,y:0},spacing:Record<Axis,GapSnap|null>={x:null,y:null};
  for(const axis of AXES){
    const align=nearest(lines(moving,axis),targets.flatMap(t=>lines(t,axis)),threshold),gap=gapSnap(moving,targets,axis,threshold);
    // Alignment wins a tie.
    if(align!==null&&(!gap||Math.abs(align)<=Math.abs(gap.delta)))delta[axis]=align;
    else if(gap){delta[axis]=gap.delta;spacing[axis]=gap;}
  }
  const snapped={...moving,x:moving.x+delta.x,y:moving.y+delta.y},guides:Guide[]=[];
  for(const axis of AXES){
    guides.push(...alignGuides(snapped,targets,axis,lines(snapped,axis)));
    const o=other(axis),at=start(snapped,o)+length(snapped,o)/2;
    for(const [from,to] of spacing[axis]?.gaps??[])guides.push({type:'gap',axis,start:from,end:to,at});
  }
  return{dx:delta.x,dy:delta.y,guides};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test --project=unit e2e/unit/snap.spec.ts` and `npm run typecheck`
Expected: 17 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/snap.ts e2e/unit/snap.spec.ts
git commit -m "feat: snap moved blocks to equal gaps in their row or column"
```

### Task 3: Направляющие на холсте при переносе и Alt

**Files:**
- Modify: `frontend/src/overlay.ts` (LF), `frontend/src/canvas.ts` (CRLF), `frontend/src/interaction.ts` (CRLF)
- Test: `e2e/smart-guides.spec.ts` (LF, new)

**Interfaces:**
- Consumes: `SNAP_PX`, `snapMove`, `snapTargets`, `unionBounds`, `type Guide` из Tasks 1–2; `setup`, `board`, `apply`, `box`, `bounding` из `e2e/ux-helpers.ts` (`setup` создаёт доску с карточкой id 1 в (100, 100), 220×112, ревизия после неё 1; камера 1:1).
- Produces: `CanvasView.previewGuides(guides:Guide[])`, `CanvasView.visibleWorld():Bounds`, поле `guides:Guide[]` в `OverlayState`; в `Interaction` — `type MoveGesture`, `type ResizeGesture`, `private dragMove(g:MoveGesture,free:boolean)`, `private targetsInView(board,exclude)`, `private alt(e:KeyboardEvent)`, поле `swallowAlt`; Task 4 расширяет `alt` и добавляет `dragResize`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/smart-guides.spec.ts`:

```ts
import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
const guides=(page:Page,type:string,axis?:string)=>page.locator(axis?`[data-guide="${type}"][data-axis="${axis}"]`:`[data-guide="${type}"]`);
const element=async(page:Page,id:string,n:number)=>(await board(page,id)).elements.find((e:{id:number})=>e.id===n);
async function add(page:Page,id:string,elements:unknown[],last:number){await apply(page,id,1,elements);await expect(page.locator(`#scene [data-id="${last}"]`)).toBeVisible();}
// Presses block n 35px inside its corner and moves the pointer by (dx,dy) screen pixels, leaving the button down.
async function press(page:Page,n:number,dx:number,dy:number){const b=await box(page,n);await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+35+dx,b.y+35+dy,{steps:8});}
test('moving_snaps_a_left_edge_to_a_neighbour_and_shows_a_guide',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);await expect(guides(page,'align','y')).toHaveCount(0);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);expect((await element(page,id,1)).y).toBe(100);await expect(guides(page,'align')).toHaveCount(0);
});
test('moving_snaps_a_centre_to_a_neighbour_centre',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,444,0);await page.mouse.up();await expect.poll(async()=>(await element(page,id,1)).x).toBe(540);
});
test('a_group_snaps_by_its_common_bounds',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:100,y:300,text:'B'}},{op:'create',element:{kind:'rectangle',x:900,y:500,text:'C'}}],3);
  const a=await box(page,1),c=await box(page,2);await page.mouse.click(a.x+35,a.y+35);await page.keyboard.down('Shift');await page.mouse.click(c.x+35,c.y+35);await page.keyboard.up('Shift');
  await press(page,1,797,0);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(900);expect((await element(page,id,2)).x).toBe(900);
});
test('a_block_between_two_neighbours_snaps_to_equal_gaps',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:700,y:100,text:'B'}},{op:'create',element:{kind:'rectangle',x:300,y:400,text:'C'}}],3);
  await press(page,3,103,-300);await expect(guides(page,'gap','x')).toHaveCount(2);await expect(guides(page,'gap','x').first()).toContainText('80');await expect(guides(page,'gap','x').last()).toContainText('80');await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,3)).x).toBe(400);
});
test('a_block_repeats_the_step_of_its_row',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:100,text:'B'}},{op:'create',element:{kind:'rectangle',x:100,y:400,text:'C'}}],3);
  await press(page,3,603,-300);await expect(guides(page,'gap','x')).toHaveCount(2);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,3)).x).toBe(700);
});
test('snapping_still_drops_a_block_into_a_frame',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'frame',x:500,y:300,width:400,height:300,text:'F'}}],2);
  await press(page,1,403,320);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);const card=await element(page,id,1);expect([card.y,card.parentFrameId]).toEqual([420,2]);
});
test('a_moved_frame_is_not_pulled_by_its_own_children',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'frame',x:100,y:300,width:400,height:300,text:'F'}},{op:'create',element:{kind:'rectangle',x:150,y:350,text:'Child'}},{op:'update',id:3,patch:{parentFrameId:2}}],3);
  const header=await bounding(page.locator('#scene [data-id="2"] [data-frame-header-hit]'));
  await page.mouse.move(header.x+header.width/2,header.y+header.height/2);await page.mouse.down();await page.mouse.move(header.x+header.width/2+47,header.y+header.height/2,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,2)).x).toBe(147);expect((await element(page,id,3)).x).toBe(197);
});
test('a_click_or_a_tiny_press_near_a_neighbour_line_moves_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:103,y:400,width:300,height:112,text:'B'}}],2);
  const b=await box(page,1);await page.mouse.click(b.x+35,b.y+35);await press(page,1,2,0);await page.mouse.up();await page.waitForTimeout(300);
  const doc=await board(page,id);expect(doc.revision).toBe(2);expect(doc.elements.find((e:{id:number})=>e.id===1).x).toBe(100);
});
test('alt_moves_freely_repaints_without_moving_and_never_reaches_the_browser',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await page.evaluate(()=>{const w=window as unknown as {altPrevented:boolean[]};w.altPrevented=[];addEventListener('keyup',e=>{if(e.key==='Alt')w.altPrevented.push(e.defaultPrevented);});});
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);
  await page.keyboard.down('Alt');await expect(guides(page,'align')).toHaveCount(0);
  await page.keyboard.up('Alt');await expect(guides(page,'align','x')).toHaveCount(1);
  await page.keyboard.down('Alt');await page.mouse.up();await page.keyboard.up('Alt');
  await expect.poll(async()=>(await element(page,id,1)).x).toBe(503);
  expect(await page.evaluate(()=>(window as unknown as {altPrevented:boolean[]}).altPrevented)).toEqual([true,true]);
});
test('window_blur_during_a_move_clears_guides_and_moves_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(2);
});
test('escape_clears_guides_and_one_undo_reverts_a_snapped_move',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:400,width:300,height:112,text:'B'}}],2);
  await press(page,1,403,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.keyboard.press('Escape');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.waitForTimeout(200);expect((await board(page,id)).revision).toBe(2);
  await press(page,1,403,0);await page.mouse.up();await expect.poll(async()=>(await element(page,id,1)).x).toBe(500);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await element(page,id,1)).x).toBe(100);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build` then `npx playwright test --project=chromium e2e/smart-guides.spec.ts`
Expected: FAIL — no `[data-guide]` nodes, blocks land at their raw positions. `a_click_or_a_tiny_press_near_a_neighbour_line_moves_nothing` and `a_moved_frame_is_not_pulled_by_its_own_children` pass already: they guard the new code against regressions.

- [ ] **Step 3: Draw guides in the overlay**

In `frontend/src/overlay.ts`:

- Add `import type {Guide} from './snap';` after the other imports, and after `const ACCENT='#7e4bb2';` add `const GUIDE='#e8467c';`.
- In `OverlayState`, after `wire:Point[]|null;` add `guides:Guide[];`.
- After the `marquee` field add:

```ts
  private guides=svgElement('g',{'data-guides':'','pointer-events':'none'});
```

- In the constructor change the root order to `root.replaceChildren(this.hover,this.drop,this.create,this.wire,this.target,this.frames,this.guides,this.connect,this.controls,this.marquee);`.
- In `render`, after the marquee line (`show(this.marquee,…)`) add `this.paintGuides(s.guides,z);`.
- Add the method after `render`:

```ts
  // Pooled guide groups: a path with its ticks, and for a gap its length on a white plate.
  private paintGuides(guides:Guide[],z:number){
    while(this.guides.childElementCount<guides.length){const g=svgElement('g',{display:'none'});g.append(svgElement('path',{fill:'none',stroke:GUIDE}),svgElement('rect',{fill:'#ffffff'}),svgElement('text',{fill:GUIDE,'font-family':'Golos Text','text-anchor':'middle','dominant-baseline':'central'}));this.guides.append(g);}
    [...this.guides.children].forEach((node,i)=>{
      const guide=guides[i];show(node,!!guide);if(!guide){node.removeAttribute('data-guide');node.removeAttribute('data-axis');return;}
      const path=node.children[0],plate=node.children[1],label=node.children[2],t=4/z;let d='',text='',lx=0,ly=0;
      if(guide.type==='align')d=guide.axis==='x'?`M ${guide.at} ${guide.from} V ${guide.to}`:`M ${guide.from} ${guide.at} H ${guide.to}`;
      else{
        const b=guide.type==='size'?guide.bounds:null,[s,e,at]=b?guide.axis==='x'?[b.x,b.x+b.width,b.y-8/z]:[b.y,b.y+b.height,b.x+b.width+8/z]:guide.type==='gap'?[guide.start,guide.end,guide.at]:[0,0,0];
        d=guide.axis==='x'?`M ${s} ${at} H ${e} M ${s} ${at-t} V ${at+t} M ${e} ${at-t} V ${at+t}`:`M ${at} ${s} V ${e} M ${at-t} ${s} H ${at+t} M ${at-t} ${e} H ${at+t}`;
        if(guide.type==='gap'){text=String(Math.round(e-s));[lx,ly]=guide.axis==='x'?[(s+e)/2,at]:[at,(s+e)/2];}
      }
      setAttrs(node,{'data-guide':guide.type,'data-axis':guide.axis});setAttrs(path,{d,'stroke-width':1/z});
      show(plate,!!text);show(label,!!text);label.textContent=text;
      if(text){const w=(text.length*7+8)/z,h=16/z;setAttrs(plate,{x:lx-w/2,y:ly-h/2,width:w,height:h,rx:3/z});setAttrs(label,{x:lx,y:ly,'font-size':11/z});}
    });
  }
```

- [ ] **Step 4: Plumb guides through `CanvasView`**

In `frontend/src/canvas.ts` (CRLF):

- Add `import type {Guide} from './snap';` after the `layoutConnector` import.
- After the `private wire:…` field line add `  private guides:Guide[]=[];`.
- After `previewWire(…){…}` add:

```ts
  previewGuides(guides:Guide[]){if(!guides.length&&!this.guides.length)return;this.guides=guides;this.frames.invalidate('overlay');}
  // The world rectangle under the canvas.
  visibleWorld():Bounds{const rect=this.svg.getBoundingClientRect(),z=this.camera.zoom;return{x:-this.camera.x/z,y:-this.camera.y/z,width:rect.width/z,height:rect.height/z};}
```

- In `clearPreview`, after `this.wire=null;` add `this.guides=[];`.
- In `paintOverlay`, in the `this.overlay.render({…})` call, after `wire:this.wire?.points??null,` add `guides:this.guides,`.

- [ ] **Step 5: Snap the move gesture and handle Alt**

In `frontend/src/interaction.ts` (CRLF):

- Add `import {SNAP_PX,snapMove,snapTargets,unionBounds,type Guide} from './snap';` after the `anchors` import.
- In the `Gesture` type, change the `move` member to end with `targets:Map<number,number|null>;base:EditState;box:Bounds|null;snap:Bounds[];client:Point}` and the `resize` member to `{type:'resize';start:Point;element:Element;handle:ResizeHandle;bounds:Bounds;base:EditState;snap:Bounds[];client:Point;shift:boolean}`.
- After the `Gesture` type add:

```ts
type MoveGesture=Extract<Gesture,{type:'move'}>;type ResizeGesture=Extract<Gesture,{type:'resize'}>;
// The editor's click tolerance in screen pixels: a press that has not moved further never snaps.
const CLICK_PX=2;
```

- In the class fields line after `private nudge:Nudge|null=null;` add `private swallowAlt=false;`.
- In the constructor, after the `contextmenu`/`pointerleave` line add:

```ts
    // Alt frees a move from snapping and repaints at once; the browser never sees an Alt used in a gesture (Firefox would open the window menu on release).
    for(const type of ['keydown','keyup'] as const)window.addEventListener(type,e=>this.alt(e));
```

- In `down`, the resize begin: replace `bounds:{...element},base:this.callbacks.editState()});return;}` with `bounds:{...element},base:this.callbacks.editState(),snap:this.targetsInView(board,[element.id]),client:{x:event.clientX,y:event.clientY},shift:event.shiftKey});return;}`. Task 4 uses these fields; until then the resize branch ignores them.
- In `down`, the move begin: replace `if(target.kind!=='connector'&&selected.includes(target.id))this.begin({type:'move',pointer:event.pointerId,start:point,ids:[...selected],preview:members(board,selected),board:structuredClone(board),dx:0,dy:0,targets:new Map(),base:this.callbacks.editState()});}` with:

```ts
if(target.kind!=='connector'&&selected.includes(target.id)){const preview=members(board,selected);this.begin({type:'move',pointer:event.pointerId,start:point,ids:[...selected],preview,board:structuredClone(board),dx:0,dy:0,targets:new Map(),base:this.callbacks.editState(),box:unionBounds(board.elements.filter(e=>selected.includes(e.id)&&e.kind!=='connector')),snap:this.targetsInView(board,preview),client:{x:event.clientX,y:event.clientY}});}}
```

- In `move`, replace the whole `if(g.type==='move'){g.dx=point.x-g.start.x;…this.view.highlightDrop([...g.targets.values()].find(id=>id!==null)??null);}` with `if(g.type==='move'){g.client={x:event.clientX,y:event.clientY};this.dragMove(g,event.altKey);}`.
- Add these methods after `begin`:

```ts
  // Snap targets are taken once: the wheel does not move the camera during a move or resize.
  private targetsInView(board:Board,exclude:number[]){return snapTargets(board,exclude,this.view.visibleWorld());}
  private dragMove(g:MoveGesture,free:boolean){
    const point=this.view.worldPoint(g.client.x,g.client.y),z=this.view.camera.zoom;let dx=point.x-g.start.x,dy=point.y-g.start.y,guides:Guide[]=[];
    if(!free&&g.box&&Math.hypot(dx,dy)*z>CLICK_PX){const s=snapMove({...g.box,x:g.box.x+dx,y:g.box.y+dy},g.snap,SNAP_PX/z);dx+=s.dx;dy+=s.dy;guides=s.guides;}
    g.dx=dx;g.dy=dy;this.view.previewMove(g.preview,g.dx,g.dy);this.view.previewGuides(guides);
    g.targets.clear();const roots=g.ids.filter(id=>{const e=g.board.elements.find(e=>e.id===id);return e&&e.kind!=='connector'&&!g.ids.some(other=>other!==id&&members(g.board,[other]).includes(id));});for(const id of roots){const e=g.board.elements.find(e=>e.id===id)!;g.targets.set(id,dropTarget(g.board,id,{x:e.x+e.width/2+g.dx,y:e.y+e.height/2+g.dy},g.preview));}this.view.highlightDrop([...g.targets.values()].find(id=>id!==null)??null);
  }
  private alt(e:KeyboardEvent){
    if(e.key!=='Alt')return;const g=this.gesture;
    if(g?.type==='move'){this.swallowAlt=e.type==='keydown';e.preventDefault();this.dragMove(g,e.altKey);return;}
    if(e.type==='keyup'&&this.swallowAlt){this.swallowAlt=false;e.preventDefault();}
  }
```

The drop-target code in `dragMove` is the code removed from the `move` branch, unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run typecheck`, `npm run build`, `npx playwright test e2e/smart-guides.spec.ts e2e/connect-handles.spec.ts e2e/editor.spec.ts e2e/editor-ux.spec.ts`
Expected: typecheck clean; all pass in chromium, firefox and webkit.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/overlay.ts frontend/src/canvas.ts frontend/src/interaction.ts e2e/smart-guides.spec.ts
git commit -m "feat: snap moved blocks to their neighbours with guides, Alt moves freely"
```

### Task 4: Привязка при ресайзе

**Files:**
- Modify: `frontend/src/interaction.ts` (CRLF)
- Test: `e2e/smart-guides.spec.ts`

**Interfaces:**
- Consumes: `snapResize` из Task 1; поля `snap`, `client`, `shift` жеста `resize`, `CLICK_PX`, `alt`, `swallowAlt` из Task 3; хелперы `guides`, `element`, `add` из `e2e/smart-guides.spec.ts`.
- Produces: `private dragResize(g:ResizeGesture,free:boolean)`; `alt` обслуживает и ресайз.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/smart-guides.spec.ts`:

```ts
// Selects card 1, holds `hold` if given, presses its resize handle and moves the pointer by (dx,dy), leaving the button down. A Shift-click would deselect the card, so the key goes down after the click.
async function grabHandle(page:Page,handle:string,dx:number,dy:number,hold?:string){const b=await box(page,1);await page.mouse.click(b.x+35,b.y+35);const h=await bounding(page.locator(`[data-handle="${handle}"]`)),x=h.x+h.width/2,y=h.y+h.height/2;if(hold)await page.keyboard.down(hold);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});}
test('resizing_snaps_an_edge_to_a_neighbour_edge',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:300,text:'B'}}],2);
  await grabHandle(page,'se',77,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(300);const card=await element(page,id,1);expect([card.x,card.height]).toEqual([100,112]);
});
test('resizing_matches_a_neighbour_size_and_marks_both_blocks',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:500,y:300,width:300,height:150,text:'B'}}],2);
  await grabHandle(page,'e',77,0);await expect(guides(page,'size','x')).toHaveCount(2);await page.mouse.up();
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(300);
});
test('alt_and_shift_resize_without_snapping',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:400,y:300,text:'B'}}],2);
  await grabHandle(page,'e',77,0);await expect(guides(page,'align','x')).toHaveCount(1);await page.keyboard.down('Alt');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.keyboard.up('Alt');
  await expect.poll(async()=>(await element(page,id,1)).width).toBe(297);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await element(page,id,1)).width).toBe(220);
  await grabHandle(page,'e',77,0,'Shift');await expect(guides(page,'align')).toHaveCount(0);await page.mouse.up();await page.keyboard.up('Shift');
  await expect.poll(async()=>(await element(page,id,1)).width).toBeCloseTo(297,3);
});
test('pressing_a_handle_without_moving_near_a_neighbour_line_changes_nothing',async({page})=>{
  const id=await setup(page);await add(page,id,[{op:'create',element:{kind:'rectangle',x:323,y:300,text:'B'}}],2);
  await grabHandle(page,'e',0,0);await page.mouse.up();await page.waitForTimeout(300);
  const doc=await board(page,id);expect(doc.revision).toBe(2);expect(doc.elements.find((e:{id:number})=>e.id===1).width).toBe(220);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build` then `npx playwright test --project=chromium e2e/smart-guides.spec.ts -g "resiz|handle"`
Expected: FAIL — widths 297 instead of 300, no `[data-guide]` during a resize. `alt_and_shift…` and `pressing_a_handle…` may pass already; they guard the new code.

- [ ] **Step 3: Write the implementation**

In `frontend/src/interaction.ts` (CRLF):

- Change the import from `./snap` to `import {SNAP_PX,snapMove,snapResize,snapTargets,unionBounds,type Guide} from './snap';`.
- In `move`, replace the final branch `else{g.bounds=resizeBounds(g.element,g.handle,point.x-g.start.x,point.y-g.start.y,event.shiftKey);this.view.previewResize(g.element.id,g.bounds.width,g.bounds.height,g.bounds.x,g.bounds.y);}` with `else{g.client={x:event.clientX,y:event.clientY};g.shift=event.shiftKey;this.dragResize(g,event.altKey);}`.
- Add after `dragMove`:

```ts
  // Shift keeps the aspect ratio, so it resizes without snapping.
  private dragResize(g:ResizeGesture,free:boolean){
    const point=this.view.worldPoint(g.client.x,g.client.y),z=this.view.camera.zoom,dx=point.x-g.start.x,dy=point.y-g.start.y;let bounds=resizeBounds(g.element,g.handle,dx,dy,g.shift),guides:Guide[]=[];
    if(!free&&!g.shift&&Math.hypot(dx,dy)*z>CLICK_PX){const s=snapResize(bounds,g.handle,g.snap,SNAP_PX/z);bounds=s.bounds;guides=s.guides;}
    g.bounds=bounds;this.view.previewResize(g.element.id,bounds.width,bounds.height,bounds.x,bounds.y);this.view.previewGuides(guides);
  }
```

- In `alt`, replace `if(g?.type==='move'){this.swallowAlt=e.type==='keydown';e.preventDefault();this.dragMove(g,e.altKey);return;}` with:

```ts
    if(g?.type==='move'||g?.type==='resize'){this.swallowAlt=e.type==='keydown';e.preventDefault();if(g.type==='move')this.dragMove(g,e.altKey);else this.dragResize(g,e.altKey);return;}
```

- Update the constructor comment to `// Alt frees a move or resize from snapping and repaints at once; the browser never sees an Alt used in a gesture (Firefox would open the window menu on release).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck`, `npm run build`, `npx playwright test e2e/smart-guides.spec.ts e2e/editor.spec.ts e2e/editor-ux.spec.ts e2e/ux-actions.spec.ts`
Expected: typecheck clean; all pass in chromium, firefox and webkit.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/interaction.ts e2e/smart-guides.spec.ts
git commit -m "feat: snap resized edges and sizes to neighbours, Shift and Alt resize freely"
```

### Task 5: Бюджет кадра, документы и полный прогон

**Files:**
- Modify: `e2e/perf.spec.ts`, `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, `docs/superpowers/specs/2026-10-21-smart-guides-design.md` (строка статуса), `docs/superpowers/plans/2026-10-21-smart-guides.md` (раздел «Результаты»)

**Interfaces:**
- Consumes: `bigBoard`, `frames`, `p90`, `FRAME_BUDGET_MS`, `box` из `e2e/perf.spec.ts`; привязка из Tasks 3–4.
- Produces: тест бюджета привязки; записанные замеры.

- [ ] **Step 1: Budget test**

In `e2e/perf.spec.ts`, inside `test.describe('smoothness budget on 300 elements',…)`, after the last test add:

```ts
  test('dragging_among_neighbours_with_snapping_stays_within_the_frame_budget',async({page})=>{
    await bigBoard(page);const b=await box(page);
    const drag=await frames(page,async()=>{await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(b.x+35+i*7,b.y+35+i*9);await expect(page.locator('[data-guide]').first()).toBeAttached();await page.keyboard.press('Escape');await page.mouse.up();});
    expect(drag.length).toBeGreaterThan(5);expect(p90(drag)).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
```

The block moves from (100, 100) down into the grid of `bigBoard` (columns every 240, rows every 180 from y 300), so the pointer passes many snap lines; the `[data-guide]` check proves snapping ran.

- [ ] **Step 2: Run the budget test three times**

Run: `npm run build` then `npx playwright test --project=chromium e2e/perf.spec.ts -g snapping --repeat-each=3`
Expected: 3 passed. Record p90 of each run: add `console.log('snap drag p90',p90(drag))` temporarily, read it from the output, then remove the line before committing. If the budget fails, profile `snapMove` (the per-move cost is linear in visible targets) before changing any budget; budgets are not changed in this plan.

- [ ] **Step 3: Docs**

- In `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, section «Дорожная карта», after the line `Этап 2b (точки и «+» для блоков и связей, спек 2026-10-20-connect-handles-design.md) реализован; дальше этап 3.` add the line `Этап 3 (умные направляющие, равные отступы и одинаковый размер, спек 2026-10-21-smart-guides-design.md) реализован; дальше этап 4.`
- In `docs/superpowers/specs/2026-10-21-smart-guides-design.md`, change `Статус: дизайн утверждён в обсуждении, ожидает ревью спека.` to `Статус: реализован (этап 3).`

- [ ] **Step 4: Full run and results**

Run: `cargo test`, `npm run typecheck`, `npm run build`, `npx playwright test`.
Expected: all green. Append `## Результаты` to this plan: p90 of the three budget runs, the per-project Playwright counts (passed, skipped, failed), `cargo test` count, and every red seen on the way with its cause (one paragraph per line, no trailing blank line).

- [ ] **Step 5: Commit**

```bash
git add e2e/perf.spec.ts docs/superpowers/specs/2026-10-19-editor-smoothness-design.md docs/superpowers/specs/2026-10-21-smart-guides-design.md docs/superpowers/plans/2026-10-21-smart-guides.md
git commit -m "test: budget snapping and record stage 3 results"
```
