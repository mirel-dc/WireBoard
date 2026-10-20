# Inline-редактирование текста — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Текст блока печатается прямо в блоке на холсте, как в Miro: форма «Текст карточки» исчезает, блок растёт по высоте, конфликт с агентом не теряет черновик.

**Architecture:** Чистый модуль `text-model.ts` держит правила «первая строка — заголовок» (разрез, склейка, вставка), расчёт роста и сборку команды. `text-editor.ts` — два `textarea` в HTML-слое над холстом, привязанные к мировым координатам блока через `transform`. `CanvasView` получает режим правки (`setEditing`, `previewTextHeight`, `textBox`): SVG-текст редактируемого объекта не рисуется, выделение скрыто. `editor.ts` связывает всё с очередью команд: одна команда «Изменение текста» (`update` + `resize`), плашка конфликта, закрытие при удалении агентом.

**Tech Stack:** TypeScript 5.9 без фреймворка, Vite 7, SVG DOM, HTML `textarea`; Playwright 1.58+ (e2e и node-side unit).

**Spec:** `docs/superpowers/specs/2026-10-19-inline-text-editing-design.md`

## Global Constraints

- Сервер, формат файла доски и CLI-контракт не меняются; новые npm- и cargo-зависимости не добавляются.
- Ограничения сервера: `title` до 256 символов и только у `rectangle`, `text` до 10000 символов, высота от 20 до 10000.
- Тексты интерфейса — на русском; коммиты — на английском, формат `<type>: <description>`.
- Стиль кода как в `frontend/src`: плотные строки, комментарий только там, где причина неочевидна.
- Окончания строк сохраняются: CRLF в `frontend/src/canvas.ts`, `editor.ts`, `interaction.ts`, `frontend/index.html`, `frontend/src/style.css`, `e2e/editor-ux.spec.ts`, `e2e/editor.spec.ts`, `e2e/review-regressions.spec.ts`; остальные затронутые файлы и новые файлы — LF. Перед коммитом проверить `git diff --stat` (правка одной строки не должна давать diff всего файла).
- Перед любым запуском Playwright выполнить `npm run build`: сервер в debug-сборке читает `frontend/dist` с диска.
- Id и подписи, на которые опираются тесты: `#text-editor` (слой, `data-kind` = вид объекта), `#title-draft` (`aria-label="Заголовок карточки"`), `#text-draft` (`aria-label="Текст объекта"`), `#text-conflict`, `#text-replace` («Заменить»), `#text-discard` («Отменить», `aria-label="Отменить мою правку текста"`). Формы `#text-dialog`, `#text-form`, `#draft-save`, `#draft-cancel`, `#draft-retry`, `#draft-message` удаляются.
- Сообщение при удалении объекта агентом: `Объект удалён другим клиентом, текст не сохранён.`
- Метка команды: `Изменение текста`. Минимальный зум при входе в правку: `0.5`. Бюджет: обработчик `input` + следующий кадр ≤16 мс (p90) на доске из 300 объектов в Chromium.

## Review Focus

- Агент меняет текст той же карточки, пока пользователь печатает: после Esc появляется плашка, черновик не теряется, модальный диалог очереди не всплывает (тест в Task 2).
- Клик по другому блоку во время правки: текст сохраняется и тот же клик выделяет другой блок (тест в Task 2).
- Окно теряет фокус (Alt+Tab) во время правки: редактор и выросшая высота остаются, команда не уходит (тест в Task 2).
- Delete и Backspace в поле правят текст и никогда не удаляют блок (тест в Task 2).
- Блок вырос, потом текст стёрли: высота возвращается к исходной, но не ниже (unit-тест в Task 1).

---

## Файлы

- Create `frontend/src/text-model.ts` — чистые правила текста карточки, рост, сборка операций.
- Rewrite `frontend/src/text-editor.ts` — `InlineTextEditor`: DOM-слой с двумя полями.
- Modify `frontend/src/canvas.ts` — `setEditing`, `previewTextHeight`, `textBox`, скрытие выделения.
- Modify `frontend/src/scene.ts` — пропуск SVG-текста редактируемого объекта.
- Modify `frontend/src/editor.ts` — поток правки, сохранение, конфликт, удаление.
- Modify `frontend/src/commands.ts` — `enqueue` принимает id команды.
- Modify `frontend/src/interaction.ts` — пустой текст при создании.
- Modify `frontend/index.html`, `frontend/src/style.css` — слой редактора, плашка конфликта, `user-select: none`.
- Create `e2e/unit/text-model.spec.ts`, `e2e/inline-text.spec.ts`; modify `e2e/perf.spec.ts` и тесты старой формы.
- Modify `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md` — дорожная карта.

### Task 1: Текстовая модель

**Files:**
- Create: `frontend/src/text-model.ts`
- Test: `e2e/unit/text-model.spec.ts`

**Interfaces:**
- Consumes: `layoutElement(e:Element,metrics:FontMetrics):ElementLayout` из `frontend/src/preview.ts` (`fitHeight` — высота, при которой весь текст помещается).
- Produces: `interface TextDraft{title:string;text:string}`; `interface Edit{draft:TextDraft;caret:{field:'title'|'text';offset:number}}`; константы `TITLE_MAX=256`, `TEXT_MAX=10000`, `MAX_HEIGHT=10000`, `MIN_EDIT_ZOOM=.5`; функции `displayTitle(title:string):string`, `draftOf(e:Element):TextDraft`, `splitTitle(d:TextDraft,start:number,end:number):Edit`, `joinTitle(d:TextDraft):Edit|null`, `pasteIntoTitle(d:TextDraft,start:number,end:number,pasted:string):Edit|null`, `growHeight(e:Element,d:TextDraft,metrics:FontMetrics):number`, `textOperations(e:Element,d:TextDraft,height:number):Operation[]`.

- [ ] **Step 1: Write the failing test**

Create `e2e/unit/text-model.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {MAX_HEIGHT,draftOf,growHeight,joinTitle,pasteIntoTitle,splitTitle,textOperations} from '../../frontend/src/text-model';
import {element,metrics} from './fixtures';
test('enter in the middle of the title moves the tail into the description',()=>{
  expect(splitTitle({title:'AB',text:'Card'},1,1)).toEqual({draft:{title:'A',text:'B\nCard'},caret:{field:'text',offset:0}});
  expect(splitTitle({title:'AB',text:''},1,1).draft).toEqual({title:'A',text:'B'});
  expect(splitTitle({title:'ABC',text:'Card'},1,2).draft).toEqual({title:'A',text:'C\nCard'});
});
test('enter at the end of the title only moves the caret',()=>{
  expect(splitTitle({title:'AB',text:'Card'},2,2)).toEqual({draft:{title:'AB',text:'Card'},caret:{field:'text',offset:0}});
});
test('backspace at the start of the description joins its first line to the title',()=>{
  expect(joinTitle({title:'A',text:'B\nCard'})).toEqual({draft:{title:'AB',text:'Card'},caret:{field:'title',offset:1}});
  expect(joinTitle({title:'A',text:'B'})!.draft).toEqual({title:'AB',text:''});
  expect(joinTitle({title:'A',text:'\nCard'})!.draft).toEqual({title:'A',text:'Card'});
});
test('backspace refuses a join that would exceed the title limit',()=>{
  expect(joinTitle({title:'x'.repeat(250),text:'y'.repeat(10)})).toBeNull();
});
test('a multi-line paste into the title splits at the first line break',()=>{
  expect(pasteIntoTitle({title:'AB',text:'Card'},1,1,'one\r\ntwo\nthree')).toEqual({draft:{title:'Aone',text:'two\nthreeB\nCard'},caret:{field:'text',offset:9}});
  expect(pasteIntoTitle({title:'AB',text:'Card'},1,1,'one')).toBeNull();
  expect(pasteIntoTitle({title:'x'.repeat(255),text:''},255,255,'abc\nd')!.draft.title).toBe('x'.repeat(255)+'a');
});
test('the block grows with the draft and never shrinks below its starting height',()=>{
  const e=element({id:1,kind:'rectangle',text:'Card'});
  expect(growHeight(e,{title:'',text:'Card'},metrics)).toBe(112);
  const long=growHeight(e,{title:'Заголовок',text:'Длинное описание '.repeat(20)},metrics);expect(long).toBeGreaterThan(112);
  expect(growHeight({...e,height:long},{title:'',text:''},metrics)).toBe(long);
  expect(growHeight(e,{title:'',text:'слово '.repeat(5000)},metrics)).toBe(MAX_HEIGHT);
  expect(growHeight(element({id:2,kind:'image'}),{title:'',text:'Длинное описание '.repeat(20)},metrics)).toBe(112);
});
test('only changed fields are sent, with a resize when the block grew',()=>{
  const e=element({id:3,kind:'rectangle',title:'Line\nbreak',text:'Card'});
  expect(draftOf(e)).toEqual({title:'Line break',text:'Card'});
  expect(textOperations(e,draftOf(e),112)).toEqual([]);
  expect(textOperations(e,{title:'New',text:'Card'},112)).toEqual([{op:'update',id:3,patch:{title:'New'}}]);
  expect(textOperations(e,{title:'Line break',text:'More'},180)).toEqual([{op:'update',id:3,patch:{text:'More'}},{op:'resize',id:3,width:220,height:180}]);
  expect(textOperations(element({id:4,kind:'text',text:'a'}),{title:'ignored',text:'a'},112)).toEqual([]);
  expect(draftOf(element({id:5,kind:'frame',text:'Слайд'}))).toEqual({title:'',text:'Слайд'});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit e2e/unit/text-model.spec.ts`
