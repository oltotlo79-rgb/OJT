#!/usr/bin/env bash
# Emits one line per newly seen process (node/electron/pnpm/electron-builder/vitest) that belongs to
# this repo (command line contains git-projects\OJT), is older than 20 minutes, and is not idle
# (CPU > 30 s) OR is an electron process (orphans are the failure mode there).
seen="C:/Users/oltot/AppData/Local/Temp/claude/C--Users-oltot-Documents-git-projects-OJT/88963c22-704b-4dea-ae46-f5624b029f20/scratchpad/monitor/seen-pids.txt"
: > "$seen"
while true; do
  powershell -NoProfile -Command "
    \$cut = (Get-Date).AddMinutes(-20)
    Get-CimInstance Win32_Process | Where-Object {
      (\$_.Name -match '^(node|electron|pnpm)') -and (\$_.CommandLine -match 'git-projects\\OJT')
    } | ForEach-Object {
      \$p = Get-Process -Id \$_.ProcessId -ErrorAction SilentlyContinue
      if (\$p -and \$p.StartTime -lt \$cut) {
        \$cpu = [math]::Round(\$p.CPU, 0)
        if (\$_.Name -match '^electron' -or \$cpu -gt 30) {
          \$cl = \$_.CommandLine; if (\$cl.Length -gt 140) { \$cl = \$cl.Substring(0,140) + '...' }
          \"\$(\$_.ProcessId) \$(\$_.Name) started=\$(\$p.StartTime.ToString('HH:mm')) cpu=\$(\$cpu)s mem=\$([math]::Round(\$p.WorkingSet64/1MB,0))MB cmd=\$cl\"
        }
      }
    }" 2>/dev/null | while IFS= read -r line; do
    pid="${line%% *}"
    if [ -n "$pid" ] && ! grep -q "^$pid$" "$seen"; then
      echo "$pid" >> "$seen"
      echo "LONG-RUNNING REPO PROCESS (>20min): $line"
    fi
  done
  sleep 60
done
