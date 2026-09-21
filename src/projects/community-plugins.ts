import type { App, TFile } from 'obsidian';

interface AppWithCommunityPlugins extends App {
    plugins?: {
        plugins?: Record<string, unknown>;
    };
}

export interface DataviewPage {
    file?: {
        path?: unknown;
    };
}

export interface DataviewApi {
    pages(source: string): Iterable<DataviewPage>;
}

export interface TemplaterPlugin {
    templater?: {
        overwrite_file_commands(file: TFile): Promise<void>;
    };
}

export function getCommunityPlugin(app: App, id: string): unknown {
    return (app as AppWithCommunityPlugins).plugins?.plugins?.[id];
}

export function getDataviewApi(plugin: unknown): DataviewApi | null {
    if (!plugin || typeof plugin !== 'object' || !('api' in plugin)) return null;
    const api: unknown = plugin.api;
    if (!api || typeof api !== 'object' || !('pages' in api) || typeof api.pages !== 'function') return null;
    return api as DataviewApi;
}

export function getTemplaterPlugin(plugin: unknown): TemplaterPlugin | null {
    if (!plugin || typeof plugin !== 'object') return null;
    if (!('templater' in plugin) || !plugin.templater || typeof plugin.templater !== 'object') return null;
    if (!('overwrite_file_commands' in plugin.templater) || typeof plugin.templater.overwrite_file_commands !== 'function') return null;
    return plugin as TemplaterPlugin;
}
