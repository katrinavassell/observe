# UX Audit Report - Tanso Pricing Analyzer

## Executive Summary

Audit of the Tanso SaaS pricing analytics application. Identified **4 broken functionalities** and **12 usability quick wins** that can significantly improve the user experience.

---

## 🔴 BROKEN FUNCTIONALITY (Critical)

### 1. Non-Functional CTA Buttons in Negative Margin Tab
**Location:** `src/pages/PricingPage.vue:711-717`

**Issue:** Two prominent buttons have no click handlers - they do nothing when clicked:
- "Become a Design Partner"
- "Learn More"

**Impact:** User clicks expecting action, nothing happens. Damages trust.

**Fix:** Add click handlers or remove buttons until functionality exists.

**Status: ✅ FIXED**
- "Become a Design Partner" now shows toast with contact email (kat@tansohq.com)
- "Learn More" now links to https://tansohq.com

---

### 2. Deceptive "Connect" Buttons for Integrations
**Location:** `src/pages/DataSourcesPage.vue:631-641, 863-866, 1152-1154, 1168-1170`

**Issue:** Connect buttons for Stripe, OpenAI, and Anthropic look fully functional but only show "coming soon" toast. Users expect real integration.

**Impact:** Frustrating user experience; wasted clicks.

**Fix:** Either:
- Style as disabled with "Coming Soon" label
- Replace with "Request Access" flow
- Remove until implemented

**Status: ✅ FIXED** - Buttons now show "Coming Soon" and are visually disabled

---

### 3. Sticky Progress Bar Positioning Bug
**Location:** `src/pages/DataSourcesPage.vue:1481`

**Issue:** Hardcoded `left-64` (256px) assumes sidebar is exactly 256px. If sidebar changes or on different breakpoints, bar misaligns.

```vue
<!-- Current -->
class="fixed bottom-0 left-64 right-0 ..."

<!-- Should use ml-64 on parent or CSS calc -->
```

**Impact:** Visual glitch where progress bar overlaps sidebar or has gap.

**Status: ✅ FIXED** - Changed to `ml-64 left-0` for proper positioning

---

### 4. MRR Movement Grid Breaks on Mobile
**Location:** `src/pages/PricingPage.vue:459`

**Issue:** 5-column grid with no responsive breakpoints:
```vue
<div class="grid grid-cols-5 gap-3">
```

**Impact:** Content squished/unreadable on mobile devices.

**Fix:** Add responsive breakpoints:
```vue
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
```

**Status: ✅ FIXED**

---

## 🟡 USABILITY QUICK WINS (High Impact)

### 5. Navigation Guard Only Offers "Discard" - No Save Option
**Location:** `src/pages/DataSourcesPage.vue:1515-1524`

**Issue:** When user tries to leave with unsaved changes, dialog only offers:
- Cancel (stay)
- Discard (lose data)

Missing: "Save and Leave" option.

**Impact:** Users must manually save, then navigate - extra steps.

**Recommendation:** Add third button: "Save and Continue"

**Status: ✅ FIXED** - Dialog now has "Stay", "Save & Leave", and "Discard" options

---

### 6. Confusing Duplicate Sample Data CTAs
**Location:** `src/pages/DataSourcesPage.vue`

**Issue:** Multiple ways to load sample data:
1. Hero "Try Sample Data" button (loads ALL sample data)
2. "Use sample data" links per section (loads just that section)

User doesn't know which does what.

**Fix:**
- Make hero CTA clearly say "Load Complete Demo Dataset"
- Section links: "Use sample [costs/usage]"

---

### 7. No Feedback When Clicking "Use sample data" Links
**Location:** `src/pages/DataSourcesPage.vue:1073-1078, 1244-1250, 1323-1329`

**Issue:** Small text links for "Use sample data" don't have visual disabled/loading states:
```vue
<button
  type="button"
  class="text-xs text-muted-foreground hover:text-foreground"
  :disabled="isLoadingRevenue"
  @click="handleUseSampleRevenue"
>
  {{ isLoadingRevenue ? 'Loading...' : 'Use sample data' }}
</button>
```

**Impact:** Users may double-click, unclear if action is happening.

**Fix:** Add disabled styling: `:class="{ 'opacity-50 cursor-not-allowed': isLoadingRevenue }"`

**Status: ✅ FIXED**

---

### 8. Tabs Hidden Without Explanation
**Location:** `src/pages/PricingPage.vue:253-254`

**Issue:** "Usage Anomalies" and "Negative Margin" tabs only appear when data exists. User sees 2 tabs but doesn't know others exist.

```vue
<TabsTrigger v-if="analysisResult.meta.hasUsageData" value="usage">Usage Anomalies</TabsTrigger>
<TabsTrigger v-if="analysisResult.meta.hasCostData" value="margin">Negative Margin</TabsTrigger>
```

