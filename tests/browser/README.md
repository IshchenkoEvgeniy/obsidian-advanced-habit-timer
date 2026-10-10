# World tables regression fixtures

Run `node tests/browser/design-board.mjs`, then `node tests/browser/design-world-verify.mjs` for the world table/kanban and board-widget regressions.

Run `node tests/browser/world-projects.mjs` at port 4181, then `node tests/browser/world-projects-verify.mjs` for the actual ProjectsApp source separation and GitHub isolation checks. These use in-memory data and never access a real vault or GitHub.

Set `DESIGN_PLAYWRIGHT_DIR` to the installed Playwright package directory when it is outside this project. Restart fixtures after source/CSS edits. Stop them with Ctrl+C.

# Projects scrollbar regression fixture

Run from the plugin directory:

```powershell
node tests/browser/project-scrollbar.mjs
```

Open `http://127.0.0.1:4179`. This loads the actual `ProjectsApp`, board and table inside a constrained pane with 205 in-memory tasks. It does not access a vault or external services. The task editor is stubbed.

Check the initial board, table → board, resizing, hiding/showing the pane, loading, compact mode and collapsed columns. The top navigation must remain visible; `max`, `left` and `range` must agree with the measured board. When columns fit, navigation remains visible with disabled controls. Stop the fixture with Ctrl+C.

The browser output is served from memory; no bundle is written to the repository.

## World design board

Run `node tests/browser/design-board.mjs` and leave it running at `http://127.0.0.1:4180`. The board and hub use in-memory files. Restart the server after changing source or CSS, because its bundle is built at startup.

Run the regressions with Playwright and installed Chrome: `design-verify.mjs`, `design-audit-verify.mjs`, `design-parity-verify.mjs`, `design-milanote-verify.mjs` and `design-mobile-verify.mjs` in this directory. Set `DESIGN_PLAYWRIGHT_DIR` if Playwright is outside the project. Results go to the ignored `design-results` directory.

The mobile regression checks a clipped Obsidian-style leaf, oversized theme buttons, full-screen entry/exit and teardown, independent drawers, touch pan/selection/pen, a simulated visual viewport keyboard, a narrow desktop leaf, 320px portrait and landscape. The simulated keyboard is not a physical Android test.

Visual redesign checks: `node tests/browser/design-visual-verify.mjs` verifies cell navigation, blur saves, collapsed groups, numeric totals, canvas table clipboard paste and mobile screenshots.

Palette drag checks: `node tests/browser/design-palette-drag-verify.mjs` uses trusted mouse input to drag tools from the sidebar, including pan/zoom coordinates, a host stopping document events, a view adopted into another document, deferred world table/board pickers, canceled gestures, keyboard activation and read-only mode. Trusted mobile input checks note dragging, one-tap creation and native tool drawer scrolling.

Inline canvas interaction checks: `node tests/browser/design-widget-verify.mjs` verifies actual mouse/touch editing of todo rows, task ordering and undo, typed world table cells, source Markdown saves, Kanban grip dragging, creating/opening records over the canvas, shared updates and conflicts, cell clipboard handling, keyboard navigation, low-zoom draft retention, locked/read-only guards and nested mobile scrolling. It uses the same in-memory server at port 4180.
