import type { Board, BoardSummary, Element, Operation } from './types';
import { orderedFrames,members } from './canvas';
import { icon } from './icons';
const names: Record<Element['kind'], string> = { rectangle: 'Блок', text: 'Текст', connector: 'Связь', frame: 'Фрейм', image: 'Изображение' };
function node<K extends keyof HTMLElementTagNameMap>(kind: K, text?: string, className?: string) { const el = document.createElement(kind); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
export function showBoards(boards: BoardSummary[], active: string | undefined, open: (id: string) => void) {
  const list = document.querySelector('#boards')!; list.replaceChildren();
  for (const board of boards) {
    const button = node('button', undefined, `board-row${board.id === active ? ' active' : ''}`);
    button.title=board.title; if(board.id===active)button.setAttribute('aria-current','page');
    const details=node('span',undefined,'board-details');
    details.append(node('span',board.title,'board-name'),node('span',`${board.elementCount} объектов`,'board-meta'));
    button.append(icon('boards'),details);button.onclick=()=>open(board.id);list.append(button);
  }
  if(!boards.length)list.append(node('p','Доски не найдены','empty-slides'));
}
export function showSlides(board: Board, selected: number[], fit: (id: number) => void) {
  const list = document.querySelector('#slides')!; list.replaceChildren(); const frames = orderedFrames(board); document.querySelector('#slide-count')!.textContent = String(frames.length);
  frames.forEach((frame, index) => { const button = node('button', undefined, `slide-row${selected.includes(frame.id) ? ' active' : ''}`); const thumbnail=node('img'); thumbnail.alt='';thumbnail.loading='lazy';thumbnail.src=`/api/boards/${board.id}/render?format=svg&frame=${frame.id}#revision=${board.revision}`; button.append(thumbnail,node('span', String(index + 1).padStart(2, '0'), 'slide-number'), node('span', frame.text || `Слайд ${index + 1}`)); button.onclick = () => fit(frame.id); list.append(button); });
  if (!frames.length) list.append(node('p', 'Создайте первый слайд инструментом F. Он станет рамкой для вашей истории.', 'empty-slides'));
}
export function showProperties(board: Board, selected: number[], apply: (ops: Operation[], revision?: number) => Promise<boolean>, edit: (id: number) => void, force = false, capture?:()=>(ops:Operation[],revision?:number)=>Promise<boolean>) {
  if (!force && document.activeElement?.closest('#properties') && document.activeElement.matches('input,select')) return;
  const content = document.querySelector('#property-content')!; content.replaceChildren(); document.querySelector('#selection-count')!.textContent = selected.length ? String(selected.length) : '—';
  const elements = board.elements.filter(e => selected.includes(e.id));
  if (!elements.length) { const p = node('div', undefined, 'property-empty'); p.append(node('span', '⌁', 'detail-symbol'), node('p', 'Выберите объект, чтобы настроить его форму, цвет и слова.'), node('p', 'Зажмите Shift для нескольких объектов. Пробел — перемещение холста.')); content.append(p); return; }
  const revision = board.revision;
  const actions = node('div', undefined, 'property-actions');
  const action = (title: string, callback: () => void) => { const button = node('button', title); button.onclick = callback; actions.append(button); };
  if (elements.length === 1) {
    const e = elements[0]; content.append(node('div', names[e.kind], 'kind-label'));
    const text = node('p', [e.title,e.text].filter(Boolean).join('\n') || 'Без текста', 'property-text'); content.append(text); action('Изменить текст', () => edit(e.id));
    const labelInput = (title: string, value: string, type: string, change: (value: string,send:typeof apply) => void) => { const label = node('label', title); const input = node('input'); input.type = type; input.value = value; let send=apply;input.onfocus=()=>{send=capture?.()??apply;};input.onchange=()=>{change(input.value,send);send=capture?.()??apply;}; label.append(input); return label; };
    const colors = node('div', undefined, 'property-grid');
    colors.append(labelInput('Заливка', e.fill === 'none' ? '#ffffff' : e.fill, 'color', (fill,send) => { void send([{ op: 'update', id: e.id, patch: { fill } }], revision); }), labelInput('Линия', e.stroke === 'none' ? '#446b57' : e.stroke, 'color', (stroke,send) => { void send([{ op: 'update', id: e.id, patch: { stroke } }], revision); })); content.append(colors);
    const sizes = node('div', undefined, 'property-grid');
    sizes.append(labelInput('Ширина', String(e.width), 'number', (value,send) => {void send([{op:'update',id:e.id,patch:{width:Number(value)}}],revision);}),labelInput('Высота',String(e.height),'number',(value,send)=>{void send([{op:'update',id:e.id,patch:{height:Number(value)}}],revision);}));if(e.kind!=='connector')content.append(sizes);
    if(e.kind==='frame'){
      action('Слайд 16:9',()=>{void apply([{op:'resize',id:e.id,width:960,height:540}],revision);});
      action('Подогнать под содержимое',()=>{const ids=members(board,[e.id]).filter(id=>id!==e.id),children=board.elements.filter(n=>ids.includes(n.id)&&n.kind!=='connector');if(!children.length)return;const x=Math.min(...children.map(n=>n.x))-24,y=Math.min(...children.map(n=>n.y))-24,width=Math.max(...children.map(n=>n.x+n.width))-x+24,height=Math.max(...children.map(n=>n.y+n.height))-y+24;void apply([{op:'update',id:e.id,patch:{x,y}},{op:'resize',id:e.id,width,height}],revision);});
      action('Удалить фрейм с содержимым',()=>{void apply([{op:'delete',ids:members(board,[e.id])}],revision);});
    }
    content.append(labelInput('Размер текста', String(e.fontSize), 'number', (value,send) => { void send([{ op: 'update', id: e.id, patch: { fontSize: Number(value) } }], revision); }));
    const weightLabel=node('label','Начертание'),weight=node('select');for(const [value,title]of [['400','Обычный'],['600','Полужирный']]){const option=node('option',title);option.value=value;weight.append(option);}weight.value=String(e.fontWeight);let weightSend=apply;weight.onfocus=()=>{weightSend=capture?.()??apply;};weight.onchange=()=>{void weightSend([{op:'update',id:e.id,patch:{fontWeight:Number(weight.value) as 400|600}}],revision);weightSend=capture?.()??apply;};weightLabel.append(weight);content.append(weightLabel);
    if(e.kind==='text')for(const [name,size,fontWeight]of [['Заголовок',32,600],['Основной текст',16,400],['Подпись',12,400]] as const)action(name,()=>{void apply([{op:'update',id:e.id,patch:{fontSize:size,fontWeight}}],revision);});
    if (e.kind === 'connector') for (const [field, title] of [['fromPort', 'Начало связи'], ['toPort', 'Конец связи']] as const) { const label = node('label', title), select = node('select'); for (const [value, text] of [['auto','Автоматически'],['left','Слева'],['right','Справа'],['top','Сверху'],['bottom','Снизу']]) { const option = node('option', text); option.value = value; select.append(option); } select.value = e[field]; let portSend=apply;select.onfocus=()=>{portSend=capture?.()??apply;};select.onchange = () => { void portSend([{ op: 'update', id: e.id, patch: { [field]: select.value } }], revision);portSend=capture?.()??apply; }; label.append(select); content.append(label); }
  } else {
    content.append(node('div', `${elements.length} объектов`, 'kind-label'));
    const minX = Math.min(...elements.map(e => e.x)), minY = Math.min(...elements.map(e => e.y));
    action('Выровнять по левому краю', () => { void apply(elements.filter(e => e.kind !== 'connector').map(e => ({ op: 'update', id: e.id, patch: { x: minX } })), revision); });
    action('Выровнять по верхнему краю', () => { void apply(elements.filter(e => e.kind !== 'connector').map(e => ({ op: 'update', id: e.id, patch: { y: minY } })), revision); });
  }
  action('Дублировать', () => { void apply([{ op: 'duplicate', ids: selected, dx: 40, dy: 40 }], revision); });
  action('Удалить выбранное', () => { void apply([{ op: 'delete', ids: selected }], revision); }); content.append(actions);
}
