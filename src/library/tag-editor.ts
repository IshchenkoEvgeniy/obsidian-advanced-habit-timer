import { setIcon } from 'obsidian';

export interface TagEditorOptions {
    values?: string[];
    suggestions?: string[];
    placeholder?: string;
    ariaLabel: string;
    maxItems?: number;
    onChange: (values: string[]) => void;
}

export interface TagEditorHandle {
    getValues(): string[];
    setValues(values: string[]): void;
    focus(): void;
}

export function createTagEditor(container: HTMLElement, options: TagEditorOptions): TagEditorHandle {
    const root = container.createDiv({ cls: 'ht-tag-editor' });
    const chips = root.createDiv({ cls: 'ht-tag-editor-chips' });
    const input = root.createEl('input', {
        type: 'text',
        placeholder: options.placeholder || '',
        attr: { 'aria-label': options.ariaLabel, autocomplete: 'off' }
    });
    const suggestionsEl = root.createDiv({ cls: 'ht-tag-suggestions', attr: { role: 'listbox' } });
    const suggestions = unique(options.suggestions || []);
    let values = unique(options.values || []);

    function unique(source: string[]): string[] {
        const seen = new Set<string>();
        return source.map(value => value.trim()).filter(value => {
            const key = value.toLocaleLowerCase();
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function emit(): void {
        options.onChange([...values]);
    }

    function renderChips(): void {
        chips.empty();
        values.forEach(value => {
            const chip = chips.createEl('span', { cls: 'ht-tag-chip' });
            chip.createEl('span', { text: value });
            const remove = chip.createEl('button', { attr: { type: 'button', 'aria-label': `Remove ${value}` } });
            setIcon(remove, 'x');
            remove.onclick = () => {
                values = values.filter(item => item !== value);
                renderChips();
                renderSuggestions();
                emit();
            };
        });
    }

    function addValue(raw: string): void {
        const additions = unique(raw.split(/[,;\n]/));
        if (!additions.length) return;
        if (options.maxItems === 1) {
            values = [additions[additions.length - 1] || ''].filter(Boolean);
        } else {
            values = unique([...values, ...additions]);
        }
        input.value = '';
        renderChips();
        renderSuggestions();
        emit();
    }

    function renderSuggestions(): void {
        suggestionsEl.empty();
        const query = input.value.trim().toLocaleLowerCase();
        const matches = suggestions
            .filter(value => !values.some(selected => selected.toLocaleLowerCase() === value.toLocaleLowerCase()))
            .filter(value => !query || value.toLocaleLowerCase().includes(query))
            .slice(0, 8);
        if (!matches.length || document.activeElement !== input) {
            suggestionsEl.removeClass('is-open');
            return;
        }
        matches.forEach(value => {
            const option = suggestionsEl.createEl('button', { text: value, attr: { type: 'button', role: 'option' } });
            option.onmousedown = event => event.preventDefault();
            option.onclick = () => {
                addValue(value);
                input.focus();
            };
        });
        suggestionsEl.addClass('is-open');
    }

    input.oninput = renderSuggestions;
    input.onfocus = renderSuggestions;
    input.onblur = () => {
        if (input.value.trim()) addValue(input.value);
        suggestionsEl.removeClass('is-open');
    };
    input.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault();
            addValue(input.value);
        } else if (event.key === 'Backspace' && !input.value && values.length) {
            values = values.slice(0, -1);
            renderChips();
            emit();
        }
    };

    renderChips();
    return {
        getValues: () => [...values],
        setValues(next) {
            values = unique(next);
            renderChips();
            renderSuggestions();
            emit();
        },
        focus: () => input.focus()
    };
}
