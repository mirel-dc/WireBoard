import {test,expect} from '@playwright/test';
import {layoutElement,projectScene} from '../../frontend/src/preview';
import {board,element,metrics} from './fixtures';
const rows=(layout:ReturnType<typeof layoutElement>)=>[...layout.title,...layout.body];
test('element layout only translates with the element',()=>{
  for(const kind of ['rectangle','text'] as const){
    const e=element({id:1,kind,x:137.5,y:-42,title:kind==='rectangle'?'Заголовок карточки':'',text:'Длинное описание '.repeat(6)});
    const absolute=layoutElement(e,metrics),local=layoutElement({...e,x:0,y:0},metrics);
    expect(local.fitHeight).toBe(absolute.fitHeight);expect(local.overflow).toBe(absolute.overflow);expect(rows(local).length).toBeGreaterThan(1);
    rows(local).forEach((row,i)=>{const other=rows(absolute)[i];expect(row.text).toBe(other.text);expect(row.x+e.x).toBeCloseTo(other.x,9);expect(row.y+e.y).toBeCloseTo(other.y,9);});
  }
});
test('projectScene is built from layoutElement',()=>{
  const e=element({id:1,x:10,y:20,title:'Карточка',text:'Текст'});expect(projectScene(board([e]),metrics).elements[0]).toEqual(layoutElement(e,metrics));
});
