---
name: deep-review
description: Two-pass adversarial review of a diff or PR — first an intentionally exhaustive pass that raises every candidate defect without filtering, then a second pass that takes each candidate one at a time and tries to break it, using every resource available (running the code, reading the base revision, tests, greps) to decide whether the bug is really reachable and whether it belongs to this change. Delivers one verdict table separating confirmed bugs from mechanisms that cannot fire, then offers to publish it as a Claude artifact and to post the link as a PR comment. Read-only on the code — it never edits anything, and posts only after an explicit yes. Use it when the user wants a review far stricter than a normal one and wants each finding proven rather than listed: "review minutieuse", "passe le diff au crible", "cherche tous les bugs", "review en profondeur", "/deep-review", "est-ce que ces bugs tiennent vraiment".
---

# deep-review

Produces a review whose findings have already survived an attempt to demolish them. Two passes, in this order, and never merged into one:

- **Pass 1 — recall.** Raise every candidate *bug*. Do not filter. A candidate is allowed to be wrong here.
- **Pass 2 — precision.** Take each bug candidate alone and try to prove it cannot happen. What survives is the review.

**The subject is bugs.** Nits, style, naming, duplication and "this could be nicer" are not what the two passes are for: they cost verification budget that belongs to the defects, and they pad the deliverable until a reader cannot tell which rows matter. Collect them as you go, in a separate list, and never put them through pass 2 — see **The nits list**.

The output is a table plus the evidence. **Nothing is edited.** At the end, the skill offers to publish the report as an artifact and to post its link on the PR; each step waits for an explicit yes (see **6. Publish and share**).

Instructions below are in English; produce the deliverable in the project's working language (French by default here).

**Relation to the sibling skills.** `pr-comment-triage` verifies claims *written by other people* on a PR. This skill is its mirror image: it *generates* the claims itself, then puts them through the same verification. Same burden of proof, opposite source. `code-review-pierre` reviews a colleague's PR conversationally, this one stays read-only and stops at the analysis. When findings survive and need fixing, hand them to `review-feedback`.

Whatever project review skill exists (e.g. `code-review-fff`) carries the domain checklist. Invoke it or read it for pass 1; this skill adds the verification discipline, it does not replace the checklist.

## 1. Frame the target

Two facts decide most verdicts later, so establish them before reading code.

```bash
scripts/target.sh            # local branch vs its base
scripts/target.sh <pr-number>
```

**The base revision.** Every scope question in pass 2 is answered by comparing against it. You need the exact ref name, not "develop probably".

**What kind of change this is.** A behaviour-preserving refactor and a feature have different bars. On a refactor, behaviour that already shipped is out of scope by default. On a feature, the same finding may well be in scope. The description usually says; if it genuinely does not, ask once, with both readings spelled out.

Note what the change *claims* to do. Behaviours it deliberately changed are exactly where "pre-existing" stops being a valid defence.

## 2. Pass 1 — raise every bug

The goal here is recall **on defects**, and the failure mode is self-censorship. A candidate you decline to write down because it "probably cannot happen" is a bug you have decided without evidence — that decision belongs to pass 2, which has the tools to make it.

Go through the diff hunk by hunk. On a multi-commit branch, read commit by commit (`git show <sha>`): a bug introduced in commit 2 and half-covered in commit 5 is invisible in the squashed diff.

Sweep these dimensions explicitly, one at a time. Sweeping them together is how whole categories get skipped. Every one of them asks the same question: *what input or timing makes this code do the wrong thing?*

- **Correctness** — off-by-one, inverted condition, wrong operator, wrong variable, copy-paste left over from the line above.
- **Nullability and absence** — every value that can be `null`, `undefined`, missing key, empty array, empty string. Read the declared type or the getter signature; do not infer it from how the call site happens to use it.
- **Types and coercion** — implicit casts, `==` vs `===`, numeric strings, dates as strings.
- **Boundaries** — first/last element, empty collection, single element, duplicate, very large input.
- **Order and timing** — anything async, anything with a listener, a timer, a race between two writers, a teardown that runs before its setup, an event that can fire twice.
- **State and lifecycle** — a value cached past its validity, a cleanup that never runs, a singleton that keeps state across two users.
- **Error paths** — the branch nobody exercises: what happens when the call throws, when the fetch 500s, when the parse fails.
- **Contract drift** — signature, prop, template contract, config key, or documented header that changed on one side only.
- **Data flow across the seam** — what actually reaches this code from outside: payload shape, CMS entry, config, environment, browser.
- **Dead or unreachable code** — including code this change *brought back to life*, which is the highest-value category in the whole sweep.
- **Security** — injection, unescaped output, secret in a tracked file, authorisation check moved or dropped.
- **Tests** — a new branch with no test; a test that asserts the mock rather than the behaviour; a test deleted along with the rule it protected. A missing test is a candidate because it hides a bug; a test you would merely write differently is a nit.

