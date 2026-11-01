import * as Phaser from 'phaser';
import {SynthAudio} from '../audio/synth.js';
import {LAPS_TO_WIN,RallySession,TRACKS,decodeSave,encodeSave,sessionFromSave} from '../model/rally.js';
import type {Host} from '../mount.js';

const VIEW_WIDTH=640;
const VIEW_HEIGHT=420;
const SCALE=20;
const CENTER_X=VIEW_WIDTH/2;
const CENTER_Y=VIEW_HEIGHT/2;

export interface ViewHandle {
  element: HTMLElement;
  dispose(): void;
}

interface Context {
  owner: string;
  valid(): boolean;
  path(value: string): string;
  name(value: string): string;
  files: {
    read(path: string): Promise<{data: Uint8Array; version: string; status?: string}>;
    write(path: string, data: Uint8Array, version: string | null): Promise<{version: string; status?: string}>;
    stat?(path: string): Promise<{version: string; status?: string}>;
    subscribe?(callback: () => void): () => void;
  };
}

export async function startView(host: Host, signal: AbortSignal): Promise<ViewHandle> {
  const {make,textButton,appInput}=host.ui;
  const subject=host.w?.launchContext?.owner||host.storage.signedInSubject();
  if(!subject)throw Error('Sign in to open Pocket Rally.');
  const owner:string=subject;
  const windowState=host.w?.pocketRally??{dirty:false};
  if(host.w){host.w.pocketRally=windowState;host.w.ownerSub=owner;}
  let session=new RallySession(`rally-${crypto.randomUUID()}`,0);
  let paused=true,disposed=false,busy=false,revision=0,frame=0,graphics:Phaser.GameObjects.Graphics|null=null,game:Phaser.Game|null=null;
  let savedPath:string|null=null,savedVersion:string|null=null,unwatch=()=>{},watchSerial=0,watchCheck=0;
  let observedWindow:HTMLElement|null=null,windowObserver:MutationObserver|null=null;
  const audio=new SynthAudio();

  const element=make('section','pocket-rally-view'),header=make('header','rally-header');
  const title=make('div'),heading=make('h2','rally-heading','Pocket Rally'),subtitle=make('p','rally-subtitle','Three circuits. Three laps. One clean racing line.');
  title.append(heading,subtitle);
  const toolbar=make('div','rally-toolbar');
  const trackSelect=document.createElement('select'),handlingSelect=document.createElement('select');
  trackSelect.setAttribute('aria-label','Track');
  TRACKS.forEach((track,index)=>trackSelect.append(new Option(`Circuit ${index+1}`,String(index))));
  handlingSelect.setAttribute('aria-label','Handling');
  handlingSelect.append(new Option('Balanced','1'),new Option('Quick steering','2'));
  const runButton=textButton('Start race',()=>toggleRun()),resetButton=textButton('Reset to track',()=>resetCar()),openButton=textButton('Open from My files',()=>void open()),saveButton=textButton('Save to My files',()=>void save());
  toolbar.append(trackSelect,handlingSelect,runButton,resetButton,openButton,saveButton);
  header.append(title,toolbar);

  const layout=make('div','rally-layout'),stage=make('div','rally-stage'),side=make('aside','rally-side');
  stage.tabIndex=0;stage.setAttribute('role','application');stage.setAttribute('aria-label','Pocket Rally track. Arrow keys or WASD steer and accelerate, Space accelerates, Shift brakes, Escape pauses.');
  const hud=make('div','rally-hud'),ghostPreview=make('div','rally-ghost','Ghost: no completed lap'),warning=make('div','rally-warning'),status=make('div','app-status');
  warning.hidden=true;warning.setAttribute('role','status');status.setAttribute('role','status');
  const controls=make('div','rally-controls');
  type Control='left'|'right'|'gas'|'brake';
  const keys=new Set<string>();
  const pointers:Record<Control,Set<number>>={left:new Set(),right:new Set(),gas:new Set(),brake:new Set()};
  const pulses=new Set<Control>(),pulseTimers=new Map<Control,ReturnType<typeof setTimeout>>();
  const syncInputs=():void=>{
    const active=(control:Control,...keyboard:string[])=>pointers[control].size>0||pulses.has(control)||keyboard.some(key=>keys.has(key));
    session.setSteer(Number(active('right','arrowright','d'))-Number(active('left','arrowleft','a')));
    session.setThrottle(active('gas','arrowup','w',' '));session.setBrake(active('brake','arrowdown','s','shift'));
  };
  const clearInputs=():void=>{
    keys.clear();Object.values(pointers).forEach(ids=>ids.clear());pulses.clear();
    pulseTimers.forEach(timer=>clearTimeout(timer));pulseTimers.clear();syncInputs();
  };
  const holdButton=(label:string,control:Control):HTMLButtonElement=>{
    const button=textButton(label,()=>{});button.setAttribute('aria-label',label);
    button.addEventListener('pointerdown',event=>{if(event.button!==0||paused||busy||!valid())return;event.preventDefault();button.setPointerCapture(event.pointerId);pointers[control].add(event.pointerId);syncInputs()});
    const release=(event:PointerEvent)=>{pointers[control].delete(event.pointerId);syncInputs()};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('click',event=>{if(event.detail!==0||paused||busy||!valid())return;clearTimeout(pulseTimers.get(control));pulses.add(control);syncInputs();pulseTimers.set(control,setTimeout(()=>{pulses.delete(control);pulseTimers.delete(control);syncInputs()},120))});
    controls.append(button);return button;
  };
  holdButton('◀ Steer left','left');
  holdButton('Steer right ▶','right');
  holdButton('Gas','gas');
  holdButton('Brake','brake');

  const settings=document.createElement('details'),settingsSummary=make('summary','','Settings'),settingsRow=make('div','rally-settings-row');
  const soundLabel=make('label','','Sound '),sound=document.createElement('input'),volumeLabel=make('label','','Volume '),volume=document.createElement('input'),ghostLabel=make('label','','Ghost opacity '),ghostOpacity=document.createElement('input'),contrastLabel=make('label','','Contrast '),contrast=document.createElement('select'),motionLabel=make('label','','Motion '),motion=document.createElement('select');
  sound.type='checkbox';sound.setAttribute('aria-label','Sound effects');volume.type='range';volume.min='0';volume.max='100';volume.value='30';volume.disabled=true;volume.setAttribute('aria-label','Sound volume');
  ghostOpacity.type='range';ghostOpacity.min='10';ghostOpacity.max='80';ghostOpacity.value='35';ghostOpacity.setAttribute('aria-label','Ghost opacity');
  contrast.setAttribute('aria-label','Track contrast');contrast.append(new Option('Standard','standard'),new Option('High contrast','high'));
  motion.setAttribute('aria-label','Motion preference');motion.append(new Option('Full','full'),new Option('Reduced','reduce'));
  soundLabel.prepend(sound);volumeLabel.append(volume);ghostLabel.append(ghostOpacity);contrastLabel.append(contrast);motionLabel.append(motion);
  settingsRow.append(soundLabel,volumeLabel,ghostLabel,contrastLabel,motionLabel);settings.append(settingsSummary,settingsRow);

  const help=document.createElement('details');help.append(make('summary','','How to play'),make('p','','Cross every checkpoint in order for three laps. Leaving the authored road slows the car. Reset returns to the start and adds a three-second penalty. A finished lap records the ghost shown on later attempts.'));
  const saveDetails=document.createElement('details'),saveSummary=make('summary','','Save location'),saveFields=make('div','rally-save-fields');
  saveDetails.className='rally-save';
  const path=appInput('Rally save path',host.w?.launchContext?.path||'/Pocket Rally.game.json');
  const folder=textButton('Choose folder',()=>void chooseFolder());
  saveFields.append(path,folder);saveDetails.append(saveSummary,saveFields);
  side.append(hud,ghostPreview,settings,help,saveDetails,warning);
  layout.append(stage,side);element.append(header,layout,controls,status);

  const valid=()=>!disposed&&!signal.aborted&&element.isConnected&&owner===host.storage.signedInSubject();
  const announce=(message:string)=>{if(valid())status.textContent=message};
  const mark=()=>{windowState.dirty=true;revision++};
  const clearDirty=()=>{windowState.dirty=false};
  function refresh():void{
    const next=session.track.checkpoints[session.nextCheckpoint];
    const directionOk=session.speed<.4||Math.cos(session.heading)*(next.x-session.position.x)+Math.sin(session.heading)*(next.y-session.position.y)>=-.15;
    const best=session.bestLaps[session.trackId];
    runButton.textContent=paused?'Resume':'Pause';runButton.setAttribute('aria-label',runButton.textContent);
    hud.textContent=`Lap ${Math.min(session.lap,LAPS_TO_WIN)}/${LAPS_TO_WIN} · checkpoint ${session.nextCheckpoint+1}/${session.track.checkpoints.length}\nSpeed ${session.speed.toFixed(1)} · Penalty ${session.penaltySeconds.toFixed(1)}s · ${session.offroad?'Offroad':'On track'}${directionOk?'':' · WRONG WAY'}${session.finished?' · FINISHED':''}`;
    ghostPreview.textContent=best?`Ghost: ${(best.ms/1000).toFixed(2)}s · ${best.samples.length} samples`:'Ghost: no completed lap';
  }
  function toggleRun():void{
    if(busy||!valid())return;
    if(session.finished){restartSession();return}
    paused=!paused;audio.setMuted(!sound.checked);if(!paused&&sound.checked)audio.unlock();
    if(!paused){audio.resume()}else{clearInputs();audio.suspend()}
    announce(paused?'Race paused.':'Race running.');refresh();stage.focus({preventScroll:true});
  }
  function restartSession():void{
    clearInputs();const previousBest=structuredClone(session.bestLaps),previousMedals=[...session.medals];
    session=new RallySession(`rally-${crypto.randomUUID()}`,Number(trackSelect.value));session.handlingPreset=handlingSelect.value==='2'?2:1;
    session.bestLaps=previousBest;session.medals=previousMedals;
    paused=true;mark();savedPath=null;savedVersion=null;if(host.w)delete host.w.launchContext;
    path.value='/Pocket Rally.game.json';audio.suspend();announce('Fresh race ready. Press Resume.');refresh();
  }
  async function resetCar():Promise<void>{
    if(busy||!valid())return;
    const before=revision,beforeSave=encodeSave(session);
    if(windowState.dirty&&!await host.ui.confirm('Reset to the start line and add a penalty?',{title:'Reset car',confirmLabel:'Reset',cancelLabel:'Cancel',danger:true,signal}))return;
    if(!valid())return;
    if(revision!==before||encodeSave(session)!==beforeSave){announce('The race changed while confirming; try again.');return}
    clearInputs();session.resetCar();paused=true;audio.suspend();mark();announce('Car reset. A three-second penalty was added.');refresh();
  }
  async function chooseTrack():Promise<void>{
    if(busy||!valid())return;
    const before=revision;
    if(windowState.dirty&&!await host.ui.confirm('Change track and discard the current race?',{title:'Change track',confirmLabel:'Change track',cancelLabel:'Keep race',danger:true,signal})){trackSelect.value=String(session.trackId);return}
    if(!valid())return;
    if(revision!==before){trackSelect.value=String(session.trackId);announce('The race changed while confirming; try again.');return}
    restartSession();
  }
  function clearWatch():void{watchSerial++;watchCheck++;unwatch();unwatch=()=>{};warning.hidden=true;warning.textContent='';}
  function watch(context:Context,filePath:string,version:string):void{
    clearWatch();const serial=watchSerial;
    const check=async()=>{
      const checkId=++watchCheck;
      if(!valid()||!context.valid()||savedPath!==filePath||savedVersion!==version)return;
      let text='';
      try{const current=context.files.stat?await context.files.stat(filePath):await context.files.read(filePath);text=current.status==='conflict'?'This save has conflicting copies. Resolve them in Files.':current.version!==version?'The saved rally changed. Your current race is unchanged.':''}catch{text='The saved rally is unavailable. Your current race is unchanged.'}
      if(valid()&&serial===watchSerial&&checkId===watchCheck){warning.textContent=text;warning.hidden=!text}
    };
    unwatch=context.files.subscribe?.(check)||(()=>{});queueMicrotask(check);
  }
  async function save():Promise<void>{
    if(busy||!valid())return;
    busy=true;saveButton.disabled=true;paused=true;clearInputs();audio.suspend();refresh();
    const wasDirty=windowState.dirty,capturedRevision=revision,text=encodeSave(session),requested=path.value;
    let committed=false;
    windowState.dirty=true;
    try{
      const context=await host.storage.mirrorFileContext() as Context,target=context.path(requested);
      if(!target.toLowerCase().endsWith('.game.json'))throw Error('Use a .game.json file name.');
      let expected:string|null=null;
      try{
        const current=context.files.stat?await context.files.stat(target):await context.files.read(target);
        if(current.status==='conflict')throw Error('Resolve the conflict in Files first.');
        if(target===savedPath&&savedVersion){if(current.version!==savedVersion)throw Error('The saved rally changed. Save a copy or reopen it.')}
        else if(!await host.ui.confirm('Replace '+target+'?',{title:'Replace saved rally',confirmLabel:'Replace',cancelLabel:'Cancel',danger:true,signal})){announce('Save cancelled.');return}
        expected=current.version;
      }catch(error){if(!(error instanceof Error)||error.message!=='File not found.')throw error;if(target===savedPath&&savedVersion)throw Error('The saved rally was removed. Save a copy or reopen it.')}
      if(!valid()||!context.valid())return;
      const result=await context.files.write(target,new TextEncoder().encode(text),expected);
      if(!valid()||!context.valid())return;
      savedPath=target;savedVersion=result.version;path.value=target;
      if(host.w){host.w.launchContext=Object.freeze({version:1,storage:'mirror',path:target,owner});host.w.title=target.split('/').pop()+' — Pocket Rally'}
      const newer=revision!==capturedRevision||encodeSave(session)!==text;
      windowState.dirty=newer;committed=true;watch(context,target,result.version);
      announce(result.status==='conflict'?'Rally saved on this device with a conflict. Resolve it in Files.':newer?'Saved an earlier rally; newer race changes are unsaved.':'Rally saved to My files; syncing with the server.');
    }catch(error){announce('Could not save rally: '+(error instanceof Error?error.message:'unknown error'))}
    finally{if(!committed&&valid()&&revision===capturedRevision)windowState.dirty=wasDirty;busy=false;saveButton.disabled=false;refresh()}
  }
  async function open(selected?:string):Promise<void>{
    if(busy||!valid())return;
    busy=true;openButton.disabled=true;paused=true;clearInputs();audio.suspend();refresh();
    const before=revision,beforeSave=encodeSave(session),unchanged=()=>revision===before&&encodeSave(session)===beforeSave;
    try{
      if(windowState.dirty&&!await host.ui.confirm('Open a saved rally and discard current progress?',{title:'Unsaved race',confirmLabel:'Discard progress',cancelLabel:'Keep race',danger:true,signal})){announce('Race remains paused.');return}
      if(!valid())return;
      if(!unchanged())throw Error('The race changed while confirming; try again.');
      const choice=selected||await host.storage.pickFile({extensions:['.json'],signal});
      if(!choice||!valid())return;
      const context=await host.storage.mirrorFileContext() as Context,target=context.path(choice),file=await context.files.read(target);
      if(!valid()||!context.valid())return;
      if(file.status==='conflict')throw Error('Resolve the conflict in Files first.');
      if(file.data.byteLength>8*1024*1024)throw Error('Save file is too large.');
      const restored=sessionFromSave(decodeSave(new TextDecoder('utf-8',{fatal:true}).decode(file.data)));
      if(!valid()||!context.valid())return;
      if(!unchanged())throw Error('The race changed while opening; try again.');
      session=restored;paused=true;savedPath=target;savedVersion=file.version;path.value=target;
      trackSelect.value=String(session.trackId);handlingSelect.value=String(session.handlingPreset);clearDirty();revision++;
      if(host.w){host.w.launchContext=Object.freeze({version:1,storage:'mirror',path:target,owner});host.w.title=target.split('/').pop()+' — Pocket Rally'}
      watch(context,target,file.version);announce('Rally loaded at the start line and paused.');refresh();stage.focus({preventScroll:true});
    }catch(error){announce('Could not open rally: '+(error instanceof Error?error.message:'unknown error'))}
    finally{busy=false;openButton.disabled=false}
  }
  async function chooseFolder():Promise<void>{
    try{const directory=await host.storage.pickFolder({signal});if(directory===null||!valid())return;const context=await host.storage.mirrorFileContext() as Context;if(!valid()||!context.valid())return;path.value=context.path((directory==='/'?'':directory)+'/'+context.name(path.value.split('/').pop()||'Pocket Rally.game.json'))}catch(error){announce('Could not choose folder: '+(error instanceof Error?error.message:'unknown error'))}
  }
  const draw=():void=>{
    if(!graphics)return;
    const high=contrast.value==='high';
    graphics.clear();graphics.fillStyle(high?0x08130d:0x203126,1);graphics.fillRect(0,0,VIEW_WIDTH,VIEW_HEIGHT);
    graphics.lineStyle(high?5:4,high?0xffffff:0xc7c2b5,1);graphics.beginPath();
    session.track.checkpoints.forEach((point,index)=>{const x=CENTER_X+point.x*SCALE,y=CENTER_Y+point.y*SCALE;if(index===0)graphics!.moveTo(x,y);else graphics!.lineTo(x,y)});graphics.closePath();graphics.strokePath();
    session.track.checkpoints.forEach((point,index)=>{const x=CENTER_X+point.x*SCALE,y=CENTER_Y+point.y*SCALE;graphics!.fillStyle(index===session.nextCheckpoint?0xf1d65f:0x8a978e,1);graphics!.fillCircle(x,y,8)});
    const ghost=session.bestLaps[session.trackId],tick=session.currentLapTick();
    if(ghost&&ghost.samples.length){
      const sample=ghost.samples.reduce((best,item)=>Math.abs(item.tick-tick)<Math.abs(best.tick-tick)?item:best,ghost.samples[0]);
      graphics.fillStyle(0x7fc5e8,Number(ghostOpacity.value)/100);graphics.fillCircle(CENTER_X+sample.x*SCALE,CENTER_Y+sample.y*SCALE,8);
    }
    const x=CENTER_X+session.position.x*SCALE,y=CENTER_Y+session.position.y*SCALE;
    graphics.fillStyle(high?0xffffff:0xe85c5c,1);graphics.fillTriangle(x-Math.cos(session.heading)*12,y-Math.sin(session.heading)*12,x+Math.cos(session.heading+2.5)*10,y+Math.sin(session.heading+2.5)*10,x+Math.cos(session.heading-2.5)*10,y+Math.sin(session.heading-2.5)*10);
  };
  const keyboard=(event:KeyboardEvent):void=>{
    if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement)return;
    const key=event.key.toLowerCase();if(!['arrowleft','arrowright','arrowup','arrowdown','a','d','w','s',' ','shift','escape'].includes(key))return;
    event.preventDefault();
    if(key==='escape'){if(!event.repeat)toggleRun();return}
    if(paused||busy)return;
    keys.add(key);syncInputs();if(!session.finished)mark();
  };
  const keyup=(event:KeyboardEvent):void=>{keys.delete(event.key.toLowerCase());syncInputs()};
  const stageBlur=():void=>{keys.clear();syncInputs()};
  stage.addEventListener('keydown',keyboard);stage.addEventListener('keyup',keyup);stage.addEventListener('blur',stageBlur);
  trackSelect.addEventListener('change',()=>void chooseTrack());
  handlingSelect.addEventListener('change',()=>{session.handlingPreset=handlingSelect.value==='2'?2:1;mark();refresh()});
  sound.addEventListener('change',()=>{volume.disabled=!sound.checked;audio.setMuted(!sound.checked);if(sound.checked&&!paused)audio.unlock()});
  volume.addEventListener('input',()=>{audio.setVolume(Number(volume.value)/100);if(!paused&&sound.checked)audio.tone(440,30)});
  const suspend=():void=>{if(!valid())return;clearInputs();paused=true;audio.suspend();announce('Race paused when its window lost attention.');refresh()};
  const visibility=()=>{if(document.hidden)suspend()};
  const watchWindow=():void=>{
    const target=element.closest<HTMLElement>('.window');
    if(target!==observedWindow){
      windowObserver?.disconnect();observedWindow=target;windowObserver=new MutationObserver(()=>{
        if(observedWindow&&(observedWindow.hidden||!observedWindow.classList.contains('focused')||observedWindow.classList.contains('rolled')))suspend();
      });
      if(target)windowObserver.observe(target,{attributes:true,attributeFilter:['class','hidden']});
    }
    if(target&&(target.hidden||!target.classList.contains('focused')||target.classList.contains('rolled')))suspend();
  };
  window.addEventListener('blur',suspend);document.addEventListener('visibilitychange',visibility);
  queueMicrotask(()=>{
    if(disposed)return;
    game=new Phaser.Game({type:Phaser.CANVAS,audio:{noAudio:true},parent:stage,width:VIEW_WIDTH,height:VIEW_HEIGHT,backgroundColor:'#203126',scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},scene:{create(){graphics=this.add.graphics()},update(_time,delta){if(disposed)return;watchWindow();if(!paused&&!session.finished){session.advance(delta);mark();refresh()}draw()}}});
    watchWindow();
    const loader=()=>{const initial=host.w?.launchContext;if(initial?.storage==='mirror'&&initial.owner===owner){const wait=(attempt=0)=>{if(disposed||signal.aborted)return;if(!element.isConnected&&attempt<60)setTimeout(()=>wait(attempt+1),16);else if(valid())void open(initial.path)};queueMicrotask(()=>wait())}else announce('Press Resume to race.')};
    loader();
  });
  refresh();
  return{element,dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);clearWatch();windowObserver?.disconnect();windowObserver=null;observedWindow=null;stage.removeEventListener('keydown',keyboard);stage.removeEventListener('keyup',keyup);stage.removeEventListener('blur',stageBlur);clearInputs();window.removeEventListener('blur',suspend);document.removeEventListener('visibilitychange',visibility);audio.dispose();game?.destroy(true);game=null;graphics=null;}};
}
