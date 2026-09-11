#!/usr/bin/env bash
#
# setup-playwright-cli.sh — make the playwright-cli agent skill runnable
# in a fresh Claude Code remote session.
#
# WHAT THIS IS FOR
#   The repo ships Microsoft's playwright-cli skill (.claude/skills/playwright-cli
#   -> ../../playwright-cli). The skill calls a `playwright-cli` binary and
#   expects Playwright's own Chromium build to be present. In this container
#   neither assumption holds out of the box:
#
#     * Playwright lives in a session-scoped scratchpad, not on PATH.
#     * The image ships one Chromium build; the installed Playwright asks for
#       a newer build number and a newer directory layout.
#
#   This script bridges both gaps with symlinks and a shim. It downloads
#   nothing, installs nothing, and touches no application file.
#
# WHAT IT CREATES (all outside the repo, all disposable)
#   /usr/local/bin/playwright-cli            shim -> <playwright>/playwright cli
#   /opt/pw-browsers/chromium-<req>          aliases the installed build
#   /opt/pw-browsers/chromium_headless_shell-<req>
#
# USAGE
#   scripts/setup-playwright-cli.sh              # set up, then verify
#   scripts/setup-playwright-cli.sh --verify     # verify only, change nothing
#   PLAYWRIGHT_DIR=/path/to/node_modules scripts/setup-playwright-cli.sh
#
# Safe to re-run: every step is a no-op when already correct. It refuses to
# replace anything that is not a symlink it owns.

set -euo pipefail

BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
SHIM=/usr/local/bin/playwright-cli
SHIM_MARKER='# managed by scripts/setup-playwright-cli.sh'
VERIFY_ONLY=0
[ "${1:-}" = "--verify" ] && VERIFY_ONLY=1

die()  { printf '\nFAIL: %s\n' "$1" >&2; exit 1; }
note() { printf '  %s\n' "$1"; }

# ─── 1. Locate the existing Playwright. Never install one. ──────────────
find_playwright() {
  # Explicit override wins.
  if [ -n "${PLAYWRIGHT_DIR:-}" ]; then
    [ -x "$PLAYWRIGHT_DIR/.bin/playwright" ] && { echo "$PLAYWRIGHT_DIR"; return; }
    die "PLAYWRIGHT_DIR=$PLAYWRIGHT_DIR has no .bin/playwright"
  fi
  # Repo-local, then this session's scratchpad (newest first).
  local c
  for c in "$(dirname "$0")/../node_modules" \
           /tmp/claude-*/*/*/scratchpad/node_modules; do
    [ -x "$c/.bin/playwright" ] && { (cd "$c" && pwd); return; }
  done
  return 1
}

PW_MODULES="$(find_playwright || true)"
[ -n "$PW_MODULES" ] || die "no Playwright installation found.
  Looked in ./node_modules and /tmp/claude-*/*/*/scratchpad/node_modules.
  This script never installs Playwright — point it at an existing one:
    PLAYWRIGHT_DIR=/path/to/node_modules $0"

PW_BIN="$PW_MODULES/.bin/playwright"
PW_CORE="$PW_MODULES/playwright-core"
[ -f "$PW_CORE/browsers.json" ] || die "$PW_CORE/browsers.json missing — playwright-core looks incomplete"

PW_VERSION="$("$PW_BIN" --version 2>/dev/null | awk '{print $2}')"
note "Playwright ${PW_VERSION:-unknown} at $PW_MODULES"

# ─── 2. Which Chromium build does THIS Playwright ask for? ──────────────
# Read it from browsers.json rather than hard-coding, so a Playwright
# upgrade does not silently leave this script aliasing the wrong build.
REQ_REV="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(next(b["revision"] for b in d["browsers"] if b["name"]=="chromium"))
' "$PW_CORE/browsers.json")"
[ -n "$REQ_REV" ] || die "could not read the required chromium revision from browsers.json"
note "required chromium build: $REQ_REV"

# ─── 3. Which build is actually installed? ──────────────────────────────
[ -d "$BROWSERS_DIR" ] || die "browser directory $BROWSERS_DIR does not exist"

HAVE_DIR=""; HAVE_REV=""
for d in "$BROWSERS_DIR"/chromium-*; do
  [ -d "$d" ] || continue
  [ -L "$d" ] && continue                       # skip aliases we made earlier
  rev="${d##*-}"
  [ "$rev" = "$REQ_REV" ] && continue
  [ -x "$d/chrome-linux/chrome" ] || [ -x "$d/chrome-linux64/chrome" ] || continue
  # keep the highest real build
  if [ -z "$HAVE_REV" ] || [ "$rev" -gt "$HAVE_REV" ] 2>/dev/null; then
    HAVE_DIR="$d"; HAVE_REV="$rev"
  fi
done
[ -n "$HAVE_DIR" ] || die "no installed Chromium found under $BROWSERS_DIR.
  This script never downloads browsers. Nothing to alias."
note "installed chromium build: $HAVE_REV ($HAVE_DIR)"