### Sort as you raise

Each observation goes to exactly one of two places, and the test is blunt:

**Worklist** — you can name an input, a timing or an environment that makes the code behave wrongly. Even a bad guess at that trigger qualifies. This is what pass 2 attacks.

**Nits list** — you cannot, because there is no wrong behaviour to trigger: naming, duplication, a redundant default, an unused variable, a comment, an ordering in a doc file, a claim in the PR description that contradicts the diff. Real, worth a line, not worth a verification.

When you cannot tell which list an item belongs to, it goes in the worklist. Pass 2 has the tools to settle it and will demote it in one question; guessing here is how a bug gets buried under a nit heading.

Write each worklist candidate as a numbered line with three fields, and nothing more:

```
C7 · path/to/file.js:214 · claim in one sentence · suspected trigger
```

The **suspected trigger** field is mandatory even when it is a guess. It is what pass 2 will attack, and a candidate with no imaginable trigger is already telling you something.

Show the numbered worklist to the user before starting pass 2, with both counts: candidates to verify, and nits set aside. It is cheap, and it lets them cut a whole category before you spend a verification on each item. Keep the nits out of that table — a bare count, and their detail waits for the deliverable.

## 3. Pass 2 — one candidate at a time, hostile

Now switch seat. For each **worklist** candidate the job is **to disprove it**. The default verdict is *infirmé*; a finding is promoted only by evidence you produced.

Nits never enter this pass. If a candidate turns out to be a nit — Q1 kills the defect but the observation still stands — move it to the nits list and stop spending on it there and then.

Four questions, in order. They are independent — a candidate can be factually right, describe a real mechanism, and still deserve no change.

**Q1 — Is the claim factually true?** Open the file at the line. Run the grep. Read the actual type signature. Candidates written in pass 1 lean on half-remembered context and are wrong often enough that this question alone kills a good share of them. A claim that does not survive stops here.

**Q2 — Is it reachable?** Write the trigger down as one concrete sentence: which user, which data, which timing, which environment. Not "if the value is null" — *where* does that null come from, and can it actually arrive?

Then go and check the source of that value, rather than assuming it. A payload field, a CMS entry, a config default, a caller three levels up: read it. Reachability is almost always decided outside the diff.

**If you cannot write the trigger sentence, the finding is not reachable.** Say so plainly. An honest "not reachable, here is why" is worth more than a hedged maybe, which forces the reader to redo the work.

**Q3 — Whose bug is it?** One command, and it is the highest-value move in the skill:

```bash
git show <base>:<path/to/file>
```

Read how the old code did the same thing. Three outcomes:

- *Identical on the base* → pre-existing. It has shipped without complaint. On a behaviour-preserving change this is out of scope by default; the honest verdict says so and offers a ticket.
- *This change introduced it* → in scope, no argument.
- *This change made a latent bug reachable* → in scope too, and this is the case people miss. Dead code brought to life counts as introduced. A real example: a cleanup routine on the base tested for a CSS class that existed nowhere, so it never ran; the change fixed the selector, and every consequence of that routine finally running belongs to the change.

**Q4 — Would the obvious fix be correct?** Reason the fix through before proposing it. A correct diagnosis with a fix that does nothing — or that moves the failure one line down — is a finding you should report as exactly that: diagnosis holds, fix does not.

### Prefer proof you executed over proof you read

"Toutes les ressources à disposition" means the verification is allowed to cost something. Ranked by strength:

1. **Run it.** A throwaway script, a node/php one-liner, a REPL, a single existing test run with a modified input. Use the project's own runner, from wherever the project actually runs it.
2. **Write the failing case** in a scratch file — never in the repo's test suite — and see whether it fails for the reason claimed. A case that passes when you expected red is a verdict.
3. **Read the value at its source** — the fixture, the config, the payload sample, the caller.
4. **Read the code and reason.** Weakest, and fine for the obvious ones; not enough on its own to promote a finding to *confirmed*.

