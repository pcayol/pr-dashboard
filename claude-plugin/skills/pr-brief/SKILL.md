---
name: pr-brief
description: Explains a pull request as simply as possible before the user starts working on it — first what the module or feature does today, then what the PR adds, removes, fixes and refactors, and why. Read-only, never posts anything. Triggers on "/pr-brief", "explique-moi cette PR", "brief de la PR", "de quoi parle cette PR", or a PR URL handed over to understand it before a review.
---

# pr-brief

Gives the user a short, plain explanation of a PR so they can form an opinion **before** reviewing or working on it. It does not judge the code. No bugs, no suggestions, no verdict.

The only goal is clarity. Every sentence must be understood on first read.

## 1. Gather

Use `gh`, not WebFetch (private repo).

- **Remote PR** (URL or number):
  ```bash
  gh pr view <N> --json title,body,author,baseRefName,headRefName,files
  gh pr diff <N>
  ```
- **No PR given**: brief the current branch against `develop`.
  ```bash
  git log --oneline develop..HEAD
  git diff develop...HEAD
  ```

Then read enough of the code to explain the module **as it is on the base branch**: the changed files in full, plus their main callers if needed. Read the linked Jira ticket if the PR body or branch name gives one (`FIFTY-XXXXX`) and the Jira tools are available.

Do not trust the PR description blindly. Check every claim against the diff.

## 2. Write the brief

Output in French. Follow the user's writing rules strictly: short sentences, one idea per sentence, no em dashes, no parenthetical asides, English technical terms kept as is and written in `code` when they name something in the code.

Use exactly this structure. Drop a section or category when it is empty.

```md
## Le contexte

<What the module or feature does today, before the PR. Its job and its nominal flow. 3 to 6 short sentences. Name the real classes, files or custom elements in `code`.>

## En une phrase

<What the PR does, in one sentence.>

## Ce qui change

**Ajoute**
- <one change per bullet, one short sentence>

**Retire**
- …

**Fixe**
- <the bug: what happened, in what case>

**Refacto**
- <what moves or is renamed, with no behaviour change>

## Pourquoi

- <one bullet per change or group of changes: the reason, in one sentence>

## Points d'attention

- <only if real: a behaviour change a reader could miss, a `common/` file impacting several sites, a migration, a missing test. Otherwise drop the section.>
```

## 3. Rules

- **Start from the reader's need.** The context section must let someone who has never opened the module understand the rest.
- **Be precise.** Name the real function, class, file or event. "le scroll est bloqué" is vague. "`fig-photo` pose `overflow: hidden` sur le `body` à l'ouverture" is precise.
- **Be short.** The whole brief should fit on one screen. If a bullet needs two sentences, split it into two bullets or cut it.
- **No code blocks** in the brief, except a one-line snippet when it is the clearest way to show a change.
- **No file-by-file listing.** Group by meaning, not by file.
- **Link files** as markdown links with line numbers when it helps: `[Photo.js:42](assets/common/…/Photo.js:42)`.
- **Say when unsure.** If the reason for a change cannot be found in the diff, the ticket or the commits, write "raison non précisée" rather than inventing one.

After the brief, stop. Offer nothing else unless the user asks.
