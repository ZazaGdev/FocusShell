---
name: task-brief
description: Use every time the manager hands a task to a project lead. Turns the user's rough, often voice-dictated request into a short task brief that adds missing facts, never invented requirements, and marks every guess. Do not send a TASK message without it, except in a model comparison, which uses the compare-models skill instead.
---

# Writing a task brief

You turn the user's request into a brief for `lead-<Project>`. Your job is to add what
the lead lacks, not to polish the wording. The lead already reads its own project's
rules file, so never restate project conventions.

Paths below (`tasks/`, `briefs/`, `projects.json`) are relative to
`<data>`, one level above the manager's folder.

## Before writing

1. Read the project's `CLAUDE.md` (in the project folder from `projects.json`) and its
   top-level file listing. Look further only to confirm a path you want to name.
2. Read the project's `tasks/<Project>.md` for related open work, including the indented
   `  > ` detail lines under each task. Lines whose `<who>` ends in `, for owner` are the
   user's own checks, not lead work. A `> Sketch: sketches/<Project>/<id>.excalidraw` line is
   a drawing the user attached; name its `<id>.png` preview under Where to look. A
   `> Done: <YYYY-MM-DD HH:MM>` line is when a task was closed, and `> Tags: ...` its tags.
   Read it with `deck show <Project>`; never edit a board file (see the CTO's "Changing a
   board").
3. Use the conversation: if the user said "that bug from earlier", resolve it from what
   was said, and record how you resolved it as a guess.

## The brief

Keep it under about 25 lines. Use exactly these parts, in this order:

```
Your words: "<the user's request, verbatim, including voice errors>"

Goal: <one sentence>
Why: <only if the user said or the conversation made it plain; otherwise omit the line>
Where to look: <file paths you confirmed exist, or "none confirmed">
Out of scope: <what not to touch>; no features, refactors or clean-up beyond the goal
Done when: <a check taken from the user's words> | agent proposes one, states it, then runs it
Guesses:
- <guess> (decides what gets built: yes|no)
```

## Rules

- **Nothing invented goes in silently.** Any requirement, test case, file or behaviour
  not in the user's words or the project files goes under Guesses, or stays out.
- **"Done when" is never made up.** If the user gave no check and none follows directly
  from the goal, write "agent proposes one". A test case you thought of is a guess.
- **Fix likely voice errors, and list each fix as a guess.** For example: "Read 'a sink'
  as 'async'" (decides: no, unless the reading changes what gets built). Code words,
  spoken operators ("equal equal"), and "is", "not", "in" are the usual casualties.
- **Mark a guess "decides: yes"** when a different answer would change what gets built:
  which feature, which behaviour, which data, anything hard to undo. Wording and
  obvious readings are "no". When unsure, mark "yes": a question costs less than a
  wrong build.
- **No examples section.** Point to an existing file that shows the pattern instead.
- **Small, clear requests pass through almost unchanged.** They still get "Your words",
  "Goal" and "Done when".
- **One project per brief.** If the request spans projects, write one brief each.

## After writing

1. Save the brief as `briefs/<Project>/<n>.md` (create the folder), where `<n>` is the
   task number. First line `# <Project> #<n>`, then the brief.
2. Send it: `TASK #<n>:` followed by the brief.
3. Tell the user in one line what was sent, and list any "decides: yes" guesses.