**Recommendation:** Show tabs as disabled with tooltip: "Add usage data to unlock"

**Status: ✅ FIXED** - Tabs now show as disabled with explanatory tooltips

---

### 9. Login Page Has No "View Demo" Path
**Location:** `src/pages/LoginPage.vue`

**Issue:** Users at `/login` must authenticate. No way to see the product demo without signing up.

**Impact:** Potential users bounce at login gate.

**Fix:** Add "View Demo" link that loads sample data without auth (if business allows).

---

### 10. Integration Request Form Has No Validation
**Location:** `src/pages/DataSourcesPage.vue:1450-1455`

**Issue:** Plain input with no:
- Character limit display
- Format validation
- Required field indicator

**Fix:** Add placeholder text, max length, and validation feedback.

---

### 11. No "Clear All Data" Option
**Location:** `src/pages/DataSourcesPage.vue`

**Issue:** Users can only clear Revenue, Costs, Usage separately. No way to reset everything at once.

**Recommendation:** Add "Clear All Data" button in a settings/danger zone section.

---

### 12. Plan Health Table Columns Not Clearly Defined
**Location:** `src/pages/PricingPage.vue:506-580`

**Issue:** Table headers lack explanatory tooltips:
- "Health" - what does score mean?
- "Churn Risk" - how is it calculated?
- "Upsell Ready" - what qualifies?

**Fix:** Add info icons with tooltips to table headers (like the metric cards already have).

**Status: ✅ FIXED** - Added tooltips to Health, Churn Risk, and Upsell Ready columns

---

### 13. Progress Bar Shows Incomplete Even After Save
**Location:** `src/pages/DataSourcesPage.vue:583-593`

**Issue:** Progress checks both DB status AND local file state. If user loaded sample data, files show as "loaded" but with generic names like `customers.csv`.

The computed property logic is complex and can show incomplete status incorrectly.

---

### 14. Error States Not User-Friendly
**Location:** `src/pages/PricingPage.vue:156-159`

**Issue:** Error alert just shows raw error message:
```vue
<span class="font-medium">Error:</span> {{ error }}
```

**Recommendation:** Provide actionable next steps:
- "Try again" button
- "Contact support" if persistent
- Clear error context

**Status: ✅ FIXED** - Error alert now shows "Try Again" and "Dismiss" buttons

---

### 15. Sidebar Email Truncation Without Tooltip
**Location:** `src/layouts/AppLayout.vue:60-62`

**Issue:** Long emails get truncated but no way to see full email:
```vue
<div v-if="user" class="text-xs text-muted-foreground truncate">
  {{ user.email }}
</div>
```

**Fix:** Add `title` attribute or tooltip showing full email on hover.

**Status: ✅ FIXED** - Added `:title="user.email"` attribute

---

### 16. Button Inside router-link Creates Nested Interactive Elements
**Location:** `src/pages/PricingPage.vue:206-211`

**Issue:**
```vue
<router-link to="/data-sources">
  <Button size="lg">
    <Plug class="h-4 w-4 mr-2" />
    Connect Data
  </Button>
</router-link>
```

Nesting `<button>` inside `<a>` is an accessibility violation.

**Fix:** Use `@click` with `router.push()` or make Button a link variant.

**Status: ✅ FIXED** - Changed to `@click="router.push('/data-sources')"`

---

## Priority Matrix

| Issue | Impact | Effort | Priority |
|-------|--------|--------|----------|
| #1 Dead CTA buttons | High | Low | **P0** |
| #2 Deceptive Connect buttons | High | Low | **P0** |
| #4 MRR grid mobile | High | Low | **P0** |
| #3 Sticky bar position | Medium | Low | **P1** |
| #5 No save option on leave | High | Medium | **P1** |
| #7 Loading states on links | Medium | Low | **P1** |
| #16 Nested interactive elements | Medium | Low | **P1** |
| #6 Confusing sample data CTAs | Medium | Low | **P2** |
| #8 Hidden tabs no explanation | Medium | Medium | **P2** |
| #15 Email tooltip | Low | Low | **P2** |
| #12 Table header tooltips | Low | Low | **P2** |
| #9 No demo path | Medium | Medium | **P3** |
| #10 Form validation | Low | Low | **P3** |
| #11 Clear all data | Low | Medium | **P3** |

---

## Recommended Immediate Actions

1. **Fix dead buttons** (#1) - Either add handlers or remove
2. **Fix Connect button UX** (#2) - Show "Coming Soon" state properly
3. **Add mobile breakpoints** (#4) - Critical for mobile users
4. **Add loading states** (#7) - Quick CSS fix
5. **Fix nested interactive** (#16) - Accessibility compliance

---

*Audit conducted: 2025-12-31*
