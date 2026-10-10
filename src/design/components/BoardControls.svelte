<script lang="ts">
    import type { BoardItem, BoardEdge } from '../types';
    import type { DesignService } from '../service';
    import type { TranslationKey } from '../../i18n';
    import { edgeLabels } from '../geometry';
    export let service: DesignService;
    export let item: BoardItem | undefined;
    export let edge: BoardEdge | undefined;
    export let count = 0;
    export let action: (name: string, value?: unknown) => void;
    const tr = service.tr.bind(service);
</script>
{#if count}<div class="design-inline">
    <button on:click={() => action('stash')}>{tr('design_put_unsorted')}</button>
    <button on:click={() => action('group')}>{tr('design_group')}</button><button on:click={() => action('ungroup')}>{tr('design_ungroup')}</button><button on:click={() => action('lock')}>{tr(item?.locked ? 'design_unlock' : 'design_lock')}</button><button on:click={() => action('cut')}>{tr('design_cut')}</button>
    <button on:click={() => action('styleCopy')}>{tr('design_style_copy')}</button><button on:click={() => action('stylePaste')}>{tr('design_style_paste')}</button>
    <button on:click={() => action('step', 1)}>{tr('design_step_front')}</button><button on:click={() => action('step', -1)}>{tr('design_step_back')}</button>
</div>{/if}
{#if count > 1}<label>{tr('design_align')}<select aria-label={tr('design_align')} on:change={event => { action('align', event.currentTarget.value); event.currentTarget.value = ''; }}><option value="">—</option>{#each ['left', 'center', 'right', 'top', 'middle', 'bottom', 'horizontal', 'vertical'] as mode}<option value={mode}>{tr(('design_' + mode) as TranslationKey)}</option>{/each}</select></label>{/if}
{#if item && !item.locked}
    {#if item.kind === 'board'}<div class="design-inline"><button on:click={() => action('boardCover')}>{tr('design_board_cover')}</button><button on:click={() => action('boardIcon')}>{tr('design_board_icon')}</button></div>{/if}
    {#if item.kind === 'link'}<button on:click={() => action('refreshLink')}>{tr('design_refresh_preview')}</button>{/if}
    <label>{tr('design_rotate')}<input type="number" value={item.rotation || 0} on:change={event => action('rotation', Number(event.currentTarget.value))} /></label>
    <label>{tr('design_opacity')}<input type="range" min="0" max="1" step=".05" value={item.opacity ?? 1} on:change={event => action('opacity', Number(event.currentTarget.value))} /></label>
    {#if ['shape', 'frame', 'sticky'].includes(item.kind)}<label>{tr('design_outline_color')}<input type="color" value={item.strokeColor || '#475569'} on:change={event => action('strokeColor', event.currentTarget.value)} /></label><label>{tr('design_outline_width')}<input type="number" min="0" max="100" value={item.strokeWidth || 0} on:change={event => action('strokeWidth', Number(event.currentTarget.value))} /></label><select aria-label={tr('design_dash')} value={item.strokeDash || 'solid'} on:change={event => action('strokeDash', event.currentTarget.value)}>{#each ['solid', 'dash', 'dot'] as dash}<option value={dash}>{tr(('design_' + dash) as TranslationKey)}</option>{/each}</select>{/if}
    {#if ['shape', 'sticky', 'text', 'frame'].includes(item.kind)}<button on:click={() => action('edit')}>{tr('design_edit')}</button><label>{tr('design_font_size')}<input type="number" min="6" max="200" value={item.textStyle?.fontSize || 18} on:change={event => action('textSize', Number(event.currentTarget.value))} /></label><label>{tr('design_text_color')}<input type="color" value={item.textStyle?.color || '#172b4d'} on:change={event => action('textColor', event.currentTarget.value)} /></label><select aria-label={tr('design_align')} value={item.textStyle?.align || 'left'} on:change={event => action('textAlign', event.currentTarget.value)}>{#each ['left', 'center', 'right'] as align}<option value={align}>{tr(('design_' + align) as TranslationKey)}</option>{/each}</select>{#if ['sticky', 'text'].includes(item.kind)}<button on:click={() => action('autoSize')}>{tr(item.autoSize ? 'design_fixed_size' : 'design_auto_size')}</button>{/if}{/if}
    {#if item.kind === 'image'}<button class="mod-cta" on:click={() => action('imageEdit')}>{tr('design_image_edit')}</button><button on:click={() => action('replaceImage')}>{tr('design_replace_image')}</button><details><summary>{tr('design_crop')}</summary><fieldset>{#each ['x', 'y', 'w', 'h'] as key}<label>{key}<input type="number" min="0" max="1" step=".05" value={item.crop?.[key as 'x' | 'y' | 'w' | 'h'] ?? (key === 'w' || key === 'h' ? 1 : 0)} on:change={event => action('crop', { key, value: Number(event.currentTarget.value) })} /></label>{/each}<button on:click={() => action('resetCrop')}>{tr('design_reset_crop')}</button></fieldset></details>{/if}
{/if}
{#if edge}<label>{tr('design_line_color')}<input type="color" value={edge.color || '#475569'} on:change={event => action('edgeColor', event.currentTarget.value)} /></label><label>{tr('design_line_width')}<input type="number" min="1" max="100" value={edge.width || 2} on:change={event => action('edgeWidth', Number(event.currentTarget.value))} /></label><select aria-label={tr('design_dash')} value={edge.dash || 'solid'} on:change={event => action('edgeDash', event.currentTarget.value)}>{#each ['solid', 'dash', 'dot'] as dash}<option value={dash}>{tr(('design_' + dash) as TranslationKey)}</option>{/each}</select><button on:click={() => action('label')}>{tr('design_add_label')}</button><button on:click={() => action('bend')}>{tr('design_add_bend')}</button><button on:click={() => action('clearBends')}>{tr('design_clear_bends')}</button>{/if}
{#if edge}{#each edgeLabels(edge) as label (label.id)}<label>{tr('design_label')}<input value={label.text} on:change={event => action('labelText', { id: label.id, text: event.currentTarget.value })} /></label><button on:click={() => action('labelDelete', label.id)}>{tr('delete')}</button>{/each}{/if}
