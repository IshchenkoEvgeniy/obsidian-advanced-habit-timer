# Dashboard API V1

Advanced Habit Timer exposes a local, serializable API for companion Obsidian plugins such as MOC Hub. The contract is defined in `src/integration/dashboard-api-contract.ts`.

## Discovery

The provider and consumer communicate only through Obsidian workspace events:

- request: `advanced-habit-timer:api-request`;
- ready: `advanced-habit-timer:api-ready`;
- unavailable: `advanced-habit-timer:api-unavailable`.

A consumer sends a receiver callback with the request event. This also supports plugin load order where Habit Timer was enabled before the consumer.

```ts
workspace.trigger("advanced-habit-timer:api-request", (api) => {
  if (api.apiVersion !== 1) return;
  // Store only while the provider is available.
});
```

## Capabilities

Consumers must check both the major `apiVersion` and the required capability before showing an action. V1 currently publishes:

- `timer.read`, `timer.control`;
- `habits.read`, `habits.update`;
- `projects.read`, `projects.update`;
- `library.read`;
- `stats.read`.

Library writes are intentionally not advertised. The reserved `media.addProgress` command returns `UNSUPPORTED` until a shared media-session service is available.

## Snapshots

`getSnapshot(query)` returns an allowlisted DTO and never returns the plugin settings object. Queries can select domains and filters:

```ts
const result = await api.getSnapshot({
  domains: ["habits", "projects", "stats"],
  date: "2026-08-01",
  includeHabitStreaks: true,
  habitHistoryDays: 42,
  projectScopeIds: ["work"],
  includeCompletedTasks: false,
  taskLimit: 50,
  statsRangeDays: 30,
});
```

Domains are `timer`, `habits`, `projects`, `library`, `stats` and `settings`. History and statistics ranges are bounded to 366 days.

## Changes and commands

`subscribe(listener)` emits debounced, monotonically increasing revisions with the domains that changed. Consumers should reload only their current view and ignore older revisions.

`execute(command)` supports timer lifecycle, habit quick actions, project status/subtask updates, opening tasks/media and starting a linked media timer. Every result is either:

```ts
{ ok: true, data, revision }
```

or a structured error with `NOT_READY`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`, `UNSUPPORTED` or `INTERNAL`.

Finishing a timer is a two-step flow: `timer.prepareFinish` returns the fields needed by the UI, then `timer.finish` receives the validated note/progress input.

## Compatibility and safety

- Additive optional fields remain compatible inside V1.
- Breaking field or command changes require a new major API version.
- API values are plain objects and arrays without Obsidian, Svelte or service instances.
- Tokens, bot settings and other secrets are not included in snapshots.
- The consumer must discard its API reference after the unavailable event.

