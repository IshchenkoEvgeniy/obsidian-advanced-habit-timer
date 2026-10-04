import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { fetchSessionsFromFile } from '../src/utils';

async function read(row:string){
    return fetchSessionsFromFile({vault:{read:async()=>row}} as never,new TFile('Daily/2026-10-04.md'));
}
describe('Session reader',()=>{
    it('ignores journal examples in fenced code',async()=>{
        const row='| 12:00 - 12:01 | Telegram | Focus | 00:01:00 | Note |';
        expect(await read(`\`\`\`markdown\n${row}\n\`\`\`\n${row}`)).toHaveLength(1);
    });
    it('reads escaped pipes and hides internal write receipts from the summary',async()=>{
        expect(await read('| 12:00 - 12:01 | ⏱️ | Focus: API: work | 00:01:00 | - | Read \\| write <!-- timer-session:one --> |'))
            .toEqual([expect.objectContaining({habit:'Focus',subTask:'API: work',task:'Read | write',durationSec:60})]);
    });
    it('reads large durations and legacy Telegram rows',async()=>{
        expect(await read('| 12:00 - 12:01 | Telegram | Focus | 100:00:00 | Note |'))
            .toEqual([expect.objectContaining({habit:'Focus',task:'Note',durationSec:360000})]);
    });
});
