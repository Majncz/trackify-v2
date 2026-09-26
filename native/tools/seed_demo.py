#!/usr/bin/env python3
"""Fill a Trackify account with realistic demo data through the public API.

    seed_demo.py <base-url> <email> <password> [--reset]

Creates the account if it does not exist. --reset hides/deletes what the seeder
made before (tasks are hidden, events and groups deleted). Deterministic (seeded RNG),
so screenshots stay comparable between runs.
"""
from __future__ import annotations

import json
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE, EMAIL, PASSWORD = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
RESET = "--reset" in sys.argv
rng = random.Random(42)


def call(method: str, path: str, body=None, token: str | None = None, ok=(200, 201)):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            payload = json.loads(payload)
        except Exception:
            pass
        if e.code not in ok:
            return e.code, payload
        raise


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


status, _ = call("POST", "/api/auth/register", {"email": EMAIL, "password": PASSWORD})
status, tok = call("POST", "/api/auth/token", {"email": EMAIL, "password": PASSWORD, "deviceName": "seed"})
assert status == 200, tok
T = tok["token"]

call("PATCH", "/api/profile", {"displayName": "Nina Native"}, T)

if RESET:
    call("POST", "/api/timer/stop", {}, T)
    _, tasks = call("GET", "/api/tasks", token=T)
    for t in tasks:
        for e in t["events"]:
            call("DELETE", f"/api/events/{e['id']}", token=T)
        call("DELETE", f"/api/tasks/{t['id']}", token=T)
    _, groups = call("GET", "/api/groups", token=T)
    for g in groups:
        call("DELETE", f"/api/groups/{g['id']}", token=T)
    _, pays = call("GET", "/api/billing/payments", token=T)
    for p in pays:
        call("DELETE", f"/api/billing/payments/{p['id']}", token=T)
    _, bts = call("GET", "/api/billing/tasks", token=T)
    for b in bts:
        call("DELETE", f"/api/billing/tasks/{b['id']}", token=T)
    _, periods = call("GET", "/api/ai-subscriptions/periods", token=T)
    for p in periods.get("periods", []):
        call("DELETE", f"/api/ai-subscriptions/periods/{p['id']}", token=T)

_, existing = call("GET", "/api/tasks", token=T)
by_name = {t["name"]: t for t in existing}

TASKS = [
    # name, weight, typical minutes
    ("Client portal redesign", 9, 95),
    ("Bombay kitchen hub", 7, 80),
    ("Code review", 5, 30),
    ("Emails & admin", 5, 20),
    ("Mobile app", 6, 70),
    ("Research: pricing", 2, 45),
    ("Standup", 4, 15),
    ("Invoice prep", 1, 35),
    ("Learning Swift", 3, 50),
    ("Gym", 3, 60),
]
ids = {}
for name, _, _ in TASKS:
    if name in by_name:
        ids[name] = by_name[name]["id"]
        continue
    s, t = call("POST", "/api/tasks", {"name": name}, T)
    assert s == 201, t
    ids[name] = t["id"]

# Groups (one custom colour, one auto).
_, groups = call("GET", "/api/groups", token=T)
if not groups:
    call("POST", "/api/groups", {"name": "Client work", "color": "#0277bd",
                                   "taskIds": [ids["Client portal redesign"], ids["Bombay kitchen hub"], ids["Mobile app"]]}, T)
    call("POST", "/api/groups", {"name": "Overhead", "color": None,
                                   "taskIds": [ids["Emails & admin"], ids["Standup"], ids["Invoice prep"]]}, T)

# Events: past 150 days, weekdays heavy, weekends light. No overlaps (sequential per day).
have_events = any(t["events"] for t in existing)
if not have_events:
    now = datetime.now().astimezone()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    names = [t[0] for t in TASKS]
    weights = [t[1] for t in TASKS]
    batch = 0
    for back in range(150, -1, -1):
        day = today - timedelta(days=back)
        weekend = day.weekday() >= 5
        if weekend and rng.random() < 0.6:
            continue
        if rng.random() < 0.08:
            continue
        cursor = day + timedelta(hours=8 + rng.random() * 2.2)
        end_of_day = day + timedelta(hours=(14 if weekend else 18) + rng.random() * 3)
        if back == 0:
            end_of_day = min(end_of_day, now - timedelta(minutes=50))
        while cursor < end_of_day:
            name = rng.choices(names, weights=weights)[0]
            typical = dict((t[0], t[2]) for t in TASKS)[name]
            mins = max(8, int(rng.gauss(typical, typical * 0.35)))
            stop = min(cursor + timedelta(minutes=mins), end_of_day)
            if (stop - cursor).total_seconds() >= 120:
                s, r = call("POST", "/api/events", {"taskId": ids[name], "from": iso(cursor), "to": iso(stop),
                                                   "name": "Time entry", "source": "manual"}, T)
                batch += 1
            cursor = stop + timedelta(minutes=rng.choice([0, 0, 5, 10, 15, 30, 45]))
    print(f"events created: {batch}")

# Billing: two enrolled tasks, one payment covering older sessions.
_, bts = call("GET", "/api/billing/tasks", token=T)
if not bts:
    call("POST", "/api/billing/tasks", {"taskId": ids["Client portal redesign"], "hourlyRate": 1200, "currency": "CZK"}, T)
    call("POST", "/api/billing/tasks", {"taskId": ids["Mobile app"], "hourlyRate": 45, "currency": "EUR"}, T)
    old_to = iso(datetime.now().astimezone() - timedelta(days=45))
    _, sess = call("GET", f"/api/billing/sessions?status=unpaid&to={old_to}", token=T)
    czk = [s["id"] for s in sess.get("sessions", []) if s["currency"] == "CZK"][:25]
    if czk:
        call("POST", "/api/billing/payments", {"eventIds": czk, "paidAt": iso(datetime.now() - timedelta(days=40)),
                                                 "note": "Invoice 2026-07"}, T)

# AI subscriptions.
_, periods = call("GET", "/api/ai-subscriptions/periods", token=T)
if not periods.get("periods"):
    start = (datetime.now().astimezone() - timedelta(days=120)).replace(hour=0, minute=0, second=0, microsecond=0)
    call("POST", "/api/ai-subscriptions/periods", {"name": "Claude Pro", "price": 20, "currency": "USD",
                                                    "startsAt": iso(start), "billingKind": "recurring_monthly",
                                                    "billingCadence": "monthly", "billingEmail": "nina@example.com",
                                                    "billingProviderUrl": "claude.ai/settings/billing"}, T)
    s2 = (datetime.now().astimezone() - timedelta(days=70)).replace(hour=0, minute=0, second=0, microsecond=0)
    call("POST", "/api/ai-subscriptions/periods", {"name": "Cursor Pro", "price": 480, "currency": "CZK",
                                                    "startsAt": iso(s2), "endsAt": iso(s2 + timedelta(days=30)),
                                                    "billingKind": "purchase", "billingCadence": "monthly"}, T)

print("ok", EMAIL)
