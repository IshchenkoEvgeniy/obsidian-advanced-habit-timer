<script lang="ts">
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { TFile } from 'obsidian';
    import ProjectsApp from '../../src/components/projects/ProjectsApp.svelte';
    import { createProjectsStore } from '../../src/store/ProjectsStore';
    import { DesignService } from '../../src/design/service';
    import { defaultDesignSettings } from '../../src/design/schema';
    import { splitNote } from '../../src/design/markdown';
    let ready = false, syncs = 0;
    const scope = { id: 'game', name: 'Game', sourceType: 'file', sourceValue: 'Project.md', statuses: 'Todo, Doing, Done' };
    const file = new TFile('Project.md');
    const tasks = [{ id: 'stage-task', file, name: 'Implement trader', section: 'Stage 1', status: 'Doing', timeSpentSec: 0 }];
    const store = createProjectsStore();
    store.snapshot.set({ activeScopeId: scope.id, tasks, archivedTasks: [], stages: [{ id: 'stage1', title: 'Stage 1', sourceLine: 0 }], columns: ['Todo', 'Doing', 'Done'], scopesWithStats: [{ ...scope, total: 1, done: 0, pct: 0 }] });
    const files = new Map<string, { file: TFile; raw: string }>(), folders = new Set<string>();
    const vault = { on() {}, getFiles: () => [...files.values()].map(entry => entry.file), getAbstractFileByPath: (path: string) => files.get(path)?.file || (folders.has(path) ? { path } : null), getFileByPath: () => null,
        read: async (file: TFile) => files.get(file.path)!.raw, createFolder: async (path: string) => { folders.add(path); },
        create: async (path: string, raw: string) => { const file = new TFile(path); files.set(path, { file, raw }); return file; },
        process: async (file: TFile, change: (raw: string) => string) => { const entry = files.get(file.path)!; entry.raw = change(entry.raw); return entry.raw; },
        rename: async (file: TFile, path: string) => { const entry = files.get(file.path)!; files.delete(file.path); file.path = path; files.set(path, entry); }, getResourcePath: () => '' };
    const app = { vault, metadataCache: { on() {}, getFileCache: (file: TFile) => ({ frontmatter: splitNote(files.get(file.path)?.raw || '').frontmatter }), getFirstLinkpathDest: () => null }, fileManager: { renameFile: vault.rename }, workspace: { openLinkText: async () => {}, getLeaf: () => ({ openFile: async () => {} }) } };
    const design = defaultDesignSettings('ru'); design.root = 'World'; design.projectId = scope.id;
    const plugin: any = { app, settings: { language: 'ru', properties: [], projectScopes: [scope], design }, registerEvent() {}, saveSettings: async () => {}, formatTime: () => '00:00:00', projectEngine: { loadTasks: async () => tasks } };
    const service = new DesignService(plugin); plugin.design = service;
    const view: any = { store, dataEngine: {}, boardSubView: { dataEngine: {}, getTaskColor: () => '#568ff7' }, loadTasks: async () => {}, setActiveScope: async () => {}, syncGitHub: async () => { syncs++; }, clearSelection: () => {} };
    onMount(() => { (window as any).worldProjectsFixture = { plugin, service, view, get syncs() { return syncs; }, get snapshot() { return get(store.snapshot); } }; void service.initialize().then(async () => { await service.createEntity('character', 'Trader', { role: 'Merchant', task: 'stage-task' }); ready = true; }); });
</script>
{#if ready}<ProjectsApp {plugin} {app} {view} />{:else}Loading…{/if}
<style>:global(#root){height:100vh;width:100%;}</style>
