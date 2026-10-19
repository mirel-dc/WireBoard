import type {Board,Element,FontMetrics} from '../../frontend/src/types';
export function element(patch:Partial<Element>&{id:number}):Element{return {kind:'rectangle',x:0,y:0,width:220,height:112,text:'',title:'',fontWeight:400,fill:'#eee5f8',stroke:'#ae91c5',fontSize:16,from:null,to:null,fromPort:'auto',toPort:'auto',image:null,parentFrameId:null,...patch};}
export function board(elements:Element[],id='board'):Board{return {version:3,id,title:'Test',revision:1,nextId:elements.length+1,elements,comments:[],nextCommentId:1,nextMessageId:1};}
export const metrics:FontMetrics={regular:{},semibold:{},fallback:.55};
