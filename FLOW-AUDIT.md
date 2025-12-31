# Flow Mapping & Error Audit

## Overview

This document maps all user flows in Tanso, identifies happy paths and error paths, and prioritizes issues to fix.

---

## Flow 1: Authentication

### Happy Path
```
User enters email → Click "Send magic link" → Email sent → User clicks link → Redirected to /
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Email input | Empty email | `toast.error('Please enter your email')` | ✅ Good |
| Supabase OTP | Network error | `toast.error('Error', { description })` | ⚠️ Generic message |
| Supabase OTP | Invalid email format | Supabase error passed through | ⚠️ Technical error shown |
| Supabase OTP | Rate limited | Supabase error passed through | 🔴 No specific handling |

**Location:** `src/pages/LoginPage.vue:12-40`

---

## Flow 2: Load Sample Data (Full Dataset)

### Happy Path
```
Click "Load Complete Demo Dataset" → Progress shown → Data inserted → Redirect to /
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Auth check | Not authenticated | `throw new Error('Not authenticated')` | ✅ Caught and shown |
| Clear existing | DB error | Exception thrown | ⚠️ Partial data may remain |
| Insert plans | DB error | `throw plansError` | ⚠️ Raw Supabase error |
| Insert customers | DB error | `throw customersError` | ⚠️ Raw Supabase error |
| Insert subscriptions | DB error | `throw subsError` | ⚠️ Raw Supabase error |
| Insert usage | DB error | `throw usageError` | ⚠️ Raw Supabase error |
| Insert costs | DB error | `throw costsError` | ⚠️ Raw Supabase error |
| Update status | DB error | `throw statusError` | ⚠️ Data inserted but status wrong |

**Location:** `src/lib/supabase-data.ts:124-229`

**Critical Issue:** No transaction rollback - partial data can remain on failure.

---

## Flow 3: Upload Stripe CSV Files

### Happy Path
```
Drop/select CSV → Auto-detect type → Show in file list → Click "Reconcile Data" →
Show reconciliation report → Click "Continue to Analysis" → Data uploaded → Redirect to /
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| File drop | Non-CSV file | `toast.error('Please upload CSV files')` | ✅ Good |
| Parse CSV | Invalid CSV | `toast.error('Failed to parse CSV')` | ✅ Good |
| Detect type | Unknown headers | `toast.error('File type not recognized')` | ✅ Good |
| Reconcile | No subscriptions | Button disabled | ✅ Prevented |
| Reconcile | Internal error | `toast.error('Failed to reconcile data')` | ✅ Good |
| Auth check | Not authenticated | `throw new Error('Not authenticated')` | ✅ Caught |
| Upload | DB error | `uploadError.value = message` + toast | ✅ Shows error |
| Upload | Network timeout | No specific handling | 🔴 **No timeout handling** |

**Location:** `src/pages/DataSourcesPage.vue:185-334`

---

## Flow 4: Upload Cost CSV

### Happy Path
```
Drop/select CSV → Parse records → Upload to DB → Show success toast
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| File drop | Non-CSV file | `toast.error('Please upload a CSV file')` | ✅ Good |
| Parse CSV | Missing columns | `toast.error('No valid cost records found')` | ✅ Good |
| Parse CSV | Invalid data | Rows filtered out silently | ⚠️ **No feedback on skipped rows** |
| Auth check | Not authenticated | Exception thrown | ✅ Caught |
| Upload | DB error | `toast.error('Failed to upload costs data')` | ✅ Good |

**Location:** `src/pages/DataSourcesPage.vue:358-441`

---

## Flow 5: Upload Usage CSV

### Happy Path
```
Drop/select CSV → Parse records → Upload to DB → Show success toast
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| File drop | Non-CSV file | `toast.error('Please upload a CSV file')` | ✅ Good |
| Parse CSV | Missing columns | `toast.error('No valid usage records found')` | ✅ Good |
| Parse CSV | Invalid data | Rows filtered out silently | ⚠️ **No feedback on skipped rows** |
| Auth check | Not authenticated | Exception thrown | ✅ Caught |
| Upload | DB error | `toast.error('Failed to upload usage data')` | ✅ Good |

**Location:** `src/pages/DataSourcesPage.vue:358-441`

---

## Flow 6: Load Section-Specific Sample Data

### Happy Path (Revenue/Costs/Usage)
```
Click "Use sample [type]" → Insert data → Update status → Show success toast
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Auth check | Not authenticated | Exception thrown | ✅ Caught |
| Insert data | DB error | No error check on upsert! | 🔴 **Silent failure** |
| Update status | DB error | No error check on upsert! | 🔴 **Silent failure** |

**Location:** `src/lib/supabase-data.ts:248-382`

**Critical Issue:** `loadSampleRevenue`, `loadSampleCosts`, `loadSampleUsage` don't check for errors on upsert operations!

---

## Flow 7: Clear Data (Individual Sections)

