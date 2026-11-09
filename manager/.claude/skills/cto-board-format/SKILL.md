---
name: cto-board-format
description: Use when the CTO reads a task file or writes a board item and needs the task line format - marks, task numbers, the (date, who, for owner) part, the result after ->, detail lines (> ...), Done, Tags, Sketch and Screenshot lines, and for-owner tasks.
---

# The task line format

Part of the CTO's rules (`manager/CLAUDE.md`), kept here so the core stays short. `<data>`,
`<projects>` and every path mean the same as there. Boards change only through `deck`; this
format is for reading them.

Task line format, one task per line:

```
- [<mark>] #<n> <task> (<YYYY-MM-DD>, <who>[, for owner]) -> <result>
```

Marks: ` ` open, `~` in progress, `?` needs the user, `!` blocked, `x` done.
`<n>` comes from one counter shared by every task board, Me included, from 1000 up (`deck add`
picks it): a number from 1000 names one item, so `deck mark 1041 done` needs no board; a number
below 1000 is an old per-board one, always written with its project ("FocusShell #41"). `<who>` is the session working
on it, or `user` for a note. The ` -> <result>` part appears once there is a result.

`<task>` is a **short title**, about eight words, that names the work; `<result>` is a short
result of one clause. Everything else (the user's full request, context, the long result,
a NEEDS YOU question with its options) goes on **detail lines** right under the task, each
indented two spaces and starting with `> `:

```
- [x] #4 Faster export without quality loss (2026-10-02, lead-video-app) -> 12-16% faster
  > Make export/render faster without losing any quality, if possible
  > Result: 12-16% faster by decoding on the graphics card; output byte-identical; commit cc710cc
  > Done: 2026-10-03 14:20
```

The date on the task line is when it was added; a `  > Done: <YYYY-MM-DD HH:MM>` line is
when it was closed, written by `deck mark ... done` and removed when it is reopened.
FocusShell shows both dates on the card as a small history. A `  > Waiting: <YYYY-MM-DD HH:MM>`
line is when an item was marked needs you, written by `deck mark ... needs` and removed when
its mark moves on; Waiting on you shows that time beside the card's number.
A `  > Tags: Research, ...` line (comma separated) tags an item; tags show as badges and
boards filter by them. The user keeps the list of tags in FocusShell's Settings; keep a
Tags line when you edit the task.

FocusShell shows the title on the board and the details when the item is opened. Keep
detail lines directly under their task; add new ones below the existing ones.
A `> Sketch: sketches/<Project>/<id>.excalidraw` line is a drawing the user attached in
FocusShell (a PNG preview sits beside it as `<id>.png`); keep it when you edit the task.
A `> Screenshot: <full path to a .png>` line is a screenshot from the user's screen recording;
look at it with the Read tool when the task needs it, and keep it when you edit the task.

`, for owner` after `<who>` marks a task the user has to do themselves: test, check,
confirm or act on something. Home shows these in a highlighted strip on the project's
card with a Done button. Example:
`- [ ] #17 Check the taskbar logo after reopening (2026-10-02, lead-FocusShell, for owner) -> after #12`.
Never send a `for owner` task to a lead.