Expected: FAIL — `Cannot find module '../../frontend/src/text-model'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/text-model.ts`:

```ts
import {layoutElement} from './preview';
import type {Element,FontMetrics,Operation,Patch} from './types';
export interface TextDraft{title:string;text:string}
export interface Edit{draft:TextDraft;caret:{field:'title'|'text';offset:number}}
export const TITLE_MAX=256,TEXT_MAX=10000,MAX_HEIGHT=10000,MIN_EDIT_ZOOM=.5;
const GROWS=['rectangle','text'];
// Agents may store line breaks in a title; the single-line field shows them as spaces.
export const displayTitle=(title:string)=>title.replace(/\r?\n/g,' ');
export function draftOf(e:Element):TextDraft{return{title:e.kind==='rectangle'?displayTitle(e.title):'',text:e.text};}
const join=(head:string,text:string)=>text?`${head}\n${text}`:head;
// Enter in the title: the tail after the caret becomes the first line of the description.
export function splitTitle(d:TextDraft,start:number,end:number):Edit{
  const tail=d.title.slice(end);
  return{draft:{title:d.title.slice(0,start),text:tail?join(tail,d.text):d.text},caret:{field:'text',offset:0}};
}
// Backspace at the start of the description joins its first line to the title.
export function joinTitle(d:TextDraft):Edit|null{
  const br=d.text.indexOf('\n'),title=d.title+(br<0?d.text:d.text.slice(0,br));
  if(title.length>TITLE_MAX)return null;
  return{draft:{title,text:br<0?'':d.text.slice(br+1)},caret:{field:'title',offset:d.title.length}};
}
// A multi-line paste into the title keeps its first line there and moves the rest into the description.
export function pasteIntoTitle(d:TextDraft,start:number,end:number,pasted:string):Edit|null{
  const lines=pasted.replace(/\r\n?/g,'\n').split('\n');if(lines.length<2)return null;
  const rest=lines.slice(1).join('\n'),title=(d.title.slice(0,start)+lines[0]).slice(0,TITLE_MAX),text=join(rest+d.title.slice(end),d.text).slice(0,TEXT_MAX);
  return{draft:{title,text},caret:{field:'text',offset:Math.min(rest.length,text.length)}};
}
// The block grows to fit the draft but never shrinks below the height it had when editing began.
export function growHeight(e:Element,d:TextDraft,metrics:FontMetrics):number{
  if(!GROWS.includes(e.kind))return e.height;
  return Math.min(MAX_HEIGHT,Math.max(e.height,layoutElement({...e,title:d.title,text:d.text},metrics).fitHeight));
}
export function textOperations(e:Element,d:TextDraft,height:number):Operation[]{
  const patch:Patch={};if(e.kind==='rectangle'&&d.title!==displayTitle(e.title))patch.title=d.title;if(d.text!==e.text)patch.text=d.text;
  const operations:Operation[]=[];if(Object.keys(patch).length)operations.push({op:'update',id:e.id,patch});
  if(height!==e.height)operations.push({op:'resize',id:e.id,width:e.width,height});
  return operations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test --project=unit e2e/unit/text-model.spec.ts`
Expected: PASS (7 tests). Then `npm run typecheck` — no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/text-model.ts e2e/unit/text-model.spec.ts
git commit -m "feat: add the inline text model for cards"
```

### Task 2: Inline-редактор вместо формы

**Files:**
- Rewrite: `frontend/src/text-editor.ts`
- Modify: `frontend/src/canvas.ts`, `frontend/src/scene.ts`, `frontend/src/editor.ts`, `frontend/src/commands.ts:138-139`, `frontend/index.html` (элемент `#text-dialog`), `frontend/src/style.css:134-138`
- Test: create `e2e/inline-text.spec.ts`; modify `e2e/editor-ux.spec.ts:24`, `e2e/navigation-links.spec.ts:24`, `e2e/review-regressions.spec.ts:14-29`, `e2e/ux-actions.spec.ts:50`, `e2e/editor.spec.ts:35,62-64`, `e2e/comments.spec.ts:7,18`

**Interfaces:**
- Consumes: всё из Task 1; `CommandQueue.enqueue`, `makeGuards`, `CommandQueue.inFlightId`, `CommandQueue.mode`, `Editor.discard()`, `CanvasView.frames.invalidate('chrome')`, `CanvasView.onChrome`.
- Produces:
  - `CommandQueue.enqueue(intent:EditIntent,onConfirmed?:(commandId:string)=>void,id:string=crypto.randomUUID()):Promise<Board>`.
  - `CanvasView.editing:number|null`; `CanvasView.setEditing(id:number|null):void`; `CanvasView.previewTextHeight(height:number|null):void`; `CanvasView.textBox(id:number):Bounds|null` (в этой задаче — рамка объекта для всех видов; Task 3 добавляет фрейм и стрелку).
  - `SceneRenderer.editing:number|null`.
  - `class InlineTextEditor{constructor(callbacks:{input(draft:TextDraft):void;commit():void});readonly root:HTMLElement;get open():boolean;contains(target:EventTarget|null):boolean;show(e:Element,draft:TextDraft,selectAll?:boolean):void;focus():void;read():TextDraft;position(box:Bounds,camera:Camera):void;close():void}`.
  - `Editor.editText(id:number,selectAll=false)` и `Editor.openText(e:BoardElement,draft:TextDraft,selectAll=false)` — Task 4 их использует.

- [ ] **Step 1: Write the failing tests**

Create `e2e/inline-text.spec.ts`:

