---
name: cto-routines
description: Use when the user asks the CTO "status?" (or /team-status), "pick up the work" (or /pick-up), "safe to restart?", "wrap up the day" (or /wrap-up, "finish the day", "end of day"), or when a "STATUS REFRESH:" or "CATCH UP <Project>:" line arrives in the CTO's prompt.
---

# Status, catch up, pick up, safe to restart, wrap up

Part of the CTO's rules (`manager/CLAUDE.md`), kept here so the core stays short. `<data>`,
`<projects>` and every path mean the same as there. A group CTO covers only the projects in
its group.

## Status

When the user asks "status?" (or types `/team-status`), call `ListAgents`, then send each live lead of a project in no group
`STATUS?` with `notify_when_idle: true`. A project with a `~` task whose lead is not
listed: run `ListAgents` again, and look for a row whose name starts with `lead-<Project>`
and its busy or idle state. Only when no such row exists, `deck mark <Project> <n> blocked
--result 'lead silent'` and offer to reopen the pane. Never tell the user a lead needs a
restart from a missing reply alone (a row marked "shell" can still be a live lead).

### Status refresh

FocusShell types `STATUS REFRESH: lead-A, lead-B` into your pane on the interval the user picked
in Settings (30 minutes unless changed) while a lead is busy or has started or finished work
since the last one, even while you are busy: then it waits in your queue, and you handle it at
your next pause. It feeds the Status button above
your pane. For each lead named, write one short line of where it stopped:
`deck status lead-<Project> '<where it stopped>'` (such as `DONE #383, idle` or `on #384,
waiting on ANSWER`). Take it from that lead's last report or reply to you. Only when you have
nothing from a lead since its last line, and `ListAgents` shows it idle, send it `STATUS?` and
write its reply when it comes. Never message a busy lead for this: the view shows it busy by
itself. Do not reply to the user about a refresh, and do not change any board for it.

### Catch up

`CATCH UP <Project>: <file or one-line recap>` comes after the user pressed Open and catch up
on a group: one line per project, with a recap file of where it stands and where work stopped
yesterday (or the lead's own one-line recap). Once the lines for that group have arrived, tell
the user each project's recap in two or three lines, with the file's full path. Change no board
and send nothing to the leads for it.

## Pick up the work, safe to restart

Two things the user says at the start of most sessions. Do them without asking which
projects; the user should not have to say either twice.

**"Pick up the work"** (or `/pick-up`; also "pick up the work on all projects", "from previous sessions",
"on interrupted sessions"): for every project you own, read its task file and hand out
its open (` `) tasks as in "Handing out work". Skip `for owner` tasks, and tasks whose
detail lines say the user parked them or wants to brainstorm first. Call `ListAgents`;
for each `~` task whose lead is not listed, offer to reopen the pane and resend it. Then
tell the user one line per project: what went out, and what is waiting on them.

**"Safe to restart?"** (also "is every ongoing task done so I can restart?"): call
`ListAgents` and read the `~` tasks of every project you own. Answer one line per project:
busy (which task) or idle. If any lead is busy, use `notify_when_idle: true` and tell the
user the moment the last busy lead finishes. A lead in the middle of a long test run can
be asked to stop and run it after the restart, if the user would rather not wait.

## Wrap up the day

"Wrap up the day" (or `/wrap-up`; also "finish the day", "end of day") means: make every
board you own match what each lead actually did today, so tomorrow's "pick up the work"
starts from the truth. Work that is not finished stays open; nothing is forced closed. Do it
without asking which projects.

1. Call `ListAgents`. Send each live lead of a project you own (not `lead-Personal`) this
   message, with `notify_when_idle: true`:

   ```
   WRAP UP: the owner is ending the day. For every task you worked on today and have not
   reported, send its report now, one line each: DONE as usual for finished work, and for
   work that is not finished
   HALF #<n> | stopped at: <where it stands now> | next: <the next step>
   Work with no task number uses `new` and a short title, as in `HALF new | <title> | ...`.
   Stop at a safe point first if you are mid-change, and commit only what works. If nothing
   is unreported, reply `idle`.
   ```

   A busy lead answers when its turn ends; wait for each one before step 4.
2. Record each answer:
   - DONE, NEEDS YOU, BLOCKED (with a number or `new`): as in "Reports from leads".
   - `HALF #<n>`: `deck detail <Project> <n> 'Stopped at <YYYY-MM-DD>: <where>. Next: <step>'`.
     Leave the task `~`, keep its `<who>`.
   - `HALF new`: `deck add <Project> '<title>' --who lead-<Project> --detail 'Stopped at
     <YYYY-MM-DD>: <where>. Next: <step>'`, then `deck mark <Project> <n> working`.
   - Tell `pm` one line per task changed, as after any report.
3. For each `~` task whose lead is not listed, check `ListAgents` again as in "Status". If it
   is truly gone, do not guess: ask the user, in full, whether that task is done, should stay
   in progress, or should go back to open. An answer from a lead that does not say where it
   stopped or what is next gets one follow-up to that lead, then goes to the user the same way.
4. Only `cto` (a group CTO skips this): run `deck worktrees --clean`. It removes the git
   worktrees that are clean, merged and idle a day, from every project, and lists the rest. If
   it answers that removing is switched off, run `deck worktrees` instead.
5. Finish with one line per project you own: what was done today, what stays in progress
   with its next step, and what waits on the user, then every open question in full. From
   step 4 add one line with its first line (how many removed, the space freed, what is
   left), then one line each, for the user to check, per kept worktree with uncommitted work,
   commits on no remote or "check it yourself" (its folder and reason) and per other folder
   over 100 MB.

Leave every pane open; close a lead only when the user asks (see "Closing a pane" in the
`cto-panes` skill).
The `Stopped at` line is where tomorrow's work carries on: include it when you resend a
`~` task, as "Pick up the work" offers for a lead that is gone.
