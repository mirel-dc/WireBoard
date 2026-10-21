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
