import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/types';
import { CloudflareCompanionService } from '../src/services/cloudflare-companion-service';

vi.mock('obsidian',async importOriginal=>{
    const actual=await importOriginal<typeof import('obsidian')>();
    return {...actual,moment:()=>({subtract:()=>({format:()=> '2026-06-06'})})};
});

function harness() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.dailyNotesFolder = 'Daily';
    settings.properties = [{id:'focus',name:'Focus',type:'timer',goalMinutes:10,globalGoalHours:1}];
    settings.projectScopes = [];
    const file = new TFile('Daily/2026-10-04.md');
    let content='### Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n\n## Review\nKeep me\n';
    const fm:Record<string,unknown>={Progress:10,Total:100};
    const book=new TFile('Books/Book.md');
    const plugin = {settings,saveSettings:vi.fn(async()=>{}),formatTime:(n:number)=>`00:${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`,
        app:{vault:{getMarkdownFiles:()=>[file],getAbstractFileByPath:(path:string)=>path===book.path?book:null,
            process:vi.fn(async(_:unknown,fn:(s:string)=>string)=>{content=fn(content);return content;})},
            fileManager:{processFrontMatter:async(_:unknown,fn:(fm:Record<string,unknown>)=>void)=>fn(fm)},
            metadataCache:{getFileCache:()=>({frontmatter:{Focus:'00:00:00'}})}},
        stateManager:{mediaItems:writable([]),refreshAllMedia:vi.fn()},projectEngine:{loadTasks:vi.fn(async()=>[])},
        dailyNotes:{updateTimer:vi.fn(async()=>{}),appendSessionLog:vi.fn(async()=>{})}};
    const service = new CloudflareCompanionService(plugin as never);
    const internal = service as unknown as {
        request:(path:string,method:string,body?:unknown)=>Promise<{status:number;json:unknown}>;
        pullEvents:()=>Promise<boolean>;pushSnapshot:(skip:boolean)=>Promise<void>;buildProjectSnapshot:()=>Promise<unknown>;applyEvent:(event:unknown)=>Promise<void>;
    };
    return {plugin,internal,fm,book,content:()=>content};
}
const event={sequence:1,event_id:'one',event_type:'add_timer',habit_name:'Focus',habit_date:'2026-10-04',amount:60,state:null,payload_json:'{}',created_at:0};

describe('Companion sync retries',()=>{
    it('retries a failed media progress log without adding reading time twice',async()=>{
        const h=harness();
        const update={...event,event_type:'library_update',habit_name:h.book.path,payload_json:JSON.stringify({path:h.book.path,timeSpentSeconds:60,progress:15,
            progressLog:{date:'2026-10-04',time:'00:01:00',progress:15,total:100,delta:5,note:'Chapter'}})};
        h.plugin.app.vault.process.mockRejectedValueOnce(new Error('disk failure'));
        await expect(h.internal.applyEvent(update)).rejects.toThrow();
        await h.internal.applyEvent(update);await h.internal.applyEvent(update);
        expect(h.fm['Reading time']).toBe('00:01:00');
        expect(h.content().match(/Chapter/g)).toHaveLength(1);
        expect(h.content().indexOf('Chapter')).toBeLessThan(h.content().indexOf('## Review'));
    });
    it('retries acknowledgement after the cursor was already saved',async()=>{
        const {plugin,internal}=harness();
        const request=vi.fn().mockResolvedValueOnce({status:200,json:{ok:true,events:[event]}})
            .mockRejectedValueOnce(new Error('response lost'))
            .mockResolvedValueOnce({status:200,json:{ok:true,events:[]}})
            .mockResolvedValueOnce({status:200,json:{ok:true}});
        internal.request=request;
        await expect(internal.pullEvents()).rejects.toThrow('response lost');
        expect(plugin.settings.cloudflareSyncCursor).toBe(1);
        await internal.pullEvents();
        expect(request).toHaveBeenLastCalledWith('/api/sync/ack','POST',{through:1});
        expect(plugin.dailyNotes.updateTimer).toHaveBeenCalledTimes(1);
    });
    it('defers cached values and project statistics immediately after applying an event',async()=>{
        const {internal}=harness();
        const request=vi.fn().mockResolvedValue({status:200,json:{ok:true,events:[event]}});
        internal.request=request;
        const changed=await internal.pullEvents();
        expect(changed).toBe(true);
        await internal.pushSnapshot(changed);
        const payload=request.mock.calls.find(call=>call[0]==='/api/sync/push')?.[2] as Record<string,unknown>;
        expect(payload.values).toEqual([]);
        expect(payload).not.toHaveProperty('projects');
        expect(payload).not.toHaveProperty('boardTasks');
    });
    it('aborts a project snapshot on a failed scope instead of publishing partial data',async()=>{
        const {plugin,internal}=harness();
        plugin.settings.projectScopes=[{id:'one',name:'One',sourceType:'folder',sourceValue:'Projects',statuses:'Backlog,Done'}];
        plugin.projectEngine.loadTasks.mockRejectedValueOnce(new Error('read failed'));
        await expect(internal.buildProjectSnapshot()).rejects.toThrow('read failed');
    });
});
