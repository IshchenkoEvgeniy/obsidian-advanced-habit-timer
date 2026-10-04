import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { DailyNoteService } from '../src/services/daily-note-service';

vi.mock('obsidian',async importOriginal=>({...await importOriginal<typeof import('obsidian')>(),normalizePath:(s:string)=>s.replace(/\\/g,'/').replace(/\/+/g,'/')}));

function harness(folder='Daily') {
    const file=new TFile(`${folder}/2026-10-04.md`);
    const entries=new Map<string,unknown>([[file.path,file],[folder,{path:folder}]]);
    let content='';
    const fm:Record<string,unknown>={};
    const vault={getAbstractFileByPath:(path:string)=>entries.get(path)||null,
        createFolder:vi.fn(async(path:string)=>{entries.set(path,{path});}),
        create:vi.fn(async(path:string)=>{if(!entries.has(path.slice(0,path.lastIndexOf('/'))))throw new Error('parent missing');const f=new TFile(path);entries.set(path,f);return f;}),
        read:vi.fn(async()=>content),modify:vi.fn(async(_:unknown,next:string)=>{content=next;}),
        process:vi.fn(async(_:unknown,fn:(s:string)=>string)=>{content=fn(content);return content;})};
    const app={vault,fileManager:{processFrontMatter:async(_:unknown,fn:(fm:Record<string,unknown>)=>void)=>fn(fm)}};
    const plugin={settings:{dailyNotesFolder:folder,properties:[]}};
    return {service:new DailyNoteService(app as never,plugin as never),vault,entries,fm,content:()=>content};
}

describe('Daily note writes',()=>{
    it('creates missing parent folders before the first daily note',async()=>{
        const h=harness('Notes/Daily');h.entries.clear();
        expect(await h.service.ensureNote('2026-10-05')).toBeInstanceOf(TFile);
        expect(h.vault.createFolder.mock.calls).toEqual([['Notes'],['Notes/Daily']]);
    });
    it('toggles quoted YAML false values correctly',async()=>{
        const h=harness();h.fm.Check='false';h.fm['Avoid-Relapse']='false';
        await h.service.toggleBinary('Check','2026-10-04');
        await h.service.logRelapse('Avoid','2026-10-04');
        expect(h.fm.Check).toBe(true);expect(h.fm['Avoid-Relapse']).toBe(true);
    });
    it('preserves concurrent captures and retries a cloud capture once',async()=>{
        const h=harness();
        await Promise.all([h.service.appendCapture('thought','First','2026-10-04'),h.service.appendCapture('thought','Second','2026-10-04')]);
        expect(h.content()).toContain('First');expect(h.content()).toContain('Second');
        await h.service.appendCapture('thought','Cloud','2026-10-04','','12:00','one');
        await h.service.appendCapture('thought','Cloud','2026-10-04','','12:00','one');
        expect(h.content().match(/Cloud/g)).toHaveLength(1);
    });
    it('retries timer events after a log write failure without incrementing twice',async()=>{
        const h=harness();
        await h.service.updateTimer('Focus',60,'2026-10-04','one');
        h.vault.process.mockRejectedValueOnce(new Error('disk failure'));
        await expect(h.service.appendSessionLog('Focus',60,'2026-10-04',{eventId:'one'})).rejects.toThrow();
        await h.service.updateTimer('Focus',60,'2026-10-04','one');
        await h.service.appendSessionLog('Focus',60,'2026-10-04',{eventId:'one'});
        await h.service.appendSessionLog('Focus',60,'2026-10-04',{eventId:'one'});
        expect(h.fm.Focus).toBe('00:01:00');
        expect(h.content().match(/\| 00:01:00 \|/g)).toHaveLength(1);
    });
    it('throws on a failed cloud event write so it is not acknowledged',async()=>{
        const h=harness();h.entries.clear();h.vault.create.mockRejectedValue(new Error('disk failure'));
        await expect(h.service.updateTimer('Focus',60,'2026-10-04','one')).rejects.toThrow();
    });
});
