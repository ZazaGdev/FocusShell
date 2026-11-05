---
name: cto-panes
description: Use when the CTO opens a project's pane or lead ("open my-app", on a named model), opens or closes an extra lead on one project (a second up to a fifth), closes a pane, a lead does not connect, or the user says "add <folder> to FocusShell".
---

# Opening and closing panes, extra leads, adding a project

Part of the CTO's rules (`manager/CLAUDE.md`), kept here so the core stays short. `<data>`,
`<projects>` and every path mean the same as there.

## Opening a pane

When the user asks to open a project ("open my-app", "start a session in notes-app"), run:

```
node '<data>\deck.mjs' open-pane <name>
```

It waits for the app (a few seconds, up to about a minute) and prints
`Started lead-<name>.` or `Failed: <why>`; it already asks the app a second time if the
first request got no answer. Pass a refusal or failure to the user (unknown project, not
trusted yet, the app did not answer). Do not add your own sleep or wait in the shell (a
foreground sleep is blocked). A new lead says nothing until it gets a message. Within about
a minute, on your next turn or when you send it a task, call `ListAgents` to confirm
`lead-<name>` is listed. If it is not, run it once more; if it is still not listed
after that, tell the user plainly that the pane did not start.

A lead whose pane is open but is not listed, or a send to it that fails, has not connected:
it may be stuck on a question in its pane, or have failed to start. Tell the user in one line
to look at that lead's pane and, if no question is waiting there, to press Reopen (on the
notice FocusShell shows for it) or Restart on its pane, then check `ListAgents` again.

**On a named model.** Only when the user names a model for that lead ("open Habitly on
Haiku", "run the second one on Sonnet"), add `--model <fable|opus|sonnet|haiku>` (it works
with `--lead` too). It then prints `Started lead-<name> on haiku.` That pane keeps
the model through a Restart; nothing is saved for the project, and the next open without
`--model` uses the default. Never add `--model` on your own. If the lead is already open, it
prints `Already open: lead-<name> runs on <model>.` and changes nothing. When that
is not the model the user named, tell the user and ask before closing it (`close-pane`)
and opening it again with `--model`; a busy lead would lose its work.

## Extra leads on one project (up to five)

A project can run up to five leads at once: `lead-<Project>` and the extra leads
`lead-<Project>-2` to `lead-<Project>-5`, each on its own task. Each extra lead shows as its
own numbered tab (2 to 5) inside the project's pane. Open one when the user asks, or when
the spreading rules below call for it. Take the lowest number not already open
(`ListAgents` shows which are). Pick how each one works per task:

- **Same folder** when the tasks are small and truly do not touch the same files:
  ```
  node '<data>\deck.mjs' open-pane <name> --lead <n>
  ```
- **Own worktree** when the tasks overlap but should still run together. Lead n works in a
  git worktree on branch `lead-<n>`, then merges into main and pushes itself:
  ```
  node '<data>\deck.mjs' open-pane <name> --lead <n> --worktree
  ```

`--lead` takes 2 to 5. `open-pane` refuses a sixth lead
with a plain message; pass it to the user and offer to close one first. Tell the user which
way you picked and why, in one line. Send tasks to `lead-<Project>-<n>` by that name; its
lines go in the same `tasks/<Project>.md` with `<who>` = `lead-<Project>-<n>`. When it
reports DONE and has nothing else to do, close it, which also removes its worktree and
branch once the work is merged (it says if it kept them):

```
node '<data>\deck.mjs' close-pane <name> --lead <n>
```

A new worktree lead can take a few minutes to show in `ListAgents` (it may be waiting on a
trust question in its tab). If it is still missing after the second open, tell the user to
answer the question in that tab or press Restart; do not send its task until it is listed.

### Spreading work across leads

The owner wants work spread out, not queued (2026-10-23). Whenever a project has more than
one task to hand out, or a lead reports DONE:

1. **Give each lead a lane**: an area of the project with its own files (for a game:
   economy numbers, shop screen, build mode and room art, movement). Tasks in the same lane
   go to the same lead, in order; tasks in different lanes go to different leads.
2. **One task running and at most one waiting per lead.** If a lead would have two or more
   waiting while another lead of the project is idle or a lane has no lead, hand the extra
   tasks out instead. With three or more tasks waiting in separate lanes and fewer than
   five leads open, open another lead (same folder or worktree, as above) and say so in
   one line.
3. **Keep-out line in every brief**: name the other leads and their lanes, and the files
   this lead must not touch.
4. **Dependencies**: a task that builds on another lead's unfinished work waits behind it
   on that lead, or its brief says which commit to build on and to merge main first.
5. **Worktree leads merge main first** when their branch was cut before newer commits, and
   merge back into main after each task.
6. **Rebalance on every DONE**: if a lead goes idle while another still has waiting tasks,
   move one over (`deck mark <Project> <n> working --who lead-<Project>-<m>`), tell the old
   lead to drop it, and send the new lead the task with its `Stopped at` line.
7. **Close an extra lead** that is idle with nothing left in its lane; keep `lead-<Project>`.
8. Every lead shares one subscription allowance: past about six busy leads in total, say so
   once.

Closing `lead-<Project>` (no `--lead`) while extra leads run keeps the tab for them.

## Closing a pane

When the user asks to close a project ("close my-app", "end the notes-app session"), run:

```
node '<data>\deck.mjs' close-pane <name>
```

The app closes the tab and ends `lead-<name>`, and `close-pane` prints what happened. It
refuses a lead that is busy or has a task in progress and says why; tell the user and
ask. Only when the user says to close it anyway, run it again with `--force`. Never close
the CTO or the PM this way.

## Adding a project outside the projects folder

When the user says "add <folder> to FocusShell", append an entry to the `projects` list in
`projects.json`, named after the folder:

```
{ "name": "<folder name>", "path": "<full folder path>", "test": "" }
```

Keep every other entry and field as it is. The running app picks the entry up without a
restart, so it shows on Home and `deck open-pane <folder name>` opens it as
`lead-<folder name>`. If a project with that name already exists, ask the user for
another name. The user can also add one or several from the app's "+" menu ("Add project folders...").
