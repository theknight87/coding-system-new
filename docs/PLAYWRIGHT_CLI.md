# Playwright CLI skill — session setup

The repo ships Microsoft's official `playwright-cli` agent skill:

```
.claude/skills/playwright-cli -> ../../playwright-cli     (SKILL.md + references/)
```

The skill itself needs nothing installed. What it needs is a working
`playwright-cli` command and a Chromium the installed Playwright will accept.
In a Claude Code remote session neither is true at start, so run:

```bash
scripts/setup-playwright-cli.sh
```

## When to run it

**At the start of any new session in which you intend to drive a browser** —
UI verification, screenshots, checking a page renders. One run per session.

Signs you forgot:

| Symptom | Meaning |
|---|---|
| `playwright-cli: command not found` | the shim is missing — run the script |
| `Executable doesn't exist at .../chromium-<n>/…` | the build alias is missing — run the script |
| `Run "npx playwright install"` | **do not**. The image ships the browser; run the script instead |

To check without changing anything: `scripts/setup-playwright-cli.sh --verify`

## What it does, and does not do

It creates three things, all outside the repo, all disposable:

- `/usr/local/bin/playwright-cli` — a shim delegating to the Playwright
  already installed in this session's scratchpad
- `/opt/pw-browsers/chromium-<required>` — alias onto the Chromium the image
  ships, in both the `chrome-linux` and `chrome-linux64` layouts
- `/opt/pw-browsers/chromium_headless_shell-<required>` — same, plus the
  `headless_shell` → `chrome-headless-shell` rename

It **never downloads a browser, installs a package, or touches
`package.json`, `src/`, or the existing Playwright install.** It is safe to
re-run, and it refuses to replace any file it did not create.

The required build number is read from `playwright-core/browsers.json` at run
time, not hard-coded, so a Playwright upgrade cannot leave it quietly aliasing
the wrong build.

## Two constraints of this environment

1. **Serve over HTTP.** The CLI blocks `file://`. Use
   `python3 -m http.server <port>` in the scratchpad, or `npm run dev`.
2. **Pass `--browser=chromium`.** The default channel is `chrome`, which is
   not in this image.

## Verifying the app itself

`VITE_SUPABASE_URL` set to a placeholder containing `your-project` puts the
app in offline mode: every page renders from seed data with no login. That is
the intended way to check UI changes here — production (`*.pages.dev`,
`*.supabase.co`) is blocked by the sandbox egress proxy.

```bash
playwright-cli open --browser=chromium http://localhost:5173/
playwright-cli snapshot
playwright-cli screenshot --filename=dashboard.png
playwright-cli close
```
