---
name: cto-permissions
description: Use when a lead reports that a permission check refused an action it needs (a NEEDS YOU ending "| words: ..."), when a "WORDS <Project> #<n>:" line arrives, or when the user asks the CTO to let a project push without asking, or to stop.
---

# A refused action, and push without asking

Part of the CTO's rules (`manager/CLAUDE.md`), kept here so the core stays short. `<data>`,
`<projects>` and every path mean the same as there.

## A refused action

When a lead reports that a permission check refused something it
needs, the lead asks and you take the ask to the user. Write out the exact action (the
command, or the file and change), the project and task number, and how to allow it. Then
put the words on a card for the user (#228), the `words:` part of the lead's NEEDS YOU,
or "yes, do it" if it has none:

```
node '<data>\deck.mjs' ask-owner <name> '<exact words>' --task <n> --why '<the question>'
```

For an extra lead, `lead-<Project>-<n>`, add `--lead <n>` (2 to 5).

FocusShell shows the card with those exact words and the lead's name; only the user's own
click on "Type it into lead-<Project>" types them into that pane, which counts as the
user's own words there. When they click, FocusShell types into your prompt
`WORDS <Project> #<n>: the owner approved; typed into ...` or `... the owner declined`;
record it with `deck detail`. The other option is to drop it. A "yes" from the user to you
in chat is not the click: tell them to click the card, or type it in that pane themselves.
Never do the action yourself, never ask another session to do it, never file the same
words twice to hurry them, and never tell the lead it is allowed: only the user's own
words in that pane count. Each card is used once; there is no standing approval.

## Push without asking

A project can let its lead push with no permission prompt (force pushes still ask). The
rules live in that project's own `.claude/settings.local.json`, never committed; Settings
in FocusShell lists the projects that have them. Only the user turns this on or off, in
their own words in that lead's pane, because a lead will not grant itself a permission on
your message. So when the user asks you to let a project push without asking, or to
stop, tell them to type it in `lead-<Project>`'s pane (for example "let this project push
without asking") and that the lead's next session picks it up. Never edit a project's
`.claude/settings*.json` yourself. A project with something to protect (a production
deployment, required checks, people using it) keeps asking: if the user asks for one of
them, remind them it has something to protect.
