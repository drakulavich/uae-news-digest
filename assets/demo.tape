# uae-news-digest README screencast
# Regenerate with: vhs assets/demo.tape
# Requires: vhs >= 0.11, ttyd, ffmpeg, Chromium, Bun, jq
# Before recording from source, run: bun link

Output assets/demo.gif

Require bun
Require jq

Set Shell "bash"
Set FontSize 22
Set Width 1500
Set Height 940
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set Padding 24

# 1. live Google News healthcheck
Type "uae-news-digest healthcheck"
Sleep 400ms
Enter
Sleep 2200ms

# 2. real UAE briefing
Type "uae-news-digest --limit 5 --dry-run"
Sleep 400ms
Enter
Sleep 5000ms

# 3. JSON contract for scripts and agents
Type "uae-news-digest --json --limit 3 --dry-run | jq '{count, headlines: [.items[].title]}'"
Sleep 400ms
Enter
Sleep 4000ms

Sleep 800ms
