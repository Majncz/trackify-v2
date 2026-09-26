#!/usr/bin/env bash
# macOS screenshots + idle CPU. Needs DD, OUT, TRACKIFY_SERVER.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="${TRACKIFY_SERVER:-https://trackify-native.dev.bitterlemon.co}"
APP="${DD:?}/Build/Products/Debug/Trackify.app"
BIN="$APP/Contents/MacOS/Trackify"
SHOTS="${OUT:?}/screens"
mkdir -p "$SHOTS" "$OUT/logs"
swiftc -O "$HERE/winlist.swift" -o /tmp/winlist 2>/dev/null || { echo "winlist build failed"; exit 1; }
SCREEN=$(/tmp/winlist --screen)
SW=${SCREEN%x*}
echo "screen $SCREEN"

token() {
  curl -s -X POST "$SERVER/api/auth/token" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"deviceName\":\"CI mac\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))'
}
DEMO=$(token demo@trackify.test trackify-demo)
start_demo_timer() {
  local task start
  task=$(curl -s -H "Authorization: Bearer $DEMO" "$SERVER/api/tasks" | python3 -c '
import json,sys
ts=json.load(sys.stdin); p=[t for t in ts if t["name"]=="Learning Swift"] or ts
print(p[0]["id"] if p else "")')
  start=$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=47)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
  curl -s -X POST "$SERVER/api/timer" -H "Authorization: Bearer $DEMO" -H 'content-type: application/json' -d "{\"taskId\":\"$task\",\"startTime\":\"$start\"}" >/dev/null
}

PID=""
launch() { # name, extra args...
  local name="$1"; shift
  pkill -x Trackify 2>/dev/null; sleep 1
  "$BIN" -TrackifyServer "$SERVER" -TrackifyAutoLogin "${ACCOUNT:-demo@trackify.test:trackify-demo}" "$@" > "$OUT/logs/mac-$name.log" 2>&1 &
  PID=$!
  sleep "${WAIT:-14}"
}

capture_window() { # name
  local id
  id=$(/tmp/winlist "$PID" | head -1 | cut -d' ' -f1)
  if [ -n "$id" ]; then screencapture -x -o -l"$id" "$SHOTS/mac-$1.png"; else echo "!! no window for $1"; screencapture -x "$SHOTS/mac-$1-fullscreen.png"; fi
}

capture_menubar() { # name
  screencapture -x "/tmp/full.png"
  local h=74 w=1400
  # Right part of the (retina) menu bar where status items live.
  local pw ph
  pw=$(sips -g pixelWidth /tmp/full.png | awk '/pixelWidth/{print $2}')
  ph=$(sips -g pixelHeight /tmp/full.png | awk '/pixelHeight/{print $2}')
  local scale=$(( pw / SW ))
  h=$(( 26 * scale )); w=$(( 700 * scale ))
  sips -c "$h" "$w" --cropOffset 0 $(( pw - w )) /tmp/full.png --out "$SHOTS/mac-$1.png" >/dev/null
}

start_demo_timer

# Panel content in a window (light + dark)
launch panel-light -TrackifyShowPanelWindow YES
capture_window panel-light
capture_menubar menubar-running
# idle CPU with the app running in the background (panel window closed would be ideal; measure as-is and again after closing)
launch idle -TrackifyNoWindows YES
sleep 5
T0=$(ps -o cputime= -p "$PID" | awk -F: '{ if (NF==3) print ($1*3600)+($2*60)+$3; else print ($1*60)+$2 }')
sleep 30
T1=$(ps -o cputime= -p "$PID" | awk -F: '{ if (NF==3) print ($1*3600)+($2*60)+$3; else print ($1*60)+$2 }')
RSS=$(ps -o rss= -p "$PID" | tr -d ' ')
python3 -c "print(f'macOS idle CPU over 30 s (menu bar only, timer running): {($T1-$T0)/30*100:.2f}% ; RSS {int('$RSS')/1024:.1f} MB')" | tee -a "$OUT/perf.txt"

launch panel-dark -TrackifyShowPanelWindow YES -TrackifyAppearance dark
capture_window panel-dark

for screen in home stats visualizations billing chat settings; do
  launch "dash-$screen" -TrackifyOpenDashboard YES -TrackifyScreen "$screen" -TrackifyWindowSize 1200x820
  capture_window "dashboard-$screen"
done
launch dash-small -TrackifyOpenDashboard YES -TrackifyScreen home -TrackifyWindowSize 900x600
capture_window dashboard-small
launch dash-dark -TrackifyOpenDashboard YES -TrackifyScreen home -TrackifyWindowSize 1200x820 -TrackifyAppearance dark
capture_window dashboard-home-dark
launch dash-stats-dark -TrackifyOpenDashboard YES -TrackifyScreen stats -TrackifyWindowSize 1200x820 -TrackifyAppearance dark
capture_window dashboard-stats-dark

# Long task name in the menu bar (native account)
NATIVE=$(token native@trackify.test trackify-native)
LONG="Quarterly planning with the whole design team"
LID=$(curl -s -H "Authorization: Bearer $NATIVE" "$SERVER/api/tasks" | python3 -c "
import json,sys
ts=json.load(sys.stdin); p=[t for t in ts if t['name']=='''$LONG''']
print(p[0]['id'] if p else '')")
if [ -z "$LID" ]; then
  LID=$(curl -s -X POST "$SERVER/api/tasks" -H "Authorization: Bearer $NATIVE" -H 'content-type: application/json' -d "{\"name\":\"$LONG\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))')
fi
START=$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=83)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
curl -s -X POST "$SERVER/api/timer" -H "Authorization: Bearer $NATIVE" -H 'content-type: application/json' -d "{\"taskId\":\"$LID\",\"startTime\":\"$START\"}" >/dev/null
ACCOUNT="native@trackify.test:trackify-native" launch menubar-long -TrackifyNoWindows YES -TrackifyFreshLogin YES
capture_menubar menubar-long-name
ACCOUNT="native@trackify.test:trackify-native" launch panel-native -TrackifyShowPanelWindow YES
capture_window panel-long-name
curl -s -X DELETE "$SERVER/api/timer" -H "Authorization: Bearer $NATIVE" >/dev/null

# Idle menu bar (demo, nothing running)
curl -s -X DELETE "$SERVER/api/timer" -H "Authorization: Bearer $DEMO" >/dev/null
launch menubar-idle -TrackifyNoWindows YES
capture_menubar menubar-idle
pkill -x Trackify 2>/dev/null
exit 0
