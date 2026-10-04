import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingTimer } from '../src/timer/floating-timer';

vi.mock('../src/timer/timer-view',()=>({VIEW_TYPE_TIMER:'habit-timer-view'}));

function harness() {
    const app={loadLocalStorage:vi.fn(),saveLocalStorage:vi.fn(),workspace:{getActiveViewOfType:()=>null}};
    const plugin={app,saveSettings:vi.fn(async()=>{}),formatTime:vi.fn(String),settings:{pomodoroDuration:25,activeTimer:{habitName:'Focus',mode:'pm',elapsedSeconds:1200,remainingSeconds:300,lastStartedAt:1_000_000}}};
    const timer=new FloatingTimer(plugin as never);
    const internal=timer as unknown as {restorePosition:()=>void;setPosition:(x:number,y:number)=>void;refresh:()=>void;onPointerUp:(event:unknown)=>void};
    const setPosition=vi.fn();internal.setPosition=setPosition;
    Object.assign(timer,{root:{ownerDocument:{defaultView:{innerWidth:300,innerHeight:400}},style:{left:'12px',top:'16px'},classList:{toggle:vi.fn()}},
        timeEl:{setText:vi.fn()},labelEl:{setText:vi.fn()},drag:{pointerId:1,offsetX:0,offsetY:0}});
    return {app,plugin,internal,setPosition};
}
afterEach(()=>vi.restoreAllMocks());

describe('Floating timer',()=>{
    it('persists coordinates through plugin settings on older Obsidian versions',()=>{
        const h=harness();Object.assign(h.app,{loadLocalStorage:undefined,saveLocalStorage:undefined});
        h.internal.onPointerUp({pointerId:1});
        expect(h.plugin.settings).toMatchObject({floatingTimerPosition:{x:12,y:16}});
        h.internal.restorePosition();expect(h.setPosition).toHaveBeenCalledWith(12,16);
        expect(h.plugin.saveSettings).toHaveBeenCalled();
    });
    it('restores and saves validated coordinates in the vault preferences',()=>{
        const h=harness();h.app.loadLocalStorage.mockReturnValue({x:30,y:40});
        h.internal.restorePosition();expect(h.setPosition).toHaveBeenLastCalledWith(30,40);
        h.app.loadLocalStorage.mockReturnValue({x:'invalid',y:NaN});
        h.internal.restorePosition();expect(h.setPosition).toHaveBeenLastCalledWith(76,280);
        h.internal.onPointerUp({pointerId:1});
        expect(h.app.saveLocalStorage).toHaveBeenCalledWith('habit-timer:floating-timer-position',{x:12,y:16});
    });
    it('caps elapsed pomodoro time after browser intervals are delayed',()=>{
        const h=harness();vi.spyOn(Date,'now').mockReturnValue(1_600_000);
        h.internal.refresh();expect(h.plugin.formatTime).toHaveBeenCalledWith(1500);
    });
});
