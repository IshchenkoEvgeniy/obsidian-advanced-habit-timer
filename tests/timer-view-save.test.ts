import { describe, expect, it, vi } from 'vitest';
import { TimerView } from '../src/timer/timer-view';
import { TFile } from 'obsidian';

vi.mock('../src/components/timer/TimerApp.svelte',()=>({default:{}}));
vi.mock('../src/components/charts/Heatmap.svelte',()=>({default:{}}));
vi.mock('../src/session-modals',()=>({DaySummaryModal:class{}}));
vi.mock('../src/media-modals',()=>({SaveMediaSessionModal:class{}}));
vi.mock('../src/timer/music-player',()=>({MusicPlayer:class{}}));

describe('Timer save failure recovery',()=>{
    it('retries the frozen save directly even if the current date or timer settings changed',async()=>{
        const view=Object.create(TimerView.prototype) as TimerView;
        const file=new TFile('Daily/2026-10-03.md');
        const executeSave=vi.fn(async()=>{}),ensureDailyNote=vi.fn();
        Object.assign(view,{isSaving:false,engine:{pause:async()=>{}},app:{vault:{getAbstractFileByPath:()=>file}},executeSave,ensureDailyNote,
            plugin:{settings:{pomodoroDuration:5,activeTimer:{pendingCommit:{dailyNotePath:file.path,habitName:'Focus',displayProperty:'Focus',
                durationSeconds:600,progressAdded:2,note:'Original',mediaPath:'Book.md'}}}}});
        await view.save();
        expect(executeSave).toHaveBeenCalledWith(file,'Focus','Focus',600,2,'Original','Book.md');
        expect(ensureDailyNote).not.toHaveBeenCalled();
    });
    it('releases the save lock if pausing fails before opening the save dialog',async()=>{
        const view=Object.create(TimerView.prototype) as TimerView;
        const pause=vi.fn().mockRejectedValue(new Error('disk failure'));
        Object.assign(view,{isSaving:false,engine:{pause}});
        await expect(view.save()).rejects.toThrow('disk failure');
        await expect(view.save()).rejects.toThrow('disk failure');
        expect(pause).toHaveBeenCalledTimes(2);
    });
});
