import type { DesignService } from './service';
import { queryWorld, worldFields } from './world-views';

/** Exports a snapshot of a referenced view, while the editable board continues to store only its ID. */
export function worldViewMarkdown(service: DesignService, reference: { typeId: string; viewId: string }): string {
    const type = service.settings.types.find(type => type.id === reference.typeId), view = service.world?.datasets.find(dataset => dataset.id === reference.typeId)?.views.find(view => view.id === reference.viewId);
    if (!type || !view) return `${reference.typeId} · ${reference.viewId} (${service.tr('design_not_found')})`;
    const records = queryWorld(service.index.all(), type, view, '', (record, field) => service.displayValue(record, field));
    const fields = worldFields(type), columns = view.columns.flatMap(id => { const field = fields.find(field => field.id === id); return field ? [field] : []; });
    const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    return `### ${type.name} · ${view.name}\n\n` + (columns.length ? `| ${columns.map(field => cell(field.name)).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n` + records.map(record => `| ${columns.map(field => cell(field.id === 'title' ? record.title : service.displayValue(record, field.id))).join(' | ')} |`).join('\n') : records.map(record => `- ${record.title}`).join('\n'));
}