```ts
import {test,expect,type Page} from '@playwright/test';
import {setup,board,apply,box,bounding} from './ux-helpers';
import {projectScene} from '../frontend/src/preview';
const editor=(page:Page)=>page.locator('#text-editor');
async function open(page:Page,id=1){const b=await box(page,id);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await expect(editor(page)).toBeVisible();}
async function camera(page:Page){return page.locator('#world').evaluate(e=>{const m=(e as SVGGElement).transform.baseVal.consolidate()!.matrix;return{x:m.e,y:m.f,zoom:m.a};});}
async function wheel(page:Page,init:WheelEventInit){await page.locator('#canvas').evaluate(async(e,init)=>{e.dispatchEvent(new WheelEvent('wheel',{...init,bubbles:true,cancelable:true}));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));},init);}
test('double_click_edits_inside_the_block',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.dblclick(b.x+35,b.y+35);
  await expect(editor(page)).toBeVisible();await expect(page.locator('#text-dialog')).toHaveCount(0);
  const e=await bounding(editor(page));for(const k of ['x','y','width','height'] as const)expect(Math.abs(e[k]-b[k])).toBeLessThanOrEqual(1.5);
  await expect(page.locator('#scene [data-id="1"] text')).toHaveCount(0);await expect(page.locator('[data-handle="e"]')).toBeHidden();
  await expect(page.locator('#text-draft')).toBeFocused();await page.keyboard.type(' plus');await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Card plus');await expect(page.locator('#scene [data-id="1"]')).toContainText('Card plus');
});
test('enter_in_the_title_splits_the_card',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#title-draft').click();await page.keyboard.type('AB');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
  await expect(page.locator('#title-draft')).toHaveValue('A');await expect(page.locator('#text-draft')).toHaveValue('B\nCard');await expect(page.locator('#text-draft')).toBeFocused();
  await page.keyboard.press('Escape');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.title,e.text];}).toEqual(['A','B\nCard']);
});
test('backspace_at_the_description_start_joins_the_title',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{title:'A',text:'B\nCard'}}]);await expect(page.locator('#scene [data-id="1"]')).toContainText('Card');
  await open(page);await page.locator('#text-draft').evaluate(t=>(t as HTMLTextAreaElement).setSelectionRange(0,0));await page.keyboard.press('Backspace');
  await expect(page.locator('#title-draft')).toHaveValue('AB');await expect(page.locator('#text-draft')).toHaveValue('Card');await expect(page.locator('#title-draft')).toBeFocused();
  await page.keyboard.press('Escape');await expect.poll(async()=>{const e=(await board(page,id)).elements[0];return [e.title,e.text];}).toEqual(['AB','Card']);
});
test('multi_line_paste_into_the_title_moves_the_rest_down',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#title-draft').focus();
  await page.locator('#title-draft').evaluate(t=>{const event=new ClipboardEvent('paste',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true});event.clipboardData!.setData('text/plain','Заголовок\r\nпервая строка');t.dispatchEvent(event);});
  await expect(page.locator('#title-draft')).toHaveValue('Заголовок');await expect(page.locator('#text-draft')).toHaveValue('первая строка\nCard');
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements[0].title).toBe('Заголовок');
});
test('typing_grows_the_block_and_one_undo_reverts_text_and_height',async({page})=>{
  const id=await setup(page);const before=await box(page);await open(page);await page.locator('#text-draft').fill('Длинное описание '.repeat(20));
  await expect.poll(async()=>(await box(page)).height).toBeGreaterThan(before.height+20);
  expect(Math.abs((await bounding(editor(page))).height-(await box(page)).height)).toBeLessThanOrEqual(1.5);
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).revision).toBe(2);expect((await board(page,id)).elements[0].height).toBeGreaterThan(112);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await board(page,id)).revision).toBe(3);const e=(await board(page,id)).elements[0];expect([e.text,e.height]).toEqual(['Card',112]);
});
test('unchanged_text_sends_nothing',async({page})=>{
  const id=await setup(page);await open(page);await page.keyboard.press('Escape');await expect(editor(page)).toBeHidden();await page.waitForTimeout(200);
  expect((await board(page,id)).revision).toBe(1);await expect(page.locator('#undo')).toBeDisabled();
});
test('clicking_another_block_saves_and_selects_it',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'Second'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await open(page);await page.locator('#text-draft').fill('Saved by click');const second=await box(page,2);await page.mouse.click(second.x+35,second.y+35);
  await expect(editor(page)).toBeHidden();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Saved by click');
  const handle=await bounding(page.locator('[data-handle="e"]'));expect(handle.x).toBeGreaterThan(second.x+second.width/2);
});
test('editor_follows_wheel_pan_and_zoom',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Черновик');const start=await bounding(editor(page));
  await wheel(page,{deltaX:25,deltaY:35});await expect.poll(async()=>(await bounding(editor(page))).x).toBeCloseTo(start.x-25,0);
  await wheel(page,{deltaY:-100,ctrlKey:true,clientX:start.x,clientY:start.y});
  await expect.poll(async()=>{const e=await bounding(editor(page)),b=await box(page);return Math.abs(e.width-b.width)+Math.abs(e.x-b.x)+Math.abs(e.y-b.y);}).toBeLessThanOrEqual(3);
  await expect(page.locator('#text-draft')).toHaveValue('Черновик');await expect(page.locator('#text-draft')).toBeFocused();expect((await board(page,id)).revision).toBe(1);
});
test('window_blur_keeps_the_draft_open',async({page})=>{
  const id=await setup(page);await open(page);const text='Длинное описание '.repeat(20);await page.locator('#text-draft').fill(text);
  await expect.poll(async()=>(await box(page)).height).toBeGreaterThan(150);const grown=(await box(page)).height;
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await expect(editor(page)).toBeVisible();await expect(page.locator('#text-draft')).toHaveValue(text);expect((await box(page)).height).toBeCloseTo(grown,0);expect((await board(page,id)).revision).toBe(1);
});
test('delete_keys_in_the_field_keep_the_block',async({page})=>{
  const id=await setup(page);await open(page);await page.keyboard.press('Delete');await page.keyboard.press('Backspace');await expect(page.locator('#text-draft')).toHaveValue('Car');
  await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements.map((e:{text:string})=>e.text)).toEqual(['Car']);
});
test('composition_keys_do_not_commit_or_split',async({page})=>{
  const id=await setup(page);await open(page);
  await page.locator('#text-draft').dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true});await expect(editor(page)).toBeVisible();
  await page.locator('#title-draft').fill('AB');await page.locator('#title-draft').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true});
  await expect(page.locator('#title-draft')).toHaveValue('AB');await expect(page.locator('#text-draft')).toHaveValue('Card');expect((await board(page,id)).revision).toBe(1);
});
test('agent_text_change_while_typing_offers_replace',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Мой текст');
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Агент'}}]);await expect(page.locator('#status')).toContainText('черновик');
  await page.locator('#text-draft').press('Escape');const bar=page.locator('#text-conflict');await expect(bar).toBeVisible();await expect(bar).toContainText('Текст изменился в другом клиенте');
  await expect(page.locator('#text-draft')).toHaveValue('Мой текст');await expect(page.locator('#operation-dialog')).not.toBeVisible();
  await page.locator('#text-draft').press('Escape');await expect(bar).toBeVisible();
  await page.locator('#text-replace').click();await expect.poll(async()=>(await board(page,id)).elements[0].text).toBe('Мой текст');
  await expect(bar).toBeHidden();await expect(editor(page)).toBeHidden();
});
test('agent_text_change_can_be_kept_by_cancelling',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Мой текст');
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Агент'}}]);await expect(page.locator('#status')).toContainText('черновик');
  await page.locator('#text-draft').press('Escape');await expect(page.locator('#text-conflict')).toBeVisible();
  await page.locator('#text-discard').click();await expect(editor(page)).toBeHidden();await expect(page.locator('#text-conflict')).toBeHidden();
  await expect(page.locator('#scene [data-id="1"]')).toContainText('Агент');await page.waitForTimeout(200);const b=await board(page,id);expect([b.revision,b.elements[0].text]).toEqual([2,'Агент']);
});
test('agent_deleting_the_block_closes_the_editor',async({page})=>{
  const id=await setup(page);await open(page);await page.locator('#text-draft').fill('Пропадёт');await apply(page,id,1,[{op:'delete',ids:[1]}]);
  await expect(editor(page)).toBeHidden();await expect(page.locator('#toast')).toContainText('Объект удалён другим клиентом');
});
test('editor_fields_line_up_with_the_layout',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'update',id:1,patch:{title:'Заголовок',text:'Описание'}}]);await expect(page.locator('#scene [data-id="1"]')).toContainText('Описание');
  const metrics=await (await page.request.get('/api/layout-metrics')).json(),title=projectScene(await board(page,id),metrics).elements[0].title[0];
  await open(page);const field=await bounding(page.locator('#title-draft')),canvas=await bounding(page.locator('#canvas')),cam=await camera(page);
  expect(Math.abs(field.y-(canvas.y+cam.y+(title.y-title.size)*cam.zoom))).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/inline-text.spec.ts`