Put scratch files in the session scratchpad, never in the project. Never commit, never stage, never edit project files — including tests — to run an experiment.

Verifying candidates in parallel with subagents is fine when there are many, one candidate per agent. Two conditions: each agent returns **the evidence**, not a verdict ("here is the command, here is its output"), and you re-read that evidence before writing the verdict. An agent's confident "yes this is a real bug" with nothing under it is worth nothing.

### Record the evidence as you go

For each candidate, keep: the question that killed or confirmed it, the command or file:line that proves it, and the one-sentence trigger if it survived. Reconstructing this at the end is where invented certainty creeps in.

## 4. Verdicts

| Verdict | Meaning |
|---|---|
| **CONFIRMÉ** | Reachable, introduced or activated by this change, trigger sentence written. Fix here. |
| **PRÉEXISTANT** | Real, but identical on the base. Out of scope by default → ticket. |
| **NON ATTEIGNABLE** | Mechanism is real, no trigger exists. Say what blocks it. |
| **INFIRMÉ** | The claim was factually wrong. Say what it got wrong. |
| **INDÉCIDABLE** | Verification needs something you do not have (production data, an environment, a decision). Say precisely what would settle it. |

Be strict about CONFIRMÉ: nothing goes there without the trigger sentence from Q2. Everything else keeps the mechanism acknowledged — a real mechanism deserves to be named as real even when it cannot fire.

`INDÉCIDABLE` is a legitimate verdict and must stay rare. It means "here is the exact experiment I could not run", never "I did not check".

There is no quality verdict. An item that turns out to be no bug at all leaves the table and joins the nits list.

### The nits list

One line each, no verification, no evidence, no severity: an openable anchor, then what you noticed — `[file.js:214](src/utils/file.js:214) — what you noticed`. Grouped under one heading at the end of the deliverable, introduced as unverified by design.

Say plainly that these were not put through pass 2, so nobody reads a nit as a proven defect. Do not rank them, do not argue them, and do not propose fixes for them unless asked — this skill's output is the bug verdicts, and the nits ride along because they were free to collect.

If the list runs long, cut it to the ones you would actually mention in a review and say how many you dropped.

## 5. Deliverable

In this order:

1. **A framing paragraph** — what was reviewed, against which base, how many candidates raised, how many survived, and the one structural fact that decided most scope calls (typically what the base did differently).
2. **The table**, one row per candidate: id, `file:line`, claim, verdict, trigger (or what blocks it). One line per row; the arguing goes underneath.
3. **The detail**, only for rows whose reasoning is not obvious: every CONFIRMÉ, and any PRÉEXISTANT or NON ATTEIGNABLE whose verdict is likely to be contested. Show the command and its output, or the `file:line` read at the base revision.
4. **What was raised and killed**, as one compact list. It is not filler: it tells the reader which categories were actually swept, and it is the only defence against a review that looks thorough because it is short.
5. **The nits list**, last, under its own heading, in the shape described above.

Do not end on a verdict about the change as a whole unless asked. The user asked which bugs hold, not for a merge decision. The PR comment status in section 6 is the one exception, and it is computed, not judged.

### Every finding carries a reference the reader can open

**No row, no paragraph, no nit without a `file:line` anchor** — the table's anchor column, the first sentence of each detail paragraph, every line of the nits list. A finding the reader cannot navigate to costs them the search you already did.

Make it clickable wherever the host renders links: a markdown link whose href is the path relative to the working directory, with the line in the `:N` suffix.

```
[fig-taboola-footer.html.twig:24](templates/common/component/taboola/fig-taboola-footer.html.twig:24)
```

Three rules on the anchor itself:

- **The line is the one in the file at the revision you analysed**, not the one in an old commit's diff hunk header. Open the file and read the number off it.
- **One anchor, the one that carries the claim.** When a finding spans several places, name the line a reader should open first and mention the others in prose. Three links they will not follow beat none, but one they will beats three.
- **A finding with no line** — a missing test, an absent `preconnect`, a claim in the PR description — anchors on the file that should have carried it (`tests/unit/.../TaboolaTest.php`, the config file, the PR itself as a link). "—" in the anchor column is the last resort, not the default.

