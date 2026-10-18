---
name: compare-models
description: Use when the user wants two (or three) Claude models to do the same thing side by side, for example "compare Opus and Haiku on a landing page", "race Sonnet against Haiku", "run this prompt on two models", "compare Opus 5.5 and Haiku 4.5 on the scroll race, use these pictures". Writes one prompt (or sends a prompt file word for word), opens a project per model with the same input files and a lead on each model, sends every lead exactly the same prompt, and ends with a side-by-side summary. Replaces the task-brief skill for this work.
---

# Comparing models on one prompt

The user gives instructions, or a ready prompt file, and names two models (three works the
same way). Every lead gets exactly the same prompt, word for word, at as close to the same
moment as you can manage, and starts from exactly the same files. For this work only,
these rules replace "Handing out work":

- **No task brief.** Never use the `task-brief` skill here and never save a brief. The
  prompt is the whole message each lead gets.
- **Treat every lead the same.** The same text, the same files, the same steps in the same
  order, nothing sent to one that is not sent to the other.
- **Never answer a lead's question.** The prompt says no one will. If a lead sends
  NEEDS YOU or BLOCKED, tell the user in one line and send nothing back.
- **Permission prompts** go to the user as usual (which lead, what it asks). The user
  answers them, giving every lead the same answer.

## How to start

The user types one message to you, for example:

> Compare Opus 5.5 and Haiku 4.5 on the scroll race. Use these pictures: D:\Race\images. Prompt: D:\Race\agent-brief.md

Three things can be in it:

- **The models.** Map what the user says to the `-Model` names: Opus (any version, such as
  "Opus 5.5") is `opus`, Sonnet is `sonnet`, Haiku (such as "Haiku 4.5") is `haiku`,
  Fable is `fable`. A version the user names is shown to them, never passed on: the short
  name opens Claude Code's current model of that family, and the summary table shows the
  exact model each lead ran. If the user names another model, or only one, ask.
- **The prompt.** Either instructions for you to turn into a prompt (step 1), or a prompt
  file ("prompt: <file>", "use the brief in <file>") whose text you send word for word.
- **Input files** (optional): a folder or files every model starts from, such as pictures.
  Without any, every folder starts empty.

## 1. The prompt, the files, the folders: show them first

**A prompt file.** Read it and send its text unchanged, adding nothing. If the file says
which part to send (for example "paste everything between the two lines below"), send
exactly that part, without the lines that mark it.

**Instructions.** Write one prompt a lead can act on alone, with no one to ask. Keep the
user's requirements, add nothing they did not ask for, and end it with these lines as they
are:

```
You start in a project folder of your own. Work alone: no one will answer questions, so
make your own choices and say what you chose in your report. Commit your work in this
folder as you go. When you are done, report DONE as your rules say.
```

**Input files.** List the folder (or the files) the user named. They are copied into every
comparison folder, keeping their names, to the place the prompt expects them: when the
prompt says the pictures are in `images/`, the user's folder's files go into `images/`.
When the prompt names no place, the folder goes in under its own name. If the folder does
not exist or is empty, say so.

Pick a short task name: two or three lowercase words with hyphens, such as `scroll-race`.
Comparison folders are always created in `<projects>`, one per model, named
`<task>-<model>`. Then show the user, and end your turn:

1. The prompt, in a quoted block, exactly as the leads will get it.
2. The input files: how many, their names, and where they go in each folder (for example
   "5 pictures, 01.jpg to 05.jpg, into images/"), or "no input files: empty folders".
3. The full path of each folder, such as `<projects>\scroll-race-opus` and
   `<projects>\scroll-race-haiku`, and the model each lead runs.
4. One line: say "go" to start, or tell me what to change.

If the user changes anything, the prompt, the files or the models, show all of it again.
Do nothing else until the user says "go" (or "yes", "send it").

## 2. On "go": make the projects and open the leads

1. **Make one project per model** in `<projects>`. If a folder with that name already
   exists, stop and tell the user rather than reuse it. This is the one time you create
   project folders. In Bash, for each project (`<in>` is the user's input folder and
   `<place>` where the prompt expects it, such as `images`; leave out the two input lines
   when there are no input files):

   ```
   DATA="<data in Git Bash form, such as /d/FocusShell>"; PROJECTS="<projects in Git Bash form>"
   P="$PROJECTS"/<task>-<model>
   mkdir "$P" && git -C "$P" init -q -b main
   mkdir "$P/.claude" && cp "$DATA"/manager/.claude/skills/compare-models/comparison-settings.json "$P/.claude/settings.json"
   mkdir -p "$P/<place>" && cp -r "<in>"/. "$P/<place>/"
   git -C "$P" add -A && git -C "$P" -c user.name="FocusShell" -c user.email="focusshell@localhost" commit -q -m "chore: start"
   ```

   With input files, check every copy matches before going on:
   `diff -r <first folder>/<place> <other folder>/<place> && echo IDENTICAL`. If it does not
   print `IDENTICAL`, stop and tell the user.

   The settings file is the same for every model: it lets the lead edit files and run
   ordinary local commands (git, node, npm test and run, python) in its folder without
   asking, refuses `git push`, and leaves web access and everything else to ask. Some
   models cannot use FocusShell's automatic permission mode and would otherwise stop on
   every file. Never change it for one lead.

   FocusShell lists every folder in `<projects>` as a project, so nothing else is
   needed for it to show on Home.
2. **Add the task to each board** with the deck command (never by editing the file):
   `deck add <task>-<model> '<short title>' --who lead-<task>-<model> --detail '<the user's
   words>'`, which also creates the board.
3. **Open the leads**, one after the other, each on its model:

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File <data>\open-pane.ps1 -Project <task>-<model> -Model <model>
   ```

   If either refuses, stop and pass on what it printed. Never open one without `-Model`.
4. Tell the user in one line that the panes are opening, that each may first ask whether
   to trust its new folder (they accept it in the pane), and that the prompt goes out once
   both are ready. End your turn.

## 3. Send, back to back

On your next turn (the user saying "ready" or anything else), call `ListAgents` once.
Every `lead-<task>-<model>` must be listed; if one is not, run its `open-pane.ps1` line
once more and tell the user. When all are listed:

1. Run `date`.
2. `SendMessage` to each lead in turn, with nothing in between: `TASK #1: ` followed by
   the prompt the user approved, character for character. Copy it from the block you
   showed; never retype it.
3. Run `date` again. Mark each board line `~` (`deck mark <task>-<model> 1 working`). Tell the user in one line: sent to both, the
   two times.

## 4. While they work

When a lead reports, `deck mark <task>-<model> 1 done|blocked|needs --result '<short
result>'` and `deck detail <task>-<model> 1 'Result: <report>'`, and tell the user in one line which
model reported and what it said. Do not answer it and do not send anything else.

## 5. The summary

When every lead has reported, or the user says "time" (they stopped one), run:

```
node <data>\manager\.claude\skills\compare-models\compare.mjs <projects>\<task>-<model> <projects>\<task>-<model>
```

It reads each lead's saved conversation and prints one table: model, when the prompt
arrived, when the lead last worked, minutes, its report, its input files, its commits and
its tokens, then whether every folder started from the same files, whether the prompts
were identical and the gap between them in seconds. Show the user that
table as it is, with one line on anything that went wrong (a lead that never reported, a
prompt that was not identical). Give no verdict and no scores: judging is the user's.

The comparison projects stay until the user deletes them; in the FocusShell Demo, Reset
demo removes them.