Expected: FAIL — `#text-editor` не найден (все тесты).

- [ ] **Step 3: Command id in the queue**

In `frontend/src/commands.ts` replace lines 138-139:

```ts
  enqueue(intent:EditIntent,onConfirmed?:(commandId:string)=>void):Promise<Board> {
    const meta:CommandMeta={id:crypto.randomUUID(),actor:this.actor,label:intent.label};
```

with:

```ts
  enqueue(intent:EditIntent,onConfirmed?:(commandId:string)=>void,id:string=crypto.randomUUID()):Promise<Board> {
    const meta:CommandMeta={id,actor:this.actor,label:intent.label};
```

- [ ] **Step 4: Markup and styles**

In `frontend/index.html` replace the whole element from `<section id="text-dialog"` through its closing `</section>` (it sits right before `<div id="comment-pins"`) with:

```html
<div id="text-editor" class="text-editor" hidden><textarea id="title-draft" class="title-field" rows="1" maxlength="256" aria-label="Заголовок карточки"></textarea><textarea id="text-draft" class="body-field" rows="1" maxlength="10000" aria-label="Текст объекта"></textarea></div><div id="text-conflict" class="text-conflict" role="alert" hidden><p>Текст изменился в другом клиенте</p><button type="button" id="text-replace" class="primary">Заменить</button><button type="button" id="text-discard" aria-label="Отменить мою правку текста">Отменить</button></div>
```

In `frontend/src/style.css` replace lines 134-138 (the five `.inline-editor` rules) with:

```css
#canvas { user-select: none; -webkit-user-select: none; }
.text-editor { position: absolute; z-index: 4; inset-block-start: 0; inset-inline-start: 0; transform-origin: 0 0; display: flex; flex-direction: column; justify-content: flex-start; padding: 16px; overflow: hidden; font-family: 'Golos Text', sans-serif; font-kerning: none; font-variant-ligatures: none; color: #302b3b; outline: 2px solid var(--accent); border-radius: 5px; }
.text-editor[data-kind='rectangle'] { justify-content: center; text-align: center; }
.text-editor[data-kind='text'] { padding: 4px; }
.text-editor textarea { display: block; flex: none; inline-size: 100%; min-block-size: 0; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; resize: none; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; color: inherit; text-align: inherit; caret-color: var(--accent); user-select: text; -webkit-user-select: text; }
.text-editor textarea:focus-visible { outline: none; }
.text-editor .title-field { font-size: var(--title-size); font-weight: 600; line-height: 1.25; }
.text-editor .body-field { flex: 0 1 auto; overflow-y: auto; font-size: var(--text-size); font-weight: var(--text-weight); line-height: 1.4; }
.text-editor .title-field:not([hidden]) + .body-field { margin-block-start: 8px; }
.text-conflict { position: absolute; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-inline-size: 360px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 8px 8px 8px 14px; user-select: text; }
.text-conflict p { margin: 0; flex: 1 1 160px; }
```

- [ ] **Step 5: The editor component**

Replace the whole of `frontend/src/text-editor.ts` with:

```ts
import type {Bounds,Element} from './types';
import type {Camera} from './camera';
import {joinTitle,pasteIntoTitle,splitTitle,type Edit,type TextDraft} from './text-model';
export interface TextEditorCallbacks{input(draft:TextDraft):void;commit():void}
const field=(id:string)=>document.getElementById(id) as HTMLTextAreaElement;
// Two textareas over the block; for a card they behave as one field whose first line is the title.
export class InlineTextEditor {
  readonly root=document.getElementById('text-editor')!;
  private title=field('title-draft');private body=field('text-draft');private kind:Element['kind']|null=null;
  constructor(private callbacks:TextEditorCallbacks){
    for(const f of [this.title,this.body])f.addEventListener('input',()=>this.changed());
    this.title.addEventListener('keydown',event=>this.titleKey(event));this.body.addEventListener('keydown',event=>this.bodyKey(event));
    this.title.addEventListener('paste',event=>this.titlePaste(event));
  }
  get open(){return !this.root.hidden;}
  contains(target:EventTarget|null){return target instanceof Node&&this.root.contains(target);}
  show(e:Element,draft:TextDraft,selectAll=false){
    this.kind=e.kind;this.root.dataset.kind=e.kind;this.root.hidden=false;
    this.root.style.setProperty('--text-size',`${e.kind==='frame'?15:e.fontSize}px`);this.root.style.setProperty('--title-size',`${Math.min(96,e.fontSize+4)}px`);this.root.style.setProperty('--text-weight',String(e.fontWeight));
    this.title.hidden=e.kind!=='rectangle';this.title.value=draft.title;this.body.value=draft.text;this.fit();
    const target=e.kind==='rectangle'&&!draft.text?this.title:this.body;target.focus({preventScroll:true});
    if(selectAll)target.select();else target.setSelectionRange(target.value.length,target.value.length);
  }
  focus(){(this.root.contains(document.activeElement)?document.activeElement as HTMLElement:this.body).focus({preventScroll:true});}
  read():TextDraft{return{title:this.title.hidden?'':this.title.value,text:this.body.value};}
  position(box:Bounds,camera:Camera){Object.assign(this.root.style,{width:`${box.width}px`,height:`${box.height}px`,transform:`translate(${camera.x+box.x*camera.zoom}px,${camera.y+box.y*camera.zoom}px) scale(${camera.zoom})`});}
  close(){const focused=this.root.contains(document.activeElement);this.root.hidden=true;this.kind=null;if(focused)document.querySelector<SVGSVGElement>('#canvas')?.focus();}
  private changed(){this.fit();this.callbacks.input(this.read());}
  private fit(){for(const f of [this.title,this.body]){f.style.blockSize='auto';f.style.blockSize=`${f.scrollHeight}px`;}}
  private apply(edit:Edit){this.title.value=edit.draft.title;this.body.value=edit.draft.text;const f=edit.caret.field==='title'?this.title:this.body;f.focus({preventScroll:true});f.setSelectionRange(edit.caret.offset,edit.caret.offset);this.changed();}
  private commitKey(event:KeyboardEvent){
    const commit=event.key==='Escape'||event.key==='Enter'&&(event.ctrlKey||event.metaKey||this.kind==='frame');
    if(!commit)return false;event.preventDefault();event.stopPropagation();this.callbacks.commit();return true;
  }
  private titleKey(event:KeyboardEvent){
    if(event.isComposing||this.commitKey(event))return;
    const t=this.title,atEnd=t.selectionStart===t.value.length&&t.selectionEnd===t.value.length;
    if(event.key==='Enter'){event.preventDefault();this.apply(splitTitle(this.read(),t.selectionStart,t.selectionEnd));}
    else if(event.key==='ArrowDown'&&atEnd){event.preventDefault();this.apply({draft:this.read(),caret:{field:'text',offset:0}});}
  }
  private bodyKey(event:KeyboardEvent){
    if(event.isComposing||this.commitKey(event)||this.title.hidden)return;
    const b=this.body;if(b.selectionStart!==0||b.selectionEnd!==0)return;
    if(event.key==='Backspace'){event.preventDefault();const edit=joinTitle(this.read());if(edit)this.apply(edit);}
    else if(event.key==='ArrowUp'){event.preventDefault();this.apply({draft:this.read(),caret:{field:'title',offset:this.title.value.length}});}
  }
  private titlePaste(event:ClipboardEvent){const text=event.clipboardData?.getData('text/plain');if(!text)return;const t=this.title,edit=pasteIntoTitle(this.read(),t.selectionStart,t.selectionEnd,text);if(!edit)return;event.preventDefault();this.apply(edit);}
}
```

