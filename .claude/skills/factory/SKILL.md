---
name: factory
description: Run one cycle of the Solar Rover improvement factory — the ideator proposes improvements into BACKLOG.md, the user picks one, the builder implements it on its own branch, an independent QA agent verifies it (up to two fix rounds), and the branch is pushed for the user to test. Use when the user types /factory, or asks to run the factory / pick the next improvement. Never merges to main.
---

# /factory — one cycle

Agents (in `mars-rover/.claude/agents/`): **ideator**, **builder**, **qa**. You are the
conductor: you run them in order, talk to the user, and do the git plumbing. Reply to the
user in Ukrainian, tersely. The game lives in `/Users/yuriitroniak/Games/mars-rover`;
its remote is `rover` (`tronya/mars-rover`) — never push the game to `origin`.

**Progress for the dashboard.** At every step below, run the matching
`node tools/factory-status.mjs …` command (in `mars-rover/`). It publishes the backlog and
the current run to the `factory-status` branch, which the user's dashboard (gdoc-pwa →
Фабрика) shows live. It never touches the working copy. If it fails (offline), carry on.

Arguments: `/factory` (full cycle), `/factory ideas` (stop after step 2),
`/factory F-012` (skip ideas, build that item), `/factory merge F-012` (step 8 only).

## 1. Preflight
- `git status --short` must be clean (except `BACKLOG.md`); if not, stop and tell the user what is uncommitted.
- `git fetch rover` and note `main`'s head. All factory branches start from `rover/main`.

## 2. Ideas
- If «Пропозиції» in `BACKLOG.md` has fewer than 3 items, spawn **ideator** (foreground) to add 3–5, then status `sync`.
- Show the user the open proposals with AskUserQuestion: up to 4 options (id · title · one-line «Навіщо»), most valuable first. The user can also type their own idea via «Other» — then write it into BACKLOG.md in the same format yourself (ask for the acceptance criteria only if you can't infer sensible ones).
- Move the chosen item to «Вибрано».
- Status: `start <id> <branch>` (pick the branch name now, see step 3).

## 3. Branch
- `git checkout -b factory/<id-lowercase>-<short-slug> rover/main`.

## 4. Build
- Status: `stage build running "…"` before, `stage build done|failed "<one-line summary>"` after.
- Spawn **builder** (foreground) with: the full item text, the branch name, and the instruction to commit on that branch only.

## 5. QA
- Status: `stage qa running` before each QA run; after it `stage qa done "PASS"` or `stage qa failed "FAIL: <problems in a few words>"`, and for a fix round `stage build running "виправлення після QA"`.
- Spawn **qa** (foreground, fresh — never the builder's context) with: the branch name, the item and its «Готово, коли» criteria, and the builder's report marked as unverified claims.
- On `VERDICT: FAIL`: send the QA report back to **builder** (continue the same builder via SendMessage if possible, otherwise spawn a new one with the item + report) and repeat QA. At most **2** fix rounds; after that stop and report to the user what still fails.

## 6. Publish the branch
- On PASS: `git push -u rover <branch>`. Move the item to «На перевірці» in `BACKLOG.md`, adding a `- **Гілка:** <branch>` line; commit that BACKLOG change on the branch too and push.
- Never merge, never push `main`, never deploy — the user's rule is that nothing ships without their own test.
- Status: `stage publish done "гілка запушена"` then `finish review "чекає твого тесту"`. If QA failed twice: `finish failed "<what still fails>"`.

## 7. Report
Tell the user, briefly:
- what was built (one line per criterion with QA's evidence),
- how to try it locally: `git checkout <branch>` in `mars-rover`, then open http://localhost:5173/ (the `games` preview server),
- the compare link: `https://github.com/tronya/mars-rover/compare/main...<branch>`,
- anything QA flagged as a risk.
Then `git checkout main` so the working copy is back where the user expects it.

## 8. Merge (only when the user says so: «зливай», «merge F-012», …)
- `git checkout main && git pull --ff-only rover main && git merge --ff-only <branch>` (rebase the branch on main first if it isn't a fast-forward, rerun `npm test`).
- `git push rover main` — this deploys https://tronya.github.io/mars-rover/.
- Status: `stage merge done "<version>"` then `finish merged "<version> на сайті"`.
- Move the item to «Готово» with the version, delete the remote branch (`git push rover --delete <branch>`), and wait for the site to show the new `#version` before reporting.
- If the user rejects an item instead, move it to «Відхилено» with their reason, delete the branch, and `finish rejected "<reason>"`.
- After any BACKLOG.md edit outside a run (new ideas, rejections): `sync`.