Anything asserted in prose gets the same treatment: the config value you dumped, the base revision you compared against, the caller three levels up. Never cite a commit by hash alone — give the path and the real line number alongside it. The line is the argument; the hash is only provenance, and drop it when the line already makes the point.

## 6. Publish and share

Once the deliverable is in the chat, two offers, in this order. Each one waits for its own explicit yes. A yes to the first is not a yes to the second.

### 6a. Offer the artifact

Ask once: publish the report as an artifact on Claude? On a yes:

1. Load `artifact-design` before writing the page, as the Artifact tool requires.
2. Write one HTML page in the session scratchpad, never in the project. Same content and order as the chat deliverable: framing, table, detail, killed candidates, nits.
3. **Rewrite every anchor as a GitHub link.** A relative `path:line` link does not open from claude.ai. Use the PR head commit, not the branch name, so the links keep pointing at the analysed code after a new push:

   ```bash
   gh pr view <n> --json headRefOid,url --jq '.headRefOid + " " + .url'
   # https://github.com/<owner>/<repo>/blob/<headRefOid>/<path>#L<line>
   ```

4. Put the verdict counts at the top of the page: how many CONFIRMÉ, PRÉEXISTANT, NON ATTEIGNABLE, INFIRMÉ, INDÉCIDABLE. A CONFIRMÉ count stands out visually; the rest stays neutral.
5. Publish with the Artifact tool, title `Deep review PR <n>`, icon `review`. Rerunning the skill on the same PR in the same conversation reuses the same file path, so the link stays the same.

**The artifact is private by default.** Tell the user plainly: before the link goes on the PR, they must open sharing on the artifact, or reviewers will hit a closed page.

### 6b. Offer the PR comment

Only when there is a PR. On a local branch with no PR (`gh pr view --json number` fails), skip this step and say why.

The comment carries the link and a one-line status. Nothing else: the detail lives in the artifact. The status is derived mechanically from the verdicts, never from an overall opinion:

- At least one CONFIRMÉ → `N point(s) à traiter avant merge.`
- Zero CONFIRMÉ, at least one INDÉCIDABLE → `Aucun bug confirmé. N point(s) à trancher, voir le rapport.`
- Zero CONFIRMÉ, zero INDÉCIDABLE → `Aucun bug confirmé, bon pour merge de mon côté.`

Show the exact comment in a ` ```md ` block and ask before posting:

```md
**Deep review** : [voir le rapport](<artifact-url>)

<status line>
```

On a yes, post it with `gh pr comment <n> --body-file <scratchpad file>` and give back the comment URL. On a no, leave the block in the chat so the user can paste it themselves.

This status line is the only place the skill states a merge readiness, and only because it is computed from the table.

## Anti-patterns

- ❌ Filtering during pass 1. A candidate dropped for "it probably cannot happen" is a verdict rendered without evidence.
- ❌ Merging the two passes. Judging a candidate as you write it produces the ordinary review this skill exists to replace.
- ❌ Promoting a finding to CONFIRMÉ with no trigger sentence.
- ❌ Skipping Q3. Without `git show <base>:<file>`, pre-existing behaviour gets reported as a regression.
- ❌ Reading "the mechanism is real" as "the bug is reachable". Those are Q1 and Q2 and they come apart constantly.
- ❌ Taking a subagent's verdict instead of its evidence.
- ❌ Running experiments by editing project files or the real test suite. Scratchpad only.
- ❌ Hedging a reachability verdict to stay safe. The honest no is the deliverable.
- ❌ Putting a nit in the worklist, or spending a verification on one. The budget belongs to the defects.
- ❌ Ranking, arguing, or fixing the nits. One line each, at the end, and move on.
- ❌ A finding without a `file:line` the reader can open — in a row, in a paragraph, or in the nits list.
- ❌ An anchor read off a diff hunk header instead of the file at the analysed revision.
- ❌ Demoting a candidate to a nit to avoid verifying it. The demotion is a pass-2 outcome, never a shortcut.
- ❌ Hiding the killed candidates. They are what shows the sweep happened.
- ❌ Editing code, committing or staging. This skill never touches the code.
- ❌ Publishing the artifact or posting the PR comment without its own explicit yes. One yes covers one step.
- ❌ Writing a status line from an overall impression instead of the verdict counts.
- ❌ Relative `path:line` links inside the artifact. They do not open from claude.ai.
- ❌ Posting the link without warning that the artifact is private until shared.