- [ ] **Step 6: Editing mode in the canvas and the scene**

`frontend/src/scene.ts`:
- In `class SceneRenderer` add a public field after the `private ... zoom=1;` line: `editing:number|null=null;`
- In `paintElement` replace

```ts
    const layout=layoutElement({...e,x:0,y:0},metrics),signature=JSON.stringify(layout);
    if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > g,:scope > clipPath').forEach(n=>n.remove());
```

with

```ts
    const editing=this.editing===e.id,layout=layoutElement({...e,x:0,y:0},metrics),signature=editing?'editing':JSON.stringify(layout);
    if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > g,:scope > clipPath').forEach(n=>n.remove());
    // The inline editor draws this text while it is open.
    if(editing)return;
```

`frontend/src/canvas.ts` (CRLF):
- After `metrics:FontMetrics|null=null;` add `editing:number|null=null;private editingHeight:number|null=null;`
- In `project(input)` replace `height:resize?.height??input.height};}` with `height:resize?.height??(input.id===this.editing?this.editingHeight:null)??input.height};}`
- In `clear()` replace `this.board=null;this.selected=[];this.hover=null;` with `this.board=null;this.selected=[];this.hover=null;this.editing=null;this.editingHeight=null;this.renderer.editing=null;`
- After the `setHover(id:number|null){...}` line add:

```ts
  // The edited object hides its SVG text and selection; previewTextHeight survives clearPreview so a window blur keeps the grown block.
  setEditing(id:number|null){if(this.editing===id)return;const ids=[this.editing,id].filter((v):v is number=>v!==null);this.editing=id;this.editingHeight=null;this.renderer.editing=id;this.previewChanged(ids);}
  previewTextHeight(height:number|null){if(this.editing===null||this.editingHeight===height)return;this.editingHeight=height;this.previewChanged([this.editing]);this.frames.invalidate('chrome');}
  textBox(id:number):Bounds|null{const raw=this.board?.elements.find(e=>e.id===id);if(!raw)return null;const e=this.project(raw);return{x:e.x,y:e.y,width:e.width,height:e.height};}
```

- In `paintOverlay` replace `board?.elements.filter(e=>this.selected.includes(e.id))` with `board?.elements.filter(e=>this.selected.includes(e.id)&&e.id!==this.editing)`, and replace `showHover=hover&&!this.selected.includes(hover.id)` with `showHover=hover&&hover.id!==this.editing&&!this.selected.includes(hover.id)`.

- [ ] **Step 7: Wire the editor**

`frontend/src/editor.ts` (CRLF), in order:

1. After `import { InlineTextEditor } from './text-editor';` add `import {draftOf,growHeight,textOperations,type TextDraft} from './text-model';`. In the `import type { Board, BoardEvent, ...EditState } from './types';` line add `Element as BoardElement` to the list. After the `const el = ...;` line add `const DELETED_TEXT='Объект удалён другим клиентом, текст не сохранён.';`
2. Replace

```ts
  private draft: { id: number; revision: number; board: string; base:EditState } | null = null;
  textEditor = new InlineTextEditor();
```

with

```ts
  // height is the block height when editing began: the block grows from it and never below it.
  private draft: { id: number; board: string; base:EditState; height:number } | null = null;
  // A saved text edit stays here until confirmed, so a conflict can reopen it with the user's words.
  private textSave: { commandId:string; id:number; board:string; draft:TextDraft } | null = null;private textConflict=false;
  textEditor = new InlineTextEditor({input:draft=>this.textInput(draft),commit:()=>this.commitText()});
```

3. Replace `this.view.onChrome=()=>{if(this.draft){const e=this.board?.elements.find(e=>e.id===this.draft?.id);if(e)this.textEditor.position(e,this.view);}};` with `this.view.onChrome=()=>this.positionText();`
4. In `syncQueue` replace `if(this.panelState()!==this.panelKey)this.panels();` with `if(this.panelState()!==this.panelKey)this.panels();this.followText();`, and replace `if(!this.comments.isSending&&(!this.draft||uncertain))` with `if(!this.comments.isSending&&(uncertain||!this.draft&&!this.ownTextConflict()))`.
5. In `refresh` replace `if(this.draft){this.status('Доска изменилась · ваш черновик сохранён');el('draft-message').textContent='Другой клиент изменил доску. Ваш текст остался в черновике.';}` with `if(this.draft)this.status('Доска изменилась · ваш черновик сохранён');`
6. Replace the whole `private editText(id: number) {...}` line and the whole `private async saveText(retry:boolean) {...}` method (from its signature through its closing `  }`) with:

```ts
  private editText(id:number,selectAll=false) {
    if(!this.board||!this.queue||this.opening)return;
    if(this.draft){if(this.draft.id===id||this.textConflict){this.textEditor.focus();return;}this.commitText();}
    const e=this.board.elements.find(e=>e.id===id);if(!e)return;
    this.draft={id,board:this.board.id,base:this.queue.projectedState(),height:e.height};this.openText(e,draftOf(e),selectAll);
  }
  private openText(e:BoardElement,draft:TextDraft,selectAll=false) {this.view.setEditing(e.id);this.textEditor.show(e,draft,selectAll);this.positionText();}
  private positionText() {
    if(!this.draft)return;const box=this.view.textBox(this.draft.id);if(!box)return;const camera=this.view.camera;this.textEditor.position(box,camera);
    if(this.textConflict){const bar=el('text-conflict');bar.style.left=`${camera.x+box.x*camera.zoom}px`;bar.style.top=`${camera.y+(box.y+box.height)*camera.zoom+8}px`;}
  }
  private followText() {
    if(!this.draft||!this.board)return;
    if(!this.board.elements.some(e=>e.id===this.draft!.id)){this.closeText();this.report(new Error(DELETED_TEXT));return;}
    this.view.frames.invalidate('chrome');
  }
  private textInput(values:TextDraft) {
    const d=this.draft,e=d&&this.board?.elements.find(e=>e.id===d.id);if(!d||!e||!this.view.metrics)return;
    const height=growHeight({...e,height:d.height},values,this.view.metrics);this.view.previewTextHeight(height===e.height?null:height);
  }
  private commitText() {const d=this.draft;if(!d||this.textConflict)return;const values=this.textEditor.read();this.closeText();this.saveText(d,values);}
  private saveText(d:{id:number;board:string;base:EditState},values:TextDraft) {
    const e=d.base.board.elements.find(e=>e.id===d.id);if(!e||!this.queue||!this.view.metrics||this.board?.id!==d.board)return;
    const operations=textOperations(e,values,growHeight(e,values,this.view.metrics));if(!operations.length)return;
    const save={commandId:crypto.randomUUID(),id:d.id,board:d.board,draft:values};this.textSave=save;
    this.queue.enqueue({label:'Изменение текста',operations,guards:makeGuards(d.base,operations)},()=>{if(this.textSave===save)this.textSave=null;},save.commandId)
      .catch(()=>{if(this.textSave!==save)return;if(this.ownTextConflict())this.showTextConflict();else this.textSave=null;});
  }
  private closeText() {this.draft=null;this.textConflict=false;el('text-conflict').hidden=true;this.textEditor.close();this.view.setEditing(null);}
  private ownTextConflict() {return !!this.textSave&&this.queue?.mode==='conflict'&&this.queue.inFlightId===this.textSave.commandId;}
  // The queue stops on the conflicted command; only the bar's buttons resolve it.
  private showTextConflict() {
    const save=this.textSave!,e=this.board?.elements.find(e=>e.id===save.id);
    if(!e||this.board?.id!==save.board){this.textSave=null;this.discard();this.report(new Error(DELETED_TEXT));return;}
    let values=save.draft;if(this.draft?.id===save.id){values=this.textEditor.read();this.closeText();}else if(this.draft)this.commitText();
    this.draft={id:e.id,board:save.board,base:this.queue!.projectedState(),height:e.height};this.textConflict=true;el('text-conflict').hidden=false;this.openText(e,values);
  }
  private async replaceText() {
    const save=this.textSave;if(!save||!this.queue||this.busy)return;this.busy=true;
    try{
      if(this.ownTextConflict())this.discard();this.queue.accept(await api.editState(save.board,this.actor.id));
      const values=this.textEditor.read(),e=this.board?.elements.find(e=>e.id===save.id);this.textSave=null;this.closeText();
      if(!e){this.report(new Error(DELETED_TEXT));return;}
      this.saveText({id:e.id,board:save.board,base:this.queue.projectedState()},values);
    }catch(error){this.report(error);}finally{this.busy=false;if(this.queued)void this.refresh();}
  }
  private cancelText() {if(!this.textSave)return;if(this.ownTextConflict())this.discard();this.textSave=null;this.closeText();}
```