CHROME_SUBDIR="chrome-linux"
[ -x "$HAVE_DIR/chrome-linux/chrome" ] || CHROME_SUBDIR="chrome-linux64"

HS_DIR=""
for d in "$BROWSERS_DIR"/chromium_headless_shell-*; do
  [ -d "$d" ] && [ ! -L "$d" ] && [ "${d##*-}" != "$REQ_REV" ] && HS_DIR="$d"
done

# ─── 4. Helpers that refuse to clobber real files ───────────────────────
link() {  # link <target> <linkname>
  local target="$1" name="$2"
  if [ -L "$name" ]; then
    [ "$(readlink "$name")" = "$target" ] && return 0
    rm -f "$name"
  elif [ -e "$name" ]; then
    die "$name already exists and is not a symlink. Refusing to replace it.
  Remove or rename it by hand if you are sure."
  fi
  ln -s "$target" "$name"
}

managed_dir() {  # a directory this script owns, marked so re-runs can replace it
  local dir="$1"
  if [ -e "$dir" ] && [ ! -L "$dir" ] && [ ! -f "$dir/.managed-by-setup-playwright-cli" ]; then
    die "$dir exists and was not created by this script. Refusing to touch it."
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
  : > "$dir/.managed-by-setup-playwright-cli"
}

if [ "$VERIFY_ONLY" -eq 0 ]; then
  # ─── 5. Chromium alias (chrome-for-testing layout) ────────────────────
  if [ "$HAVE_REV" != "$REQ_REV" ]; then
    ALIAS="$BROWSERS_DIR/chromium-$REQ_REV"
    managed_dir "$ALIAS"
    # Playwright looks for chrome-linux/chrome; the CLI's chrome-for-testing
    # path wants chrome-linux64/chrome. Provide both names.
    ln -sfn "$HAVE_DIR/$CHROME_SUBDIR" "$ALIAS/chrome-linux"
    ln -sfn "$HAVE_DIR/$CHROME_SUBDIR" "$ALIAS/chrome-linux64"
    : > "$ALIAS/INSTALLATION_COMPLETE"
    : > "$ALIAS/DEPENDENCIES_VALIDATED"
    note "aliased chromium-$REQ_REV -> $HAVE_DIR"

    # ─── 6. Headless shell alias (renamed binary + directory) ───────────
    if [ -n "$HS_DIR" ]; then
      HS_ALIAS="$BROWSERS_DIR/chromium_headless_shell-$REQ_REV"
      managed_dir "$HS_ALIAS"
      mkdir -p "$HS_ALIAS/chrome-headless-shell-linux64"
      for f in "$HS_DIR"/chrome-linux/*; do
        ln -sfn "$f" "$HS_ALIAS/chrome-headless-shell-linux64/"
      done
      # old builds call it headless_shell, new ones chrome-headless-shell
      if [ -x "$HS_DIR/chrome-linux/headless_shell" ]; then
        ln -sfn "$HS_DIR/chrome-linux/headless_shell" \
                "$HS_ALIAS/chrome-headless-shell-linux64/chrome-headless-shell"
      fi
      : > "$HS_ALIAS/INSTALLATION_COMPLETE"
      : > "$HS_ALIAS/DEPENDENCIES_VALIDATED"
      note "aliased chromium_headless_shell-$REQ_REV -> $HS_DIR"
    fi
  else
    note "chromium build matches; no alias needed"
  fi

  # ─── 7. The playwright-cli shim ───────────────────────────────────────
  if [ -e "$SHIM" ] && ! grep -qF "$SHIM_MARKER" "$SHIM" 2>/dev/null; then
    die "$SHIM exists and was not created by this script. Refusing to overwrite it."
  fi
  cat > "$SHIM" <<EOF
#!/bin/sh
$SHIM_MARKER
# Delegates to the Playwright already installed at:
#   $PW_MODULES
exec "$PW_BIN" cli "\$@"
EOF
  chmod +x "$SHIM"
  note "shim written: $SHIM"
fi

# ─── 8. Verification ────────────────────────────────────────────────────
echo
fails=0
check() {  # check <label> <command...>
  if "${@:2}" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$1"
  else
    printf 'FAIL  %s\n' "$1"; fails=$((fails+1))
  fi
}

check "playwright-cli on PATH"            command -v playwright-cli
check "playwright-cli runs"               playwright-cli list
check "chromium binary resolves"          test -x "$BROWSERS_DIR/chromium-$REQ_REV/chrome-linux/chrome"
check "skill registered"                  test -f "$(dirname "$0")/../.claude/skills/playwright-cli/SKILL.md"

echo
if [ "$fails" -eq 0 ]; then
  echo "RESULT: PASS — playwright-cli is ready."
  echo "Note: pages must be served over http:// (the CLI blocks file://),"
  echo "and the browser must be opened with --browser=chromium."
  exit 0
fi
echo "RESULT: FAIL — $fails check(s) failed."
exit 1
