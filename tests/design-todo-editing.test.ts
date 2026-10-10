import { describe, expect, it } from 'vitest';
import { editTodo, insertTodo, moveTodo, parseTodo, removeTodo } from '../src/design/todo';

describe('canvas checklist edits', () => {
    const source = '- [x] Первый\n- [ ] Второй\n- [ ] Третий';
    it('keeps completion when renaming and does not erase an accidentally blank draft', () => {
        expect(parseTodo(editTodo(source, 0, 'Новое имя'))[0]).toEqual({ text: 'Новое имя', done: true });
        expect(editTodo(source, 1, '  ')).toBe(source);
    });
    it('inserts several pasted tasks at the caret without losing checkmarks', () => {
        expect(parseTodo(insertTodo(source, 1, '- [ ] A\n- [x] B')).map(line => [line.text, line.done])).toEqual([['Первый', true], ['A', false], ['B', true], ['Второй', false], ['Третий', false]]);
    });
    it('moves a task with its completion and refuses out-of-bounds movement', () => {
        expect(parseTodo(moveTodo(source, 0, 1))[1]).toEqual({ text: 'Первый', done: true });
        expect(moveTodo(source, 0, -1)).toBe(source);
        expect(moveTodo(source, 2, 1)).toBe(source);
    });
    it('removes only the requested task and can leave an empty list', () => {
        expect(parseTodo(removeTodo(source, 1)).map(line => line.text)).toEqual(['Первый', 'Третий']);
        expect(removeTodo('- [x] Последний', 0)).toBe('');
        expect(removeTodo(source, -1)).toBe(source);
    });
});