7. In `bind()`:
   - Replace `document.addEventListener('pointerdown',()=>this.interaction.finishNudge(),true);` with `document.addEventListener('pointerdown',event=>{this.interaction.finishNudge();if(this.draft&&!this.textEditor.contains(event.target)&&!el('text-conflict').contains(event.target as Node))this.commitText();},true);`
   - Directly after it add the line: `this.textEditor.root.addEventListener('focusout',event=>{const next=event.relatedTarget;if(next instanceof Node&&!this.textEditor.contains(next)&&!el('text-conflict').contains(next))this.commitText();});el('text-replace').onclick=()=>{void this.replaceText();};el('text-discard').onclick=()=>this.cancelText();`
   - Delete the whole line that starts with `el('text-form').onsubmit` and the whole line that starts with `el('draft-cancel').onclick`.
8. In `key()` replace `if(this.draft){this.draft=null;this.textEditor.close();return;}` with `if(this.draft){this.commitText();return;}`

- [ ] **Step 8: Rewrite the tests of the old form**

Keep each test's checked behavior; change only how the text is opened and saved.

- `e2e/editor-ux.spec.ts:24` — replace the whole `space_pan_preserves_draft` test line with (Space types into the field now, so the draft survives a wheel pan instead):

```ts
test('wheel_pan_preserves_draft',async({page})=>{const id=await setup(page);await select(page);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Черновик');const initial=await page.locator('#world').getAttribute('transform');await page.locator('#canvas').evaluate(e=>e.dispatchEvent(new WheelEvent('wheel',{deltaX:40,deltaY:40,bubbles:true,cancelable:true})));await expect.poll(()=>page.locator('#world').getAttribute('transform')).not.toBe(initial);await expect(page.locator('#text-draft')).toHaveValue('Черновик');await expect(page.locator('#text-editor')).toBeVisible();expect((await board(page,id)).revision).toBe(1);});
```

- `e2e/navigation-links.spec.ts:24` — replace both `page.locator('#text-form')` with `page.locator('#text-editor')`, and replace `await page.locator('#draft-cancel').click();` with `await page.locator('#text-draft').fill('Card');await page.locator('#text-draft').press('Escape');` (restoring the text closes without a command, so the final `revision` stays 1).
- `e2e/review-regressions.spec.ts` — in `confirmed_lost_text_ack_closes_the_submitted_draft` replace `await page.locator('#draft-save').click();` with `await page.locator('#text-draft').press('Escape');` and `#text-dialog` with `#text-editor`. Replace the two tests `older_text_ack_does_not_close_a_new_draft` and `typing_after_save_keeps_the_newer_text_draft` with:

```ts
test('older_text_ack_does_not_close_a_new_draft',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Submitted A');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/api/boards/${id}/apply**`,async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
  await page.locator('#text-draft').press('Escape');await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Unsaved B');release();await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await expect(page.locator('#text-draft')).toBeVisible();await expect(page.locator('#text-draft')).toHaveValue('Unsaved B');expect((await board(page,id)).elements[0].text).toBe('Submitted A');
});
test('saved_text_shows_before_the_ack',async({page})=>{
  const id=await setup(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await page.locator('#text-draft').fill('Submitted');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/api/boards/${id}/apply**`,async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
  await page.locator('#text-draft').press('Escape');await expect(page.locator('#text-editor')).toBeHidden();await expect(page.locator('#scene [data-id="1"]')).toContainText('Submitted');
  release();await expect(page.locator('#status')).toHaveText('Все изменения сохранены');expect((await board(page,id)).elements[0].text).toBe('Submitted');
});
```

- `e2e/ux-actions.spec.ts:50` — replace `await page.locator('#draft-cancel').click();` with `await page.locator('#text-draft').fill('Card');await page.locator('#text-draft').press('Escape');`
- `e2e/editor.spec.ts:35` — replace `await page.getByRole('button', { name: 'Сохранить текст', exact: true }).click();` with `await page.getByLabel('Текст объекта').press('Escape');`
- `e2e/editor.spec.ts:62-64` — replace the three lines (save click, `Повторить на свежей версии` visible, its click) with:

```ts
  await page.getByLabel('Текст объекта').press('Escape');
  await expect(page.locator('#text-conflict')).toBeVisible();
  await page.getByRole('button', { name: 'Заменить', exact: true }).click();
```

- `e2e/comments.spec.ts:7` — replace `await page.getByRole('button',{name:'Сохранить текст',exact:true}).click();` with `await page.getByLabel('Текст объекта').press('Escape');`
- `e2e/comments.spec.ts:18` — inline editing now grows the block, so the overflow for «Подогнать высоту» comes from an agent edit. Replace `await page.locator('#scene [data-id="1"]').dblclick();await page.getByLabel('Текст объекта').fill('Длинное описание '.repeat(40));await page.getByRole('button',{name:'Сохранить текст',exact:true}).click();` with ``const created=await board(page,id);await page.request.post(`/api/boards/${id}/apply`,{headers:{Origin:'http://127.0.0.1:19843'},data:{revision:created.revision,operations:[{op:'update',id:1,patch:{text:'Длинное описание '.repeat(40)}}]}});await page.locator('#scene [data-id="1"]').click();``

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium --project=unit`
Expected: PASS, включая все 15 тестов `e2e/inline-text.spec.ts` и переписанные тесты. `grep -rn "text-dialog\|draft-save\|draft-cancel\|draft-retry\|draft-message\|text-form" frontend e2e` — пусто.

- [ ] **Step 10: Commit**

```bash
git add frontend e2e
git commit -m "feat: edit text inside the block instead of a form"
```

### Task 3: Подпись фрейма и подпись стрелки

**Files:**
- Modify: `frontend/src/canvas.ts` (`textBox`), `frontend/src/scene.ts` (`paintFrame`, `paintConnector`), `frontend/src/style.css`
- Test: `e2e/inline-text.spec.ts`

**Interfaces:**
- Consumes: `CanvasView.textBox`, `CanvasView.editing`, `SceneRenderer.editing` из Task 2; `layoutConnector(board,e,metrics,points):ConnectorLayout` (`captionBounds`); приватный `CanvasView.linkPoints(e)`.
- Produces: `textBox` для `frame` — `{x:e.x,y:e.y-30,width:max(160,e.width),height:24}`; для `connector` — рамка шириной не меньше 276 по центру `captionBounds`.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/inline-text.spec.ts`:

```ts
test('frame_label_is_edited_above_the_frame',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'frame',x:420,y:220,width:400,height:220,text:'Frame'}}]);await expect(page.locator('#scene [data-id="2"]')).toBeVisible();
  await page.locator('#scene [data-id="2"] [data-frame-header-hit]').dblclick();await expect(editor(page)).toHaveAttribute('data-kind','frame');
  const frame=await bounding(page.locator('#scene [data-id="2"] > rect:not([data-frame-header-hit])')),label=await bounding(editor(page));
  expect(label.y+label.height).toBeLessThanOrEqual(frame.y+1);expect(Math.abs(label.x-frame.x)).toBeLessThanOrEqual(1.5);
  await expect(page.locator('#scene [data-id="2"] > text')).toHaveText('');await expect(page.locator('#title-draft')).toBeHidden();
  await page.locator('#text-draft').fill('Слайд 1');await page.locator('#text-draft').press('Enter');
  await expect(editor(page)).toBeHidden();await expect.poll(async()=>(await board(page,id)).elements[1].text).toBe('Слайд 1');await expect(page.locator('#scene [data-id="2"] > text')).toHaveText('Слайд 1');
});
test('connector_caption_is_edited_in_place',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:520,y:100,text:'Second'}},{op:'create',element:{kind:'connector',from:1,to:2,text:'связь'}}]);
  const label=page.locator('#scene [data-id="3"] [data-connector-label]');await expect(label).toBeVisible();const caption=await bounding(label);
  await label.dblclick();await expect(editor(page)).toHaveAttribute('data-kind','connector');await expect(label).toHaveCount(0);
  const box=await bounding(editor(page));expect(Math.abs(box.x+box.width/2-(caption.x+caption.width/2))).toBeLessThanOrEqual(2);
  await page.locator('#text-draft').fill('новая подпись');await page.locator('#text-draft').press('Escape');
  await expect.poll(async()=>(await board(page,id)).elements[2].text).toBe('новая подпись');await expect(page.locator('#scene [data-id="3"] [data-connector-label]')).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/inline-text.spec.ts -g "frame_label|connector_caption"`
Expected: FAIL — рамка редактора покрывает весь фрейм (нарушено `label.y+label.height<=frame.y+1`), подпись стрелки не скрыта.

- [ ] **Step 3: Implement**

`frontend/src/canvas.ts` (CRLF) — add `import {layoutConnector} from './preview';` after `import {changedIds} from './diff';`, and replace the `textBox` line with:

```ts
  textBox(id:number):Bounds|null{
    const raw=this.board?.elements.find(e=>e.id===id);if(!raw||!this.board)return null;const e=this.project(raw);
    if(e.kind==='frame')return{x:e.x,y:e.y-30,width:Math.max(160,e.width),height:24};
    if(e.kind!=='connector')return{x:e.x,y:e.y,width:e.width,height:e.height};
    if(!this.metrics)return null;
    const board={...this.board,elements:this.board.elements.map(n=>this.project(n))},b=layoutConnector(board,e,this.metrics,this.linkPoints(e)).captionBounds,width=Math.max(276,b.width);
    return{x:b.x+b.width/2-width/2,y:b.y,width,height:Math.max(b.height,e.fontSize*1.4+12)};
  }
```

`frontend/src/scene.ts`:
- In `paintFrame` replace `if(title.textContent!==e.text)title.textContent=e.text;` with `const text=this.editing===e.id?'':e.text;if(title.textContent!==text)title.textContent=text;`
- In `paintConnector` replace `const signature=JSON.stringify([layout.captionBounds,layout.caption]);` with `const editing=this.editing===e.id,signature=JSON.stringify([editing,layout.captionBounds,layout.caption]);` and `if(e.text)group.append(` with `if(e.text&&!editing)group.append(`.

`frontend/src/style.css` (CRLF) — after the `.text-editor[data-kind='text'] { padding: 4px; }` line add:

```css
.text-editor[data-kind='frame'] { padding: 2px 0; color: #66786c; outline-offset: 2px; }
.text-editor[data-kind='frame'] .body-field { white-space: pre; overflow: hidden; line-height: 20px; }
.text-editor[data-kind='connector'] { padding: 6px 8px; justify-content: center; text-align: center; background: #ffffff; border-radius: 3px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/inline-text.spec.ts e2e/smoothness.spec.ts e2e/ux-actions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend e2e/inline-text.spec.ts
git commit -m "feat: edit frame labels and connector captions inline"
```

### Task 4: Создание открывает ввод и вход на малом зуме

**Files:**
- Modify: `frontend/src/interaction.ts` (`up()`, create branch), `frontend/src/editor.ts` (`create` callback, `openText`)
- Test: `e2e/inline-text.spec.ts`; modify `e2e/comments.spec.ts:7,18`, `e2e/library.spec.ts:80`, and every other test the full run shows failing because a tool-created block now opens the editor

**Interfaces:**
- Consumes: `Editor.editText(id,selectAll)`, `Editor.openText`, `MIN_EDIT_ZOOM`, `CanvasView.animateZoom(factor,clientX,clientY)`, `CanvasView.textBox`.
- Produces: блок, созданный инструментом, имеет `title:''` и `text:''` (фрейм — `text:'Новый фрейм'`), и редактор открывается сразу после создания; при зуме <0.5 вход в правку плавно приближает к 0.5.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/inline-text.spec.ts`:

```ts
test('block_tool_click_creates_an_empty_card_ready_for_typing',async({page})=>{
  const id=await setup(page);await page.getByRole('button',{name:'Блок (R)',exact:true}).click();await page.locator('#canvas').click({position:{x:700,y:420}});
  await expect(editor(page)).toBeVisible();await expect(page.locator('#title-draft')).toBeFocused();
  await expect.poll(async()=>(await board(page,id)).elements.length).toBe(2);const created=(await board(page,id)).elements[1];expect([created.title,created.text]).toEqual(['','']);
  await page.keyboard.type('Оплата');await page.keyboard.press('Enter');await page.keyboard.type('проверка карты');await page.keyboard.press('Escape');
  await expect.poll(async()=>{const e=(await board(page,id)).elements[1];return [e.title,e.text];}).toEqual(['Оплата','проверка карты']);
});
test('text_tool_click_opens_an_empty_text_block',async({page})=>{
  const id=await setup(page);await page.getByRole('button',{name:'Текст (T)',exact:true}).click();await page.locator('#canvas').click({position:{x:700,y:420}});
  await expect(page.locator('#text-draft')).toBeFocused();await expect(page.locator('#title-draft')).toBeHidden();
  await page.keyboard.type('Мысль');await page.keyboard.press('Escape');await expect.poll(async()=>(await board(page,id)).elements[1]?.text).toBe('Мысль');
});
test('new_frame_label_is_selected_for_replacement',async({page})=>{
  const id=await setup(page);await page.getByRole('button',{name:'Слайд (F)',exact:true}).click();await page.locator('#canvas').click({position:{x:700,y:420}});
  await expect(editor(page)).toHaveAttribute('data-kind','frame');const selection=await page.locator('#text-draft').evaluate(t=>[(t as HTMLTextAreaElement).selectionStart,(t as HTMLTextAreaElement).selectionEnd,(t as HTMLTextAreaElement).value]);
  expect(selection).toEqual([0,11,'Новый фрейм']);await page.keyboard.type('Слайд');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await board(page,id)).elements.find((e:{kind:string})=>e.kind==='frame')?.text).toBe('Слайд');
});
test('editing_at_low_zoom_zooms_in_to_half',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await setup(page);for(let i=0;i<7;i++)await page.locator('#zoom-out').click();
  expect((await camera(page)).zoom).toBeLessThan(.3);await open(page);await expect.poll(async()=>(await camera(page)).zoom).toBeCloseTo(.5,5);
  const e=await bounding(editor(page)),b=await box(page);expect(Math.abs(e.x-b.x)+Math.abs(e.y-b.y)).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/inline-text.spec.ts -g "tool_click|new_frame|low_zoom"`
Expected: FAIL — после клика инструментом редактор не открыт, зум остаётся ~0.28.

- [ ] **Step 3: Implement**

`frontend/src/interaction.ts` (CRLF), in `up()` replace `text:kind==='frame'?'Новый фрейм':kind==='text'?'Ваша мысль':'Добавьте описание',title:kind==='rectangle'?'Новая карточка':''` with `text:kind==='frame'?'Новый фрейм':'',title:''`.

`frontend/src/editor.ts` (CRLF):
- In the `interaction = new Interaction(...)` line replace `create:(element,base)=>this.createObjects([{op:'create',element}],[base.board.nextId],base,'Создание объекта'),` with `create:(element,base)=>{this.createObjects([{op:'create',element}],[base.board.nextId],base,'Создание объекта');this.editText(base.board.nextId,element.kind==='frame');},`
- Change the import from Task 2 to `import {MIN_EDIT_ZOOM,draftOf,growHeight,textOperations,type TextDraft} from './text-model';`
- Replace the `private openText(...)` line with:

```ts
  private openText(e:BoardElement,draft:TextDraft,selectAll=false) {
    this.view.setEditing(e.id);this.textEditor.show(e,draft,selectAll);this.positionText();
    // Text scaled below half size is unreadable; zoom around the block so it stays under the cursor.
    const zoom=this.view.camera.zoom,box=this.view.textBox(e.id);
    if(zoom<MIN_EDIT_ZOOM&&box){const rect=this.view.svg.getBoundingClientRect();this.view.animateZoom(MIN_EDIT_ZOOM/zoom,rect.x+this.view.camera.x+(box.x+box.width/2)*zoom,rect.y+this.view.camera.y+(box.y+box.height/2)*zoom);}
  }
```

- [ ] **Step 4: Update tests that create blocks with a tool**

A tool click now leaves the new block under an open editor, so a later click on that block lands in the editor.
- `e2e/comments.spec.ts:7` — delete `await page.locator('#scene [data-id="1"]').dblclick();` (the editor is already open; the following `fill` calls and `press('Escape')` stay).
- `e2e/comments.spec.ts:18` — insert `await page.keyboard.press('Escape');` right before `const created=await board(page,id);` (closes the empty editor without a command).
- `e2e/library.spec.ts:80` — delete the line `await page.locator('#scene [data-id="1"]').dblclick();`.
- Run `npm run build && npx playwright test --project=chromium`. For each remaining failure where a test creates a block with a tool (`Блок (R)`, `Текст (T)`, `Слайд (F)`, `[data-tool="rectangle|text|frame"]` in `e2e/editor.spec.ts`, `e2e/comments.spec.ts:57`, `e2e/ux-actions.spec.ts:162-180`) and then clicks or drags that block, insert `await page.keyboard.press('Escape');` right after the creating click. If a failing test asserted the removed placeholder texts, assert `''` instead. Do not change what any test checks beyond that; if a failure has another cause, report it instead of adjusting the test.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium --project=unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend e2e
git commit -m "feat: open the inline editor on new blocks and at low zoom"
```

### Task 5: Бюджет ввода, полная проверка и документы

**Files:**
- Modify: `e2e/perf.spec.ts`, `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md` (раздел «Дорожная карта»), `docs/superpowers/plans/2026-10-19-inline-text-editing.md` (раздел «Результаты»)

**Interfaces:**
- Consumes: `bigBoard`, `frames`, `p90`, `FRAME_BUDGET_MS` из `e2e/perf.spec.ts`; `globalThis.wireboardFrameStats`.
- Produces: тест бюджета ввода; записанные замеры.

- [ ] **Step 1: Write the budget test**

In `e2e/perf.spec.ts`, inside `test.describe('smoothness budget on 300 elements',...)` after the last test add:

```ts
  test('typing_in_the_inline_editor_fits_one_frame',async({page})=>{
    await bigBoard(page);const b=await box(page);await page.mouse.click(b.x+35,b.y+35);await page.keyboard.press('Enter');await expect(page.locator('#text-editor')).toBeVisible();
    await page.evaluate(()=>{const w=window as unknown as {inputs:number[];inputStart:number};w.inputs=[];addEventListener('input',()=>{w.inputStart=performance.now();},{capture:true});addEventListener('input',()=>{w.inputs.push(performance.now()-w.inputStart);});});
    const typing=await frames(page,async()=>{await page.keyboard.type('Длинное описание для проверки роста блока при наборе ',{delay:20});});
    const handlers=await page.evaluate(()=>(window as unknown as {inputs:number[]}).inputs);
    expect(handlers.length).toBeGreaterThan(20);expect(typing.length).toBeGreaterThan(5);expect(p90(handlers)+p90(typing)).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
```

- [ ] **Step 2: Run it**

Run: `npm run build && npx playwright test --project=chromium e2e/perf.spec.ts -g typing`
Expected: PASS. Если тест красный — это нарушение бюджета спека: найти горячую точку (`page.evaluate` с `performance.now()` вокруг `textInput` и кадра) и исправить код, не трогая бюджет; записать причину в отчёт.

- [ ] **Step 3: Full verification on the final tree**

Run, in order: `cargo test`, `npm run typecheck`, `npm run build`, `npx playwright test` (unit, chromium, firefox, webkit).
Expected: всё зелёное. Красный тест показать с выводом; нестабильный — прогнать отдельно 5 раз и записать результат.

- [ ] **Step 4: Record the results and the roadmap**

- In `docs/superpowers/plans/2026-10-19-inline-text-editing.md` append a section `## Результаты` with: p90 обработчика `input`, p90 кадра при наборе, число тестов и итог по каждому проекту Playwright, `cargo test`.
- In `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`, section «Дорожная карта», after item 2 add the line `Этап 2 разделён на 2a (inline-редактирование текста и рост блока, спек 2026-10-19-inline-text-editing-design.md) и 2b (точки, «+» и создание связей); редактирование в блоке и рост высоты перенесены из этапа 3 в 2a.`

- [ ] **Step 5: Commit**

```bash
git add e2e/perf.spec.ts docs/superpowers
git commit -m "test: budget inline typing and record stage 2a results"
```

## Результаты

Замеры на доске из 300 элементов, Chromium, тест `typing_in_the_inline_editor_fits_one_frame` (318 нажатий, 15 кадров при росте блока): p90 обработчика `input` 0.6–0.7 мс, p90 кадра при наборе 2.4–3.9 мс, сумма не выше 4.6 мс при бюджете 16 мс (три прогона подряд).

До правки сумма была 18.6–22.7 мс: `fit()` редактора на каждое нажатие переверстывал весь документ (~10 мс), потому что изменение высоты textarea доходило до процентного SVG и заставляло пересчитать все 3556 объектов сцены. `contain: layout` на `.text-editor` останавливает перекладку на редакторе (коммит `perf: isolate the inline editor layout from the scene`), обработчик стал ~0.5 мс.

Тест набирает фразу шесть раз подряд: одной фразы не хватает, чтобы блок вырос, и кадров с `wireboardFrameStats` не набирается вовсе.

`drop_handler_and_next_frame_fit_one_frame` (обработчик pointerup + кадр, бюджет 16 мс), `--repeat-each=5` по одному: ветка 8.8, 9.9, 12.0, 12.3, 12.5 мс (5 из 5); база 9a4484d 8.8, 8.8, 11.5, 13.2, 13.9 мс (5 из 5). Регрессии нет, редкие промахи при полном прогоне — чувствительность к нагрузке.

Итоги `npx playwright test` на финальном дереве (484 теста, два полных прогона дали один результат):

- unit: 28 из 28 зелёные.
- chromium: 152 из 152 зелёные.
- firefox: 145 зелёные, 4 пропущены (бюджеты откалиброваны под Chromium), 3 красные: `double_click_edits_inside_the_block`, `typing_grows_the_block_and_one_undo_reverts_text_and_height`, `editor_follows_wheel_pan_and_zoom` из `e2e/inline-text.spec.ts`. Падают 5 из 5 при отдельном прогоне и без правки `contain: layout`. Вероятная причина в тесте (замер: блок 222x114, редактор 220x112): Firefox, по-видимому, включает обводку SVG-фигуры (2 px) в `getBoundingClientRect`, поэтому `box()` блока на 2 px больше редактора, а допуск 1.5 (и 3 в зуме) это не покрывает.
- webkit: 147 зелёные, 5 пропущены (бюджеты под Chromium).
- `cargo test`: 98 тестов, все зелёные.
- `npm run typecheck` без ошибок.
