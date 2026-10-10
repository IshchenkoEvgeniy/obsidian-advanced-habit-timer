<script lang="ts">
    import type { Action } from 'svelte/action';
    import type { ProjectScopeDefinition } from '../../projects/types';
    import { projectStatusColor } from '../../projects/checklist-status';

    export let scope: ProjectScopeDefinition;
    export let lang: string;
    export let statuses: string[];
    export let stages: string[];
    export let habits: string[];
    export let showStage: boolean;
    export let parentLabel = '';
    export let busy = false;
    export let name = '';
    export let status = '';
    export let section = '';
    export let priority = '';
    export let startDate = '';
    export let dueDate = '';
    export let estimate = '';
    export let tags = '';
    export let habit = '';
    export let description = '';
    export let onCreate: () => void;
    export let onCancel: () => void;

    const focus: Action<HTMLInputElement> = node => { queueMicrotask(() => node.focus()); };
    const priorityLabel = (value: string): string => lang === 'ru'
        ? ({ high: 'Высокий', medium: 'Средний', low: 'Низкий' }[value] || value)
        : ({ high: 'High', medium: 'Medium', low: 'Low' }[value] || value);
</script>

<fieldset class="composer" disabled={busy} aria-label={lang === 'ru' ? 'Создание задачи' : 'Create item'} aria-busy={busy}>
    <div class="heading"><strong>{parentLabel ? (lang === 'ru' ? 'Новая подзадача' : 'New sub-issue') : (lang === 'ru' ? 'Новая задача' : 'New item')}</strong>
        {#if parentLabel}<span>{lang === 'ru' ? 'Родитель' : 'Parent'}: {parentLabel}</span>{/if}
    </div>
    <input class="title" use:focus bind:value={name} placeholder={lang === 'ru' ? 'Название задачи' : 'Item title'}
        aria-label={lang === 'ru' ? 'Название задачи' : 'Item title'}
        on:keydown={(event) => {
            if (busy || event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); onCreate(); }
            if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        }} />
    <label>{lang === 'ru' ? 'Статус' : 'Status'}<select bind:value={status}>
        {#each statuses as option}<option value={option} style={`color:${projectStatusColor(scope, option, statuses)}`}>{option}</option>{/each}
    </select></label>
    {#if showStage && stages.length}<label>{lang === 'ru' ? 'Этап' : 'Stage'}<select bind:value={section}>
        <option value="">{lang === 'ru' ? 'Без этапа' : 'No stage'}</option>
        {#each stages as option}<option value={option}>{option}</option>{/each}
    </select></label>{/if}
    <label>{lang === 'ru' ? 'Приоритет' : 'Priority'}<select bind:value={priority}>
        <option value="">{lang === 'ru' ? 'Без приоритета' : 'No priority'}</option>
        {#each ['high', 'medium', 'low'] as option}<option value={option}>{priorityLabel(option)}</option>{/each}
    </select></label>
    <label>{lang === 'ru' ? 'Начало' : 'Start'}<input type="date" bind:value={startDate} /></label>
    <label>{lang === 'ru' ? 'Срок' : 'Due'}<input type="date" bind:value={dueDate} /></label>
    <label>{lang === 'ru' ? 'Оценка' : 'Estimate'}<input bind:value={estimate} placeholder="00:00:00" /></label>
    <label>{lang === 'ru' ? 'Метки' : 'Labels'}<input bind:value={tags} placeholder={lang === 'ru' ? 'Через запятую' : 'Comma separated'} /></label>
    <label>{lang === 'ru' ? 'Привычка' : 'Habit'}<select bind:value={habit}>
        <option value="">{lang === 'ru' ? 'Без привычки' : 'No habit'}</option>
        {#each habits as option}<option value={option}>{option}</option>{/each}
    </select></label>
    <label class="description">{lang === 'ru' ? 'Описание' : 'Description'}<textarea bind:value={description}
        placeholder={lang === 'ru' ? 'Необязательно; сохранится в разделе общей заметки этапа' : 'Optional; saved in the root note section'} rows="2"></textarea></label>
    <div class="actions"><button class="mod-cta" disabled={!name.trim() || busy} on:click={onCreate}>{lang === 'ru' ? 'Создать' : 'Create'}</button>
        <button on:click={onCancel}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button></div>
</fieldset>

<style>
    .composer { box-sizing:border-box; display:grid; grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); gap:9px 12px; align-items:end; min-width:0; width:min(100%,900px); max-height:42vh; overflow:auto; margin:0; border:0; padding:12px 15px; background:var(--background-secondary); }
    .heading { grid-column:1/-1; display:flex; gap:12px; align-items:baseline; font-size:.82rem; }
    .heading span { color:var(--text-muted); font-size:.72rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    label { display:flex; flex-direction:column; gap:4px; min-width:0; color:var(--text-muted); font-size:.7rem; }
    input, select, textarea { box-sizing:border-box; width:100%; min-width:0; margin:0; color:var(--text-normal); }
    .title, .description { grid-column:1/-1; }
    .title { font-size:.86rem; }
    .description textarea { resize:vertical; }
    .actions { grid-column:1/-1; display:flex; justify-content:flex-end; gap:7px; }
</style>
