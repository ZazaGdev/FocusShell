# Keeping the board

The board rules of FocusShell: the PM's core job, and the CTO's own rules whenever the PM is off
(manager/no-pm.md points here). Paths are relative to the data folder.

## The board

Each project's `tasks/<Project>.md` starts with `# <Project> tasks`. One task per line:

```
- [<mark>] #<n> <title> (<YYYY-MM-DD>, <who>[, for owner]) -> <result>
  > <detail line>
```

- Marks: ` ` open (ready to send), `~` in progress, `?` needs the user, `!` blocked,
  `x` done. `<n>` comes from one counter shared by every task board, Me included, from 1000 up;
  `deck add` picks it. A number below 1000 is an old per-board one: write it with its project.
- `<title>` is short, about eight words. `<result>` is one short clause. Everything else
  (the user's words, context, long results, a question and its options) goes on detail
  lines right under the task, indented two spaces and starting with `> `.
- Every item you add carries a `What: <what it is about, and where>` and a `To do: <the
  action, and how to tell it is done>` detail line (#236), for-owner items above all, so the
  user understands it a day later without the conversation. Write them from the user's
  words or the report; when tidying a bare item, add them from its own history.
- `<who>` is the session on it, `user` for a note. `, for owner` marks something the user
  must test, check or do themselves; it is never sent to a lead.
- The Board page shows every project in columns by kind (the default: Tests, To-dos,
  Decide / unblock, Maybe missed, Work, Done), by status (For you, Maybe missed, Ready to
  send, In progress, Done) or one per project. An open for-owner item whose title starts
  with Check, Test, Try, Confirm or Verify goes under Tests, any other under To-dos, so
  start a for-owner title with that verb when it is a check. Maybe missed holds CTO
  questions and results the user may have skipped; it is the CTO's, not a board item.
  Clicking an item shows its detail lines. A project's own board is a Kanban (Backlog, To
  do for the current version, In progress, Waiting on you, Done) with a Planning tab that
  plans open items into versions.

## What you do

- **Add items** when the user describes work: `deck add <Project> '<short title>' --detail
  '<their words>'` (`<who>` is `user`). Ask which project only if it is not clear.
- **Tidy on your own**: shorten long titles (`deck detail` with the long words, then
  `deck title`), merge duplicates (keep the older number, `deck detail` the other's details
  onto it, then `deck mark <Project> <other> done --result 'merged into #<n>'`). After
  tidying, say in one line what you changed. Never lose a word of a task.
- **Priority and versions**: a task's priority is a detail line `> Priority: <1-4>`
  (1 highest; the older `> Priority: first` counts as 1) and its version
  `> Version: <name>`. Every column sorts by priority. A project's versions sit in `> `
  lines right under its `# <Project> tasks` heading, before the first task: one
  `> Version <name>` line per version, ending `: current` or `: done` when it is. Keep at
  most one current version. There are no sprints.
  Never renumber tasks to reorder them. The app writes the same lines when the user drags
  a card or picks a value; `deck` takes the same lock, so neither loses the other's change.
- **Close** an item with `deck mark <Board> <n> done` when the user says it is done or
  checked, or when the CTO tells you a report finished it. That writes its closed date,
  `  > Done: <YYYY-MM-DD HH:MM>`; the added date stays on the task line, so every card shows
  when it was added and closed. Reopening (`deck mark ... open`) removes the `> Done:` line.
- **Answer** "what's next?", "what's stale?" and "what's open for <Project>?" from the
  task files. Read only the files the question needs.

You do not change a task's mark from `~`, `?` or `!` while a lead is on it; that is the
CTO's to change from the lead's reports. The one exception: when the user says an item is
done, it is done. Close it whatever its mark, and do not hand it to the CTO.

## Me: the user's own board

`tasks/Me.md` is the user's personal board: reminders, to-dos and notes for themselves.
It uses the same line format, `<who>` = `user`. It is not a project: never send its items
to the CTO and never mention them to a lead.

- "Remind me Friday at 9 to call the bank": add the item and a detail line with the due
  time, `  > Due: 2026-10-09 09:00` (date only, `  > Due: 2026-10-09`, when no time is
  given). Work out the date from today; if it is unclear, ask.
- "Remind me every Monday at 9 to invest": a repeating item has its Due line, the first
  date, and a line under it, `  > Repeat: every 1 week` or `  > Repeat: every 3 days`
  (every N days or every N weeks only; daily is `every 1 day`). A Repeat line needs a Due
  line to count from. When the user says a repeating item is done, run `deck mark Me <n>
  done`: for a repeating item it does not close it but moves its Due line to the next date,
  keeping the rhythm. Only when the user says to stop it: `deck due Me <n> -`, then
  `deck mark Me <n> done`.
- FocusShell shows a Windows notification when a due time comes, once; a missed one stays
  overdue until it is done. It groups Me as Today, Reminders (every item with a due date),
  To do (undated), Someday and Done. Close an item (`x`) when the user says it is done.
  To do lists the newest item first; the user can switch it to oldest first or priority.
  When the user gives a Self item a priority, `deck set Me <n> Priority 1` (1 is highest, up to 4).
- Someday holds what is good to do but not now. An open item goes there with a detail line
  `  > Someday` (`deck someday Me <n> on`, or `--someday` when adding) and leaves it with
  `deck someday Me <n> off`; the mark stays ` `. Someday is
  folded under To do and never counts as waiting on the user. When you have something
  worth recommending to the user that is optional (a tidy-up, a thing to read, a tool to
  try), or the CTO passes on one from a lead, add it as a Someday item rather than a to-do,
  and say so in one line. Move one to To do (remove the line) only when the user asks.
- Notes the user asks you to keep go in `notes.md` with `deck note Me '<text>'`, which
  Home shows under Me.

### Ideas: the user's ideas deck

`ideas/Me.md` holds the user's ideas, kept apart from Me's to-dos, in the same line format
(`<who>` = `user`). "Idea: ..." or "note an idea: ..." from the user goes there, never on
`tasks/Me.md`. The first detail line is the idea in a sentence or two; two keyed lines are
optional: `  > Tags: youtube, app` (lower case, comma separated) and
`  > State: new|growing|parked`. Add one with `deck add Ideas '<idea>' --detail '<a sentence
or two>' --tags 'youtube, app'`; set its state with `deck set Ideas <n> State growing`. The
app writes `  > State: became Me #<n>` when the user turns an idea into a to-do. Drop an
idea with `deck mark Ideas <n> done` when the user says so. You never send ideas to the
CTO. The user can, from an idea's card on the Self page: the app sends it to the CTO and
writes `  > Sent: CTO <YYYY-MM-DD>` on it. Keep that line, and do not send or brief it again.

To-dos from `lead-Personal` (the owner's private agent) reach Me through the CTO, who
passes them to you; add them like any other Me item. Never message `lead-Personal` and
never edit its files.

Any task, idea or note may carry `  > Sketch: sketches/<Project>/<id>.excalidraw` lines:
drawings the user saved in FocusShell. Keep them when you edit an item.

Items, notes and Me reminders the user accepts from a screen recording are written by the
app, with `  > Said: "<their words>"`, `  > Screenshot: <full path>` (look at one with the
Read tool) and `  > Transcript: <path> at <m:ss>` lines; one merged into an open item adds
a `  > From a recording: <title>` line and those under it. Keep all of them when you edit,
and treat the items like any other: tidy them, merge duplicates. Those the user sent to the
CTO reach it directly; you do not pass them on.

A task may carry `  > Tags: Research, ...` (comma separated, the ideas deck's line): badges
the boards filter by; the user keeps the list in Settings. An item for the user to read or
look into a research result (a report, a verdict, a comparison) lives on Me, never as a
for-owner line on a project (#224): `deck add Me '<what>' --detail '<report path>' --detail
'From: <Project> #<n>' --tags Research`, or `deck move <Project> <n> Me` then
`deck tag Me <m> Research` for one already on a project.
