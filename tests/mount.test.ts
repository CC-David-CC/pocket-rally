import {describe,expect,it} from './test-shim.ts';
import {mount} from '../src/mount.ts';

const make=(tag:string,className=''):HTMLElement=>({
  tagName:tag.toUpperCase(),
  className,
  textContent:'',
  children:[],
  append(...children:HTMLElement[]){(this as any).children.push(...children)},
  replaceChildren(){(this as any).children=[]},
  addEventListener(){},
} as unknown as HTMLElement);

describe('Pocket Rally mount contract',()=>{
  it('returns an element and idempotent disposal',()=>{
    const controller=new AbortController();
    const view=mount({
      signal:controller.signal,
      ui:{
        make,
        textButton:(label)=>{const button=make('button');button.textContent=label;return button as HTMLButtonElement},
        appInput:(label,value)=>{const input=make('input') as HTMLInputElement;input.value=value||'';return input},
        confirm:async()=>true,
      },
      storage:{
        signedInSubject:()=> 'test',
        mirrorFileContext:async()=>{throw Error('not needed')},
        pickFile:async()=>null,
        pickFolder:async()=>null,
      },
    });
    expect(view.element.className).toContain('window-content');
    view.dispose();view.dispose();
  });
});
