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
