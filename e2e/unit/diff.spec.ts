import {test,expect} from '@playwright/test';
import {changedIds} from '../../frontend/src/diff';
import {board,element} from './fixtures';
test('reports moved, added and removed elements',()=>{
  const before=board([element({id:1}),element({id:2}),element({id:3})]),after=board([element({id:1}),element({id:2,x:50}),element({id:4})]);
  expect([...(changedIds(before,after) as Set<number>)].sort()).toEqual([2,3,4]);
});
test('requests a full repaint for a first or different board',()=>{expect(changedIds(null,board([]))).toBe('all');expect(changedIds(board([],'a'),board([],'b'))).toBe('all');});
test('a cloned projection changes nothing',()=>{const before=board([element({id:1,image:'data:image/png;base64,AAAA'})]);expect((changedIds(before,structuredClone(before)) as Set<number>).size).toBe(0);});
