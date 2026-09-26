#!/usr/bin/env bash
# CI: run the iOS UI-test screenshot walk on a device matrix, the timer flow test, and macOS screenshots.
# Env: DD (DerivedData), OUT (artifacts), TRACKIFY_SERVER, SHOT_SET (quick|full|legacy), RUN_FLOWS (1/0), RUN_MAC (1/0)
set -uo pipefail
SHOTS="${OUT:?}/screens"
mkdir -p "$SHOTS" "$OUT/xcresult" "$OUT/logs"
SERVER="${TRACKIFY_SERVER:-https://trackify-native.dev.bitterlemon.co}"
SHOT_SET="${SHOT_SET:-quick}"
XCTESTRUN=$(ls "${DD:?}"/Build/Products/*.xctestrun 2>/dev/null | head -1)
FAILS=0

api_token() {
  curl -s -X POST "$SERVER/api/auth/token" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"deviceName\":\"CI screenshots\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))'
}

# ── Demo timer: running 47 min on "Learning Swift" so running-state screens look real.
#    Started via the legacy upsert and removed with DELETE (never saves an entry).
DEMO_TOKEN=$(api_token demo@trackify.test trackify-demo)
demo_timer_start() {
  local task start
  task=$(curl -s -H "Authorization: Bearer $DEMO_TOKEN" "$SERVER/api/tasks" | python3 -c '
import json,sys
ts=json.load(sys.stdin)
pick=[t for t in ts if t["name"]=="Learning Swift"] or ts
print(pick[0]["id"] if pick else "")')
  start=$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=47)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
  [ -n "$task" ] && curl -s -X POST "$SERVER/api/timer" -H "Authorization: Bearer $DEMO_TOKEN" -H 'content-type: application/json' \
    -d "{\"taskId\":\"$task\",\"startTime\":\"$start\"}" >/dev/null
}
demo_timer_stop() { curl -s -X DELETE "$SERVER/api/timer" -H "Authorization: Bearer $DEMO_TOKEN" >/dev/null; }

runtime_for() { # newest runtime that has this device type
  xcrun simctl list devices available -j | python3 -c '
import json,sys
name=sys.argv[1]; d=json.load(sys.stdin)["devices"]
best=None
for rt,devs in d.items():
  if "iOS" not in rt: continue
  for x in devs:
    if x["name"]==name:
      v=tuple(int(p) for p in rt.split("iOS-")[1].split("-"))
      if best is None or v>best[0]: best=(v,x["udid"])
print(best[1] if best else "")' "$1"
}

run_ios() { # name device appearance orientation contentSize testFilter
  local name="$1" device="$2" appearance="$3" orient="$4" size="$5" only="$6"
  local udid; udid=$(runtime_for "$device")
  if [ -z "$udid" ]; then echo "!! no simulator for $device"; return; fi
  echo "== $name ($device, $appearance, $orient, ${size:-default})"
  xcrun simctl boot "$udid" 2>/dev/null
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1
  xcrun simctl ui "$udid" appearance "$appearance" >/dev/null 2>&1
  xcrun simctl status_bar "$udid" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiBars 3 >/dev/null 2>&1
  TEST_RUNNER_SHOT_DIR="$SHOTS" TEST_RUNNER_SHOT_PREFIX="$name" TEST_RUNNER_SHOT_ORIENTATION="$orient" \
  TEST_RUNNER_SHOT_CONTENT_SIZE="$size" TEST_RUNNER_TRACKIFY_SERVER="$SERVER" \
    xcodebuild test-without-building -xctestrun "$XCTESTRUN" -destination "id=$udid" \
      -only-testing:"$only" -resultBundlePath "$OUT/xcresult/$name.xcresult" \
      -test-timeouts-enabled YES -maximum-test-execution-time-allowance 900 \
      > "$OUT/logs/ios-$name.log" 2>&1 || { echo "!! $name tests failed"; FAILS=$((FAILS+1)); grep -E "error:|failed|XCTAssert" "$OUT/logs/ios-$name.log" | head -20; }
  xcrun simctl shutdown "$udid" >/dev/null 2>&1
}

WALK="TrackifyUITests/ScreenshotWalkTests"
if [ -n "$XCTESTRUN" ]; then
  demo_timer_start
  case "$SHOT_SET" in
    quick)
      run_ios iphone17pro-light "iPhone 17 Pro" light portrait "" "$WALK"
      run_ios ipad13-landscape "iPad Pro 13-inch (M5)" light landscape "" "$WALK/test02Walk"
      ;;
    full)
      run_ios iphone17pro-light "iPhone 17 Pro" light portrait "" "$WALK"
      run_ios iphone17pro-dark "iPhone 17 Pro" dark portrait "" "$WALK"
      run_ios iphone17 "iPhone 17" light portrait "" "$WALK/test02Walk"
      run_ios iphone17promax "iPhone 17 Pro Max" light portrait "" "$WALK/test02Walk"
      run_ios iphone16e-small "iPhone 16e" light portrait "" "$WALK/test02Walk"
      run_ios iphone17pro-landscape "iPhone 17 Pro" light landscape "" "$WALK/test02Walk"
      run_ios iphone17pro-axl "iPhone 17 Pro" light portrait "UICTContentSizeCategoryAccessibilityL" "$WALK/test02Walk"
      run_ios ipad13-portrait "iPad Pro 13-inch (M5)" light portrait "" "$WALK/test02Walk"
      run_ios ipad13-landscape "iPad Pro 13-inch (M5)" dark landscape "" "$WALK/test02Walk"
      run_ios ipadmini-portrait "iPad mini (A17 Pro)" light portrait "" "$WALK/test02Walk"
      ;;
    legacy)
      run_ios iphonese-ios18 "iPhone SE (3rd generation)" light portrait "" "$WALK"
      ;;
  esac
  demo_timer_stop
  if [ "${RUN_FLOWS:-1}" = "1" ]; then
    run_ios flows "iPhone 17 Pro" light portrait "" "TrackifyUITests/TimerFlowTests"
  fi
else
  echo "!! no xctestrun found"
fi

# ── macOS: panel (as a window), dashboard at two sizes, menu bar; light + dark; idle CPU.
if [ "${RUN_MAC:-1}" = "1" ] && [ -d "$DD/Build/Products/Debug/Trackify.app" ]; then
  bash "$(dirname "$0")/ci-mac-screenshots.sh" || FAILS=$((FAILS+1))
fi

ls -1 "$SHOTS" | wc -l | xargs echo "screenshots:"
exit 0
