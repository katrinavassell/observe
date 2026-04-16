"""
E2E UI tests for the Alerts page.
Requires: dev server running on port 5004 (npm run dev)
Run: python3 tests/e2e/alerts-ui.py
"""

import sys
from playwright.sync_api import sync_playwright

PASS = 0
FAIL = 0


def test(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS: {name}")
    else:
        FAIL += 1
        print(f"  FAIL: {name} — {detail}")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1200, "height": 900})

    # ── Empty State ──────────────────────────────────────────────────────
    print("\n=== Empty State ===")
    page.goto("http://localhost:5004/alerts")
    page.wait_for_load_state("networkidle")

    test("Page title", page.locator("h1").text_content() == "Alerts")
    test(
        "Subtitle",
        "costs spike" in page.locator("h1 + p").text_content(),
    )
    test("Empty message", page.locator("text=No alerts configured").is_visible())
    test(
        "New Alert button visible",
        page.locator('button:has-text("New Alert")').count() >= 1,
    )

    # ── Step 1: Trigger Picker ───────────────────────────────────────────
    print("\n=== Step 1: Trigger Picker ===")
    page.click('button:has-text("New Alert")')
    page.wait_for_timeout(300)

    test("Step counter", page.locator("text=Step 1 of 2").is_visible())
    test("Question text", page.locator("text=What do you want to watch?").is_visible())

    # Global triggers (4)
    test("Daily cost too high", page.locator("text=Daily cost too high").is_visible())
    test("Overall margin too low", page.locator("text=Overall margin too low").is_visible())
    test("Customer margin too low", page.locator("text=Customer margin too low").is_visible())
    test(
        "Single customer dominates cost",
        page.locator("text=Single customer dominates cost").is_visible(),
    )

    # Per-customer triggers (5)
    test("Customer usage declining", page.locator("text=Customer usage declining").is_visible())
    test("Customer usage growing", page.locator("text=Customer usage growing").is_visible())
    test("Customer losing money", page.locator("text=Customer losing money").is_visible())
    test("Customer gone quiet", page.locator("text=Customer gone quiet").is_visible())
    test("Customer cost spiking", page.locator("text=Customer cost spiking").is_visible())

    # Removed triggers should NOT be present
    test(
        "No usage velocity",
        not page.locator("text=Usage velocity").is_visible(),
    )
    test(
        "No model cost increase",
        not page.locator("text=Model cost increase").is_visible(),
    )
    test("No operator dropdown", page.locator("select").count() == 0)

    # Section headers
    test("Global section", page.locator("text=Global").first.is_visible())
    test("Per customer section", page.locator("text=Per customer").first.is_visible())

    # ── Step 2: Global Trigger (above) ───────────────────────────────────
    print("\n=== Step 2: Global Trigger (Daily Cost) ===")
    page.click("text=Daily cost too high")
    page.wait_for_timeout(300)

    test("Step 2 shown", page.locator("text=Step 2 of 2").is_visible())
    test("Direction 'above'", page.locator("text=Alert when above").is_visible())

    # $ prefix for dollar metric
    test("Dollar prefix", page.locator("text=$").first.is_visible())

    # Default threshold
    threshold_val = page.locator("#alert-threshold").input_value()
    test("Default threshold 100", threshold_val == "100", f"got {threshold_val}")

    # No segment picker for global
    test(
        "No segment picker",
        not page.locator("text=Which customers?").is_visible(),
    )

    # Cooldown presets
    test("1 hour preset", page.locator('button:has-text("1 hour")').is_visible())
    test("4 hours preset", page.locator('button:has-text("4 hours")').is_visible())
    test("1 day preset", page.locator('button:has-text("1 day")').is_visible())

    # Auto-generated name
    name_val = page.locator("#alert-name").input_value()
    test("Auto name has 'Daily cost'", "Daily cost" in name_val, f"got: {name_val}")

    # Delivery fields
    test(
        "Email placeholder",
        page.locator('input[placeholder="Email address"]').is_visible(),
    )
    test(
        "Webhook placeholder",
        page.locator('input[placeholder="Webhook URL (Slack-compatible)"]').is_visible(),
    )

    # Create/Back buttons
    test("Create button", page.locator('button:has-text("Create Alert")').is_visible())
    test("Back button", page.locator('button:has-text("Back")').is_visible())

    # ── Step 2: Below-Direction (Margin) ─────────────────────────────────
    print("\n=== Step 2: Below-Direction Trigger (Margin) ===")
    page.click("text=Back")
    page.wait_for_timeout(300)
    page.click("text=Overall margin too low")
    page.wait_for_timeout(300)

    test("Direction 'below'", page.locator("text=Alert when below").is_visible())
    test("% suffix", page.locator("span:has-text('%')").is_visible())
    threshold_val = page.locator("#alert-threshold").input_value()
    test("Default threshold 40", threshold_val == "40", f"got {threshold_val}")

    # Tanso upsell should NOT show for margin_percent (not in TANSO_UPSELLS)
    test(
        "No upsell for margin_percent",
        not page.locator("text=Tanso can automate").is_visible(),
    )

    # ── Step 2: Per-Customer Trigger ─────────────────────────────────────
    print("\n=== Step 2: Per-Customer Trigger (Inactive) ===")
    page.click("text=Back")
    page.wait_for_timeout(300)
    page.click("text=Customer gone quiet")
    page.wait_for_timeout(300)

    test("Segment picker visible", page.locator("text=Which customers?").is_visible())
    test("All customers option", page.locator("text=All customers").is_visible())
    test("Cohort option", page.locator("label:has-text('Cohort')").is_visible())
    test("Specific customer option", page.locator("text=Specific customer").is_visible())

    threshold_val = page.locator("#alert-threshold").input_value()
    test("Default threshold 14", threshold_val == "14", f"got {threshold_val}")
    test("Days unit", page.locator("span:has-text('days')").is_visible())

    # ── Cohort Picker ────────────────────────────────────────────────────
    print("\n=== Cohort Picker ===")
    page.click("label:has-text('Cohort')")
    page.wait_for_timeout(300)

    test("Unprofitable label", page.locator("text=Unprofitable").first.is_visible())
    test(
        "Unprofitable description",
        page.locator("text=Cost exceeds revenue").is_visible(),
    )
    test("Champion label", page.locator("text=Champion").is_visible())
    test(
        "Champion description",
        page.locator("text=High usage, healthy margin").is_visible(),
    )
    test("At Risk label", page.locator("text=At Risk").is_visible())
    test("Healthy label", page.locator("span:has-text('Healthy')").first.is_visible())

    # ── Specific Customer ────────────────────────────────────────────────
    print("\n=== Specific Customer ===")
    page.click("label:has-text('Specific customer')")
    page.wait_for_timeout(300)

    test(
        "Customer ID input",
        page.locator('input[placeholder*="cust_abc123"]').is_visible(),
    )

    # ── Cancel ───────────────────────────────────────────────────────────
    print("\n=== Cancel ===")
    page.click("text=Cancel")
    page.wait_for_timeout(300)

    test("Form hidden after cancel", not page.locator("text=Step 1 of 2").is_visible())
    test(
        "New Alert button returns",
        page.locator('button:has-text("New Alert")').first.is_visible(),
    )

    # ── Auto-Name Updates on Threshold Change ────────────────────────────
    print("\n=== Auto-Name on Threshold Change ===")
    page.locator('button:has-text("New Alert")').first.click()
    page.wait_for_timeout(300)
    page.click("text=Daily cost too high")
    page.wait_for_timeout(300)

    # Change threshold
    page.locator("#alert-threshold").fill("250")
    page.wait_for_timeout(300)
    name_val = page.locator("#alert-name").input_value()
    test("Name updates to 250", "250" in name_val, f"got: {name_val}")

    # ── Cooldown Toggle ──────────────────────────────────────────────────
    print("\n=== Cooldown Toggle ===")
    page.click('button:has-text("4 hours")')
    page.wait_for_timeout(200)

    # The 4 hours button should now have the active class (bg-foreground)
    four_hr_classes = page.locator('button:has-text("4 hours")').get_attribute("class")
    test("4h active", "bg-foreground" in (four_hr_classes or ""), f"class: {four_hr_classes}")

    # ── Validation: No Delivery Channel ──────────────────────────────────
    print("\n=== Validation: No Delivery Channel ===")
    page.click('button:has-text("Create Alert")')
    page.wait_for_timeout(500)
    # Toast appears with error — check it exists in the DOM
    toast_visible = page.locator("[data-sonner-toast]").count() > 0
    test("Toast error shown", toast_visible)

    # ── Tanso Upsell ─────────────────────────────────────────────────────
    print("\n=== Tanso Upsell ===")
    page.click("text=Back")
    page.wait_for_timeout(300)
    page.click("text=Customer margin too low")
    page.wait_for_timeout(300)

    test(
        "Upsell for customer_margin",
        page.locator("text=Tanso can automate").is_visible(),
    )
    test(
        "Upsell CTA",
        page.locator("text=Learn more").is_visible(),
    )

    # Check concentration trigger too
    page.click("text=Back")
    page.wait_for_timeout(300)
    page.click("text=Single customer dominates cost")
    page.wait_for_timeout(300)
    test(
        "Upsell for concentration",
        page.locator("text=concentration risk limits").is_visible(),
    )

    browser.close()

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"\n{'='*50}")
    print(f"Results: {PASS} passed, {FAIL} failed out of {PASS + FAIL}")
    print(f"{'='*50}")
    sys.exit(1 if FAIL > 0 else 0)
