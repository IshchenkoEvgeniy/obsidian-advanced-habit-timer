<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { TFile } from './design-obsidian';
    import type HabitTimerPlugin from '../../src/main';
    import { defaultDesignSettings } from '../../src/design/schema';
    import { DesignService } from '../../src/design/service';
    import { BoardSession } from '../../src/design/session';
    import { parseBoard } from '../../src/design/board';
    import { splitNote } from '../../src/design/markdown';
    import { exportBoard, boardSvg } from '../../src/design/export';
    import { sanitizeRichText } from '../../src/design/rich-text';
    import { designClipboard } from '../../src/design/clipboard';
    import Hub from '../../src/design/components/DesignHub.svelte';
    import Board from '../../src/design/components/DesignBoard.svelte';
    let ready = false, mode = 'hub', mobile = false, revision = 0, initialBoard = '', running = false;
    let results: string[] = [], session: BoardSession, ids: string[] = [];
    const files = new Map<string, { file: TFile; raw: string; binary?: ArrayBuffer }>(), folders = new Set<string>(), sessions = new Map<string, BoardSession>();
    const events = new Map<string, ((...args: any[]) => void)[]>();
    const on = (key: string, handler: (...args: any[]) => void) => { const handlers = events.get(key) || []; handlers.push(handler); events.set(key, handlers); return {}; };
    const emit = (key: string, ...args: any[]) => events.get(key)?.forEach(handler => handler(...args));
    const vault = { on, getFiles: () => [...files.values()].map(entry => entry.file), getAbstractFileByPath: (path: string) => files.get(path)?.file || (folders.has(path) ? { path } : undefined), read: async (file: TFile) => files.get(file.path)!.raw, createFolder: async (path: string) => { folders.add(path); }, create: async (path: string, raw: string) => { const file = new TFile(path); files.set(path, { file, raw }); emit('create', file); return file; }, process: async (file: TFile, mutate: (raw: string) => string) => { const entry = files.get(file.path)!; entry.raw = mutate(entry.raw); emit('modify', file); return entry.raw; }, rename: async (file: TFile, path: string) => { const old = file.path; const entry = files.get(old)!; files.delete(old); file.path = path; file.basename = path.split('/').pop()!.replace(/\.md$/, ''); files.set(path, entry); emit('rename', file, old); }, getResourcePath: (file: TFile) => { const binary = files.get(file.path)?.binary; return binary ? ('data:' + (file.extension === 'svg' ? 'image/svg+xml' : 'image/png') + ';base64,') + btoa(String.fromCharCode(...new Uint8Array(binary))) : ''; }, readBinary: async (file: TFile) => files.get(file.path)!.binary!, createBinary: async (path: string, binary: ArrayBuffer) => { const file = await vault.create(path, ''); files.get(path)!.binary = binary; return file; } };
    const plugin = { settings: { language: 'ru', design: defaultDesignSettings('ru'), projectScopes: [{ id: 'game', name: 'Factory Farm Dungeon Mining', statuses: 'Запланировано, В работе, Готово', sourceType: 'file', sourceValue: 'Checklist.md' }] }, app: { vault, metadataCache: { on, getFileCache: (file: TFile) => ({ frontmatter: file.extension === 'md' ? splitNote(files.get(file.path)?.raw || '').frontmatter : undefined }) }, fileManager: { renameFile: vault.rename, trashFile: async (file: TFile) => { files.delete(file.path); emit('delete', file); } }, workspace: { getLeaf: () => ({ openFile: async () => undefined }) } }, registerEvent() {}, async saveSettings() {}, projectEngine: { loadTasks: async () => [{ id: 'task1', name: '25.3 Торговля в шахте', section: '25. Шахта', status: 'В работе' }] } } as unknown as HabitTimerPlugin;
    const service = new DesignService(plugin);
    (window as any).designFixture = { service, sessions, files, exportBoard, boardSvg, sanitizeRichText, designClipboard, get initialBoard() { return initialBoard; } };
    onMount(() => void (async () => { await service.initialize(); const names = ['Лиза', 'Шахта', 'Торговля', 'Медная кирка', 'Пещерный слизень', 'Гильдия шахтёров', 'Потерянная смена', 'Цена руды', 'Лифт между уровнями']; for (let i = 0; i < 9; i++) { const type = service.settings.types[i]!; const entity = await service.createEntity(type.id, names[i]!, { task: 'task1', tags: 'шахта', ...(i === 0 ? { role: 'Торговец', level: 3 } : {}) }, 'Описание мира и заметки о механиках.'); ids.push(entity.id); } const doc = await service.createBoard('Общая карта'); initialBoard = doc.board.id; session = new BoardSession(service, doc, () => revision++); session.board.items = ids.map((ref, i) => ({ id: 'e' + i, kind: 'entity', ref, x: 30 + i % 3 * 290, y: 30 + Math.floor(i / 3) * 250, w: 250, h: 190, z: 2, autoSize: true })); session.board.edges = [{ id: 'edge', from: 'e0', to: 'e1', style: 'curve', label: 'работает в', arrow: 'end' }]; session.touch(); await session.flush(); ready = true; })());
    function assert(value: unknown, name: string) { if (!value) throw new Error(name); results = [...results, 'PASS ' + name]; }
    function tap(node: Element, x: number, y: number, id = 1, type = 'mouse') { dispatch(node, 'pointerdown', x, y, id, type); dispatch(node, 'pointerup', x, y, id, type); }
    function dispatch(node: Element, name: string, x: number, y: number, id = 1, type = 'mouse') { const canvas = document.querySelector('.design-canvas') as HTMLElement; const rect = canvas.getBoundingClientRect(); node.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: id, pointerType: type, clientX: rect.left + x, clientY: rect.top + y, button: 0 })); }
    async function run() {
        if (running) return; running = true; results = []; mode = 'test'; await tick();
        const canvas = document.querySelector('.design-canvas') as HTMLElement; canvas.setPointerCapture = () => {}; // Untrusted fixture events do not have browser pointer capture.
        const button = (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
        try {
            session.board.viewport = { x: 0, y: 0, zoom: 1 }; session.touch(); await tick();
            const first = document.querySelector('[data-item="e0"]')!;
            dispatch(first, 'pointerdown', 80, 80); dispatch(canvas, 'pointermove', 120, 110); dispatch(canvas, 'pointerup', 120, 110); await tick();
            assert(session.board.items[0]!.x === 70 && session.board.items[0]!.y === 60, 'Mouse drag updates world coordinates');
            session.undo(); await tick(); assert(session.board.items[0]!.x === 30, 'Undo restores original geometry');
            button('Стрелка'); await tick(); tap(document.querySelector('[data-item="e0"]')!, 80, 80); tap(document.querySelector('[data-item="e1"]')!, 350, 80); await session.flush(); assert(session.board.edges.length === 2, 'Arrow tool connects two records'); assert(files.get(service.index.resolve(ids[0]!)!.path)!.raw.includes('[[Projects/'), 'Arrow writes a managed wikilink');
            button('Перо'); await tick(); dispatch(canvas, 'pointerdown', 250, 200, 2, 'touch'); for (let i = 1; i < 15; i++) dispatch(canvas, 'pointermove', 250 + i * 4, 200 + Math.sin(i) * 10, 2, 'touch'); dispatch(canvas, 'pointerup', 310, 210, 2, 'touch'); await tick(); assert(session.board.items.some(item => item.kind === 'stroke'), 'Touch pen creates a movable stroke');
            button('Выбор'); await tick(); const startZoom = session.board.viewport.zoom; dispatch(canvas, 'pointerdown', 200, 150, 3, 'touch'); dispatch(canvas, 'pointerdown', 300, 150, 4, 'touch'); dispatch(canvas, 'pointermove', 350, 180, 4, 'touch'); dispatch(canvas, 'pointerup', 200, 150, 3, 'touch'); dispatch(canvas, 'pointerup', 350, 180, 4, 'touch'); await tick(); assert(session.board.viewport.zoom > startZoom && Number.isFinite(session.board.viewport.x), 'Two fingers pan and zoom');
            const p = session.board.items.find(item => item.id === 'e0')!; const viewport = session.board.viewport; dispatch(document.querySelector('[data-item="e0"]')!, 'pointerdown', (p.x + 20) * viewport.zoom + viewport.x, (p.y + 20) * viewport.zoom + viewport.y, 5, 'touch'); await new Promise(resolve => setTimeout(resolve, 600)); await tick(); assert(document.querySelector('.design-object-panel'), 'Long touch opens object actions'); dispatch(canvas, 'pointerup', 80, 80, 5, 'touch');
            await session.flush(); assert(parseBoard(files.get(session.path)!.raw).items.some(item => item.kind === 'stroke'), 'Board edits persist through serialization');
        } catch (e) { results = [...results, 'FAIL ' + String(e)]; }
        running = false;
    }
    async function performanceCheck(cards = false) {
        running = true; results = []; mode = 'test';
        session.board.items = Array.from({ length: 500 }, (_, i) => ({ id: 'load-' + i, kind: cards ? 'entity' : 'sticky', ref: cards ? ids[i % ids.length] : undefined, autoSize: cards, text: 'Объект ' + i, color: '#facc15', x: i % 25 * 270, y: Math.floor(i / 25) * 200, w: 230, h: 160, z: 1 })); session.board.edges = []; session.board.viewport = { x: 0, y: 0, zoom: cards ? .12 : 1 }; session.touch(); await tick();
        assert(cards ? document.querySelectorAll('[data-item]').length === 500 : document.querySelectorAll('[data-item]').length < 500, cards ? '500 cards: all cards visible in the fit view' : '500 objects: only visible objects are mounted');
        const times: number[] = []; let previous = performance.now();
        for (let i = 0; i < 120; i++) { session.board.viewport.x = cards ? -i * .25 : -i * 12; session.board.viewport.zoom = cards ? .12 + .02 * Math.sin(i / 20) : .8 + .2 * Math.sin(i / 20); revision++; await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const now = performance.now(); times.push(now - previous); previous = now; }
        const sorted = [...times].sort((a, b) => a - b), median = sorted[60]!, p95 = sorted[114]!;
        results = [...results, `500 ${cards ? 'cards' : 'objects'}: median ${median.toFixed(1)} ms (${(1000 / median).toFixed(0)} FPS), p95 ${p95.toFixed(1)} ms; ${document.querySelectorAll('[data-item]').length} mounted`]; running = false;
    }
</script>
<div class="fixture-controls"><button on:click={() => mode = 'hub'}>Хаб</button><button on:click={() => mobile = !mobile}>390 px</button><button disabled={!ready || running} on:click={run}>Проверить жесты</button><button disabled={!ready || running} on:click={() => performanceCheck()}>500 объектов</button><button disabled={!ready || running} on:click={() => performanceCheck(true)}>500 карточек</button><span>{running ? 'Проверка…' : 'Только данные в памяти, vault не изменяется'}</span></div>
<div class="fixture-results" aria-live="polite">{#each results as result}<div>{result}</div>{/each}</div>
<div class="fixture-surface" class:mobile>{#if ready}{#if mode === 'hub'}<Hub {service} {sessions} {initialBoard} />{:else}<Board {service} {session} {revision} onOpenEntity={() => {}} onNavigate={() => {}} onNewEntity={() => {}} />{/if}{:else}Загрузка…{/if}</div>
<style>:global(#root){height:100vh;display:flex;flex-direction:column}.fixture-controls{display:flex;gap:8px;align-items:center;padding:8px;flex-wrap:wrap;flex-shrink:0}.fixture-controls span{font-size:12px;color:#64748b}.fixture-results{font-family:monospace;font-size:12px;max-height:160px;overflow:auto;padding:0 12px;flex-shrink:0}.fixture-surface{flex:1;min-height:0;width:100%;margin:auto}.fixture-surface.mobile{width:390px;max-width:100%}</style>
