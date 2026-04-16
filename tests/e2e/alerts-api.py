"""
E2E API tests for alerts CRUD.
Requires: backend running on port 3001 with TEST_AUTH_BYPASS=1
Run: python3 tests/e2e/alerts-api.py
"""

import json
import sys
import uuid
import urllib.request
import urllib.error

BASE = "http://localhost:3001"
TEST_USER = f"test-{uuid.uuid4().hex[:8]}"
HEADERS = {
    "Content-Type": "application/json",
    "X-Test-User-Id": TEST_USER,
}

PASS = 0
FAIL = 0
created_ids: list[int] = []


def test(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS: {name}")
    else:
        FAIL += 1
        print(f"  FAIL: {name} — {detail}")


def api(method, path, body=None, expect_status=200):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers=HEADERS,
        method=method,
    )
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        try:
            return e.code, json.loads(body_text)
        except json.JSONDecodeError:
            return e.code, {"raw": body_text}


# ── Create Global Alert ──────────────────────────────────────────────────
print("\n=== Create Global Alert ===")
status, data = api("POST", "/alerts", {
    "name": "Cost spike alert",
    "metric": "daily_cost",
    "operator": "gt",
    "threshold": 100,
    "email": "test@example.com",
    "cooldown_minutes": 60,
    "trigger_type": "threshold",
    "segment_type": "all",
    "evaluation": "aggregate",
})
test("Status 200", status == 200, f"got {status}: {data}")
if status == 200:
    test("Has id", "id" in data)
    test("Name correct", data.get("name") == "Cost spike alert")
    test("Metric saved", data.get("metric") == "daily_cost")
    test("Operator saved", data.get("operator") == "gt")
    test("Threshold saved", float(data.get("threshold", 0)) == 100)
    test("Email saved", data.get("email") == "test@example.com")
    test("Trigger type saved", data.get("trigger_type") == "threshold")
    test("Evaluation saved", data.get("evaluation") == "aggregate")
    test("Enabled by default", data.get("enabled") is True)
    created_ids.append(data["id"])

# ── Create Per-Customer Alert ────────────────────────────────────────────
print("\n=== Create Per-Customer Alert ===")
status, data = api("POST", "/alerts", {
    "name": "Churn risk",
    "metric": "daily_cost",
    "operator": "lt",
    "threshold": -30,
    "webhook_url": "https://hooks.slack.com/services/test",
    "cooldown_minutes": 1440,
    "trigger_type": "usage_decline",
    "segment_type": "cohort",
    "segment_value": "at_risk",
    "evaluation": "per_customer",
})
test("Status 200", status == 200, f"got {status}: {data}")
if status == 200:
    test("Trigger type saved", data.get("trigger_type") == "usage_decline")
    test("Evaluation per_customer", data.get("evaluation") == "per_customer")
    test("Segment type cohort", data.get("segment_type") == "cohort")
    test("Segment value at_risk", data.get("segment_value") == "at_risk")
    test("Webhook saved", data.get("webhook_url") == "https://hooks.slack.com/services/test")
    test("Cooldown 1440", int(data.get("cooldown_minutes", 0)) == 1440)
    created_ids.append(data["id"])

# ── Create with Specific Customer Segment ────────────────────────────────
print("\n=== Create with Specific Customer Segment ===")
status, data = api("POST", "/alerts", {
    "name": "Watch Acme",
    "metric": "daily_cost",
    "operator": "gt",
    "threshold": 14,
    "email": "test@example.com",
    "trigger_type": "inactive",
    "segment_type": "specific",
    "segment_value": "cust_acme",
    "evaluation": "per_customer",
})
test("Status 200", status == 200, f"got {status}: {data}")
if status == 200:
    test("Segment specific", data.get("segment_type") == "specific")
    test("Segment value cust_acme", data.get("segment_value") == "cust_acme")
    created_ids.append(data["id"])

# ── Validation: No Delivery Channel ──────────────────────────────────────
print("\n=== Validation: No Delivery Channel ===")
status, data = api("POST", "/alerts", {
    "name": "No delivery",
    "metric": "daily_cost",
    "operator": "gt",
    "threshold": 50,
})
test("Status 400", status == 400, f"got {status}")
test("Error mentions delivery", "delivery" in data.get("error", "").lower(), data.get("error", ""))

