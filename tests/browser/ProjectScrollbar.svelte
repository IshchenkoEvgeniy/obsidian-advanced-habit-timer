<script>
    import { onMount } from 'svelte';
    import { TFile } from 'obsidian';
    import ProjectsApp from '../../src/components/projects/ProjectsApp.svelte';
    import { createProjectsStore } from '../../src/store/ProjectsStore';
    let width = 1300;
    let visible = true;
    let version = 0;
    let metrics = '';
    let errors = '';
    const columns = ['Backlog', 'To Do', 'In Progress', 'Idea', 'Done'];
    const scope = { id: 'scrollbar-test', name: 'Проверка прокрутки', sourceType: 'file', sourceValue: 'Project.md', statuses: columns.join(', ') };
    const plugin = { settings: { language: 'ru', properties: [], projectScopes: [scope] }, formatTime: () => '00:00:00' };
    const app = { vault: { getFileByPath: () => null }, metadataCache: { getFirstLinkpathDest: () => null }, workspace: { openLinkText: async () => {} } };
    const file = new TFile('Project.md');
    const tasks = Array.from({length: 205}, (_, index) => ({ id: `task-${index}`, file,
        name: `Задача ${index + 1}`, status: index < 173 ? 'Backlog' : index < 177 ? 'Idea' : 'Done', timeSpentSec: 0, order: index }));
    const store = createProjectsStore();
    store.currentTab.set('board');
    store.snapshot.set({ activeScopeId: scope.id, tasks, archivedTasks: [], stages: [], columns,
        scopesWithStats: [{ id: scope.id, name: scope.name, total: tasks.length, done: 28, pct: 14 }] });
    const view = { store, dataEngine: {}, boardSubView: { dataEngine: {}, getTaskColor: () => '#568ff7' }, loadTasks: async () => {},
        setActiveScope: async () => {}, syncGitHub: async () => {}, clearSelection: () => {} };
    const { loading, compactMode } = store;
    onMount(() => {
        const reportError = event => errors += String(event.message || event.reason) + '\n';
        window.addEventListener('error', reportError);
        window.addEventListener('unhandledrejection', reportError);
        const interval = setInterval(() => {
            const viewport = document.querySelector('.board-viewport');
            const canvas = document.querySelector('.kanban-board');
            const range = document.querySelector('.horizontal-scrollbar');
            const nav = document.querySelector('.board-navigation');
            metrics = viewport ? `Viewport: ${viewport.clientWidth} × ${viewport.clientHeight}; canvas: ${canvas.clientWidth}; scrollWidth: ${viewport.scrollWidth}; max: ${range.max}; left: ${Math.round(viewport.scrollLeft)}; range: ${range.value}; nav: ${nav.hidden ? 'hidden' : 'visible'}; rendered columns: ${canvas.children.length}` : 'Таблица';
        }, 100);
        return () => { clearInterval(interval); window.removeEventListener('error', reportError); window.removeEventListener('unhandledrejection', reportError); };
    });
</script>
<h1>Проверка полного ProjectsApp — 205 тестовых задач</h1>
<div class="test-controls">
    <button on:click={() => width = 700}>Ширина 700</button>
    <button on:click={() => width = 1300}>Ширина 1300</button>
    <button on:click={() => visible = !visible}>Показать / скрыть панель</button>
    <button on:click={() => { visible = false; version++; store.currentTab.set('board'); }}>Создать в скрытой панели</button>
    <button on:click={() => $loading = !$loading}>Загрузка</button>
    <button on:click={() => $compactMode = !$compactMode}>Компактность</button>
</div>
<output>{metrics}</output>
{#if errors}<pre role="alert">{errors}</pre>{/if}
<div class="workspace" style={`width:${width}px;max-width:100%;`}>
    <div class="workspace-leaf-content"><div class="view-content habit-projects-root" hidden={!visible}>
        {#key version}<ProjectsApp {plugin} {app} {view} />{/key}
    </div></div>
</div>
<style>
    .test-controls { display:flex; gap:6px; margin:10px; }
    output { display:block; margin:10px; font-size:12px; }
    .workspace { display:flex; height:600px; min-width:0; }
    .workspace-leaf-content { display:flex; flex-direction:column; flex:1; overflow:hidden; }
    .view-content { height:100%; overflow:hidden; padding:0; }
    .view-content[hidden] { display:none; }
</style>
