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
test('a snapped move lands exactly on the target coordinate',()=>{
  // 350 + (-91.10282939385681 + (254 - 258.89717060614316)) is 254.00000000000003 in doubles.
  const box=b(350,100),dx=-91.10282939385681,s=snapMove({...box,x:box.x+dx},[b(254,400,300)],6);
  expect(box.x+(dx+s.dx)).not.toBe(254);
  expect(s.x).toBe(254);
  expect(box.x+(s.x!-box.x)).toBe(254);
});
test('a snapped resize puts the dragged edge exactly on the target coordinate',()=>{
  // 121 + (391.4031227762426 + (508 - 512.4031227762426)) is 508.00000000000006 in doubles.
  const s=snapResize(b(121,100,391.4031227762426),'e',[b(208,400,300)],6);
  expect(s.bounds.x+s.bounds.width).toBe(508);
});