# ── Validation: Empty Name ───────────────────────────────────────────────
print("\n=== Validation: Empty Name ===")
status, data = api("POST", "/alerts", {
    "name": "",
    "metric": "daily_cost",
    "operator": "gt",
    "threshold": 50,
    "email": "test@example.com",
})
test("Status 400", status == 400, f"got {status}")

# ── List Rules ───────────────────────────────────────────────────────────
print("\n=== List Rules ===")
status, data = api("GET", "/alerts")
test("Status 200", status == 200, f"got {status}")
test("Has rules array", isinstance(data.get("rules"), list))
rules = data.get("rules", [])
test("3 rules created", len(rules) == 3, f"got {len(rules)}")
if rules:
    test("Most recent first", rules[0].get("name") == "Watch Acme", f"got: {rules[0].get('name')}")

# ── Toggle Disable ───────────────────────────────────────────────────────
print("\n=== Toggle Disable ===")
if created_ids:
    rule_id = created_ids[0]
    status, data = api("PATCH", f"/alerts/{rule_id}", {"enabled": False})
    test("Status 200", status == 200, f"got {status}")
    test("Disabled", data.get("enabled") is False)

# ── Toggle Enable ────────────────────────────────────────────────────────
print("\n=== Toggle Enable ===")
if created_ids:
    rule_id = created_ids[0]
    status, data = api("PATCH", f"/alerts/{rule_id}", {"enabled": True})
    test("Status 200", status == 200, f"got {status}")
    test("Enabled", data.get("enabled") is True)

# ── Update Threshold ─────────────────────────────────────────────────────
print("\n=== Update Threshold ===")
if created_ids:
    rule_id = created_ids[0]
    status, data = api("PATCH", f"/alerts/{rule_id}", {"threshold": 200})
    test("Status 200", status == 200, f"got {status}")
    test("Threshold updated", float(data.get("threshold", 0)) == 200)

# ── Update V2 Fields ─────────────────────────────────────────────────────
print("\n=== Update V2 Fields ===")
if len(created_ids) >= 2:
    rule_id = created_ids[1]
    status, data = api("PATCH", f"/alerts/{rule_id}", {
        "segment_type": "all",
        "segment_value": "",
    })
    test("Status 200", status == 200, f"got {status}")
    test("Segment updated to all", data.get("segment_type") == "all")

# ── Delete ───────────────────────────────────────────────────────────────
print("\n=== Delete ===")
if created_ids:
    rule_id = created_ids[0]
    status, data = api("DELETE", f"/alerts/{rule_id}")
    test("Status 200", status == 200, f"got {status}")
    test("Success true", data.get("success") is True)

    # Verify it's gone
    status, data = api("GET", "/alerts")
    remaining = [r for r in data.get("rules", []) if r["id"] == rule_id]
    test("Rule gone from list", len(remaining) == 0)

# ── Delete Nonexistent ───────────────────────────────────────────────────
print("\n=== Delete Nonexistent ===")
status, data = api("DELETE", "/alerts/99999")
test("Status 404", status == 404, f"got {status}")

# ── History ──────────────────────────────────────────────────────────────
print("\n=== Alert History ===")
status, data = api("GET", "/alerts/history")
test("Status 200", status == 200, f"got {status}")
test("Has history array", isinstance(data.get("history"), list))
test("Has total", "total" in data)

# ── History Count ────────────────────────────────────────────────────────
print("\n=== Alert History Count ===")
status, data = api("GET", "/alerts/history/count")
test("Status 200", status == 200, f"got {status}")
test("Has count", "count" in data)

# ── Cleanup: Delete remaining test rules ─────────────────────────────────
for rid in created_ids[1:]:
    api("DELETE", f"/alerts/{rid}")

# ── Summary ──────────────────────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"Results: {PASS} passed, {FAIL} failed out of {PASS + FAIL}")
print(f"{'='*50}")
sys.exit(1 if FAIL > 0 else 0)
