// Node 几何复现：近似字体宽度，无像素栅格化，不启动浏览器。
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
export async function loadPlayerClass(file: URL, name: string) {
  const base = new URL('../../player/scene2d.ts',import.meta.url);
  const source = stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'}).replace(/from (['"])([^'"]+)\1/g,(_m,_q,p)=>`from '${p.startsWith('.')?new URL(p,base).href:import.meta.resolve(p)}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))[name];
}
export async function loadScene(file = new URL('../../player/scene2d.ts',import.meta.url)) { return loadPlayerClass(file,'Scene2D'); }
export function canvasEnvironment() {
  const keys=['document','location','devicePixelRatio'], original=keys.map((k)=>Object.getOwnPropertyDescriptor(globalThis,k));
  const noop=()=>{};
  function canvas() {
    const state:any={font:'13px serif',fillStyle:'#1a262a',textAlign:'left',lineWidth:1,matrix:{a:1,b:0,c:0,d:1,e:0,f:0}}, stack:any[]=[];
    const mul=(a:number,b:number,c:number,d:number,e:number,f:number)=>{const m=state.matrix;state.matrix={a:m.a*a+m.c*b,b:m.b*a+m.d*b,c:m.a*c+m.c*d,d:m.b*c+m.d*d,e:m.a*e+m.c*f+m.e,f:m.b*e+m.d*f+m.f};};
    const funcs:any={save:()=>stack.push({...state,matrix:{...state.matrix}}),restore:()=>Object.assign(state,stack.pop()),getTransform:()=>state.matrix,setTransform:(a:number,b:number,c:number,d:number,e:number,f:number)=>state.matrix={a,b,c,d,e,f},translate:(x:number,y:number)=>mul(1,0,0,1,x,y),scale:(x:number,y:number)=>mul(x,0,0,y,0,0),rotate:(t:number)=>mul(Math.cos(t),Math.sin(t),-Math.sin(t),Math.cos(t),0,0),measureText:(s:string)=>({width:[...s].reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?1:.52)*parseFloat(/([\d.]+)px/.exec(state.font)![1]),0)})};
    const g=new Proxy(state,{get:(o,k:string)=>k in o?o[k]:k in funcs?funcs[k]:/create.*Gradient/.test(k)?()=>({addColorStop:noop}):noop});
    return {width:0,height:0,getContext:()=>g,remove:noop};
  }
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:canvas}});Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?qa'}});Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:1});
  return {element:(w:number,h:number)=>({prepend:noop,getBoundingClientRect:()=>({width:w,height:h})}),restore:()=>keys.forEach((k,i)=>original[i]?Object.defineProperty(globalThis,k,original[i]!):Reflect.deleteProperty(globalThis,k))};
}