### Happy Path
```
Remove file → Pending deletion flagged → Click "Save and Analyze" → Data cleared → Navigate to /
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Auth check | Not authenticated | Exception thrown | ✅ Caught |
| Delete records | DB error | No error check! | 🔴 **Silent failure** |
| Update status | DB error | No error check! | 🔴 **Silent failure** |

**Location:** `src/lib/supabase-data.ts:486-543`

**Critical Issue:** Clear functions don't check for DB errors!

---

## Flow 8: Navigate Away with Unsaved Changes

### Happy Path
```
Trigger navigation → Dialog shown → Choose option → Handle accordingly
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Save & Leave | DB error | `toast.error('Failed to save changes')` | ✅ Good |
| Save & Leave | Partial save | No rollback | ⚠️ Inconsistent state possible |

**Location:** `src/pages/DataSourcesPage.vue:749-779`

---

## Flow 9: View Pricing Analysis

### Happy Path
```
Navigate to / → Check for data → Load and analyze → Display results
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Fetch data | DB error | `error.value = message` | ✅ Shows error alert |
| Fetch data | No data | Show empty state | ✅ Good |
| Analyze | Invalid data | No try/catch on analyzeData | 🔴 **Unhandled exception** |

**Location:** `src/pages/PricingPage.vue:106-122`

---

## Flow 10: Request Integration

### Happy Path
```
Click "Request integration" → Enter name → Submit → Show success toast
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Empty input | Validation | Form disabled until valid | ✅ Good (after fix) |
| Auth check | Not authenticated | `toast.error('Please sign in first')` | ✅ Good |
| Submit | DB error | `toast.error('Failed to save request')` | ✅ Good |

**Location:** `src/pages/DataSourcesPage.vue:678-709`

---

## Flow 11: Notify Me (Coming Soon Integrations)

### Happy Path
```
Click "Notify me" → Save preference → Show confirmation
```

### Error Paths

| Step | Error | Current Handling | Issue |
|------|-------|------------------|-------|
| Auth check | Not authenticated | `toast.error('Please sign in first')` | ✅ Good |
| Upsert | DB error | `toast.error('Failed to save request')` | ✅ Good |

**Location:** `src/pages/DataSourcesPage.vue:651-672`

---

## Priority Matrix - Errors to Fix

### 🔴 P0 - Critical (Silent Failures / Data Corruption)

| Issue | Location | Impact | Status |
|-------|----------|--------|--------|
| **Silent upsert failures in sample data loaders** | `supabase-data.ts:266-303` | User thinks data loaded but it didn't | ✅ FIXED |
| **Silent delete failures in clear functions** | `supabase-data.ts:486-543` | User thinks data cleared but it wasn't | ✅ FIXED |
| **No rollback on partial sample data load** | `supabase-data.ts:124-229` | Partial/corrupt data state | ⚠️ Deferred (needs transaction) |
| **Unhandled analyzeData exception** | `PricingPage.vue:112` | White screen / crash | ✅ FIXED |

### 🟡 P1 - Important (Poor UX)

| Issue | Location | Impact | Status |
|-------|----------|--------|--------|
| **No feedback on skipped CSV rows** | `DataSourcesPage.vue:384-425` | User doesn't know data was skipped | ✅ FIXED |
| **Raw Supabase errors shown** | Multiple | Technical errors confuse users | Remaining |
| **No network timeout handling** | Upload flows | Infinite loading on network issues | Remaining |
| **Rate limit not handled** | `LoginPage.vue` | Confusing error message | Remaining |

### 🟢 P2 - Nice to Have

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| Generic "Unknown error" fallback | Multiple | Unhelpful error message | Improve fallback messages |
| No retry mechanism | API calls | User must manually retry | Add auto-retry for transient errors |

---

## Recommended Fixes

### Fix 1: Add error checks to sample data loaders

```typescript
// loadSampleRevenue, loadSampleCosts, loadSampleUsage
const { error } = await supabase.from('plans').upsert(plans, {...})
if (error) throw new Error(`Failed to load sample data: ${error.message}`)
```

### Fix 2: Add error checks to clear functions

```typescript
// clearCostData, clearUsageData, clearRevenueData
const { error } = await supabase.from('cost_records').delete().eq('user_id', user.id)
if (error) throw new Error(`Failed to clear data: ${error.message}`)
```

### Fix 3: Wrap analyzeData in try/catch

```typescript
try {
  analysisResult.value = analyzeData(data)
} catch (err) {
  error.value = 'Failed to analyze data. Please try uploading again.'
}
```

### Fix 4: Show skipped row warnings

```typescript
const validRecords = rows.filter(r => r.month && r.cost)
const skippedCount = rows.length - validRecords.length
if (skippedCount > 0) {
  toast.warning(`${skippedCount} rows skipped`, {
    description: 'Some rows were missing required fields'
  })
}
```

---

*Audit conducted: 2025-12-31*
