import type { CanvasData, CanvasNode, CanvasEdge } from './canvas-types';

export type UndoOperation =
    | { type: 'move';    nodeId: string; before: { x: number; y: number }; after: { x: number; y: number } }
    | { type: 'add';     node: CanvasNode }
    | { type: 'remove';  node: CanvasNode; edges: CanvasEdge[] }
    | { type: 'edge_add';    edge: CanvasEdge }
    | { type: 'edge_remove'; edge: CanvasEdge }
    | { type: 'content'; nodeId: string; before: string; after: string }
    | { type: 'batch';   ops: UndoOperation[] };

const MAX_STACK = 50;

export class UndoStack {
    private undoStack: UndoOperation[] = [];
    private redoStack: UndoOperation[] = [];

    /** Record an operation. Clears the redo stack. */
    push(op: UndoOperation): void {
        this.undoStack.push(op);
        if (this.undoStack.length > MAX_STACK) this.undoStack.shift();
        this.redoStack = [];
    }

    get canUndo(): boolean { return this.undoStack.length > 0; }
    get canRedo(): boolean { return this.redoStack.length > 0; }

    /** Apply undo — mutates data in place, returns the inverse op. */
    undo(data: CanvasData): UndoOperation | null {
        const op = this.undoStack.pop();
        if (!op) return null;
        const inverse = this._apply(data, op, true);
        this.redoStack.push(inverse);
        return inverse;
    }

    redo(data: CanvasData): UndoOperation | null {
        const op = this.redoStack.pop();
        if (!op) return null;
        const inverse = this._apply(data, op, false);
        this.undoStack.push(inverse);
        return inverse;
    }

    private _apply(data: CanvasData, op: UndoOperation, _isUndo: boolean): UndoOperation {
        switch (op.type) {
            case 'move': {
                const node = data.nodes.find(n => n.id === op.nodeId);
                if (node) { node.x = op.before.x; node.y = op.before.y; }
                return { type: 'move', nodeId: op.nodeId, before: op.after, after: op.before };
            }
            case 'add': {
                data.nodes = data.nodes.filter(n => n.id !== op.node.id);
                data.edges = data.edges.filter(e => e.fromNode !== op.node.id && e.toNode !== op.node.id);
                return { type: 'remove', node: op.node, edges: [] };
            }
            case 'remove': {
                data.nodes.push(op.node);
                op.edges.forEach(e => data.edges.push(e));
                return { type: 'add', node: op.node };
            }
            case 'edge_add': {
                data.edges = data.edges.filter(e => e.id !== op.edge.id);
                return { type: 'edge_remove', edge: op.edge };
            }
            case 'edge_remove': {
                data.edges.push(op.edge);
                return { type: 'edge_add', edge: op.edge };
            }
            case 'content': {
                const node = data.nodes.find(n => n.id === op.nodeId);
                if (node) node.content = op.before;
                return { type: 'content', nodeId: op.nodeId, before: op.after, after: op.before };
            }
            case 'batch': {
                // Apply in reverse order for undo
                const inverses: UndoOperation[] = [];
                for (let i = op.ops.length - 1; i >= 0; i--) {
                    inverses.push(this._apply(data, op.ops[i]!, _isUndo));
                }
                return { type: 'batch', ops: inverses };
            }
        }
    }
}
