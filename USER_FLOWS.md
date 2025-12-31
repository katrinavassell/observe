# User Flows - Tanso Analytics Dashboard

## Overview

Tanso is a SaaS revenue analytics and pricing intelligence dashboard built with Vue 3 + TypeScript. This document outlines all user flows including happy paths, error paths, and audit findings.

---

## 1. Authentication Flow

### Entry Points
- `/login` - Login page (public)
- All other routes redirect to `/login` if not authenticated

### Happy Path: Magic Link Sign-In

```
1. User visits app → Redirected to /login (if unauthenticated)
2. User enters email in form
3. Click "Send magic link" button
4. Supabase sends OTP email via signInWithOtp()
5. UI shows success state: "Check your email"
6. User clicks link in email
7. Redirected back to app with session token
8. Auth state updates via onAuthStateChange()
9. Router guard allows access to / (PricingPage)
```

**Code Location:** `src/pages/LoginPage.vue:12-40`, `src/composables/useAuth.ts`

### Error Paths

| Error Case | Trigger | Handler | User Feedback |
|------------|---------|---------|---------------|
| Empty email | Submit without email | `LoginPage.vue:13-16` | Toast: "Please enter your email" |
| Invalid email format | Malformed email | HTML5 `required` validation | Browser native validation |
| Supabase error | Network/API failure | `LoginPage.vue:34-36` | Toast with error message |
| Rate limiting | Too many requests | Supabase error | Toast: error.message |

### Audit Findings

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| No email validation | Low | `LoginPage.vue:90-97` | Only HTML5 `type="email"` validation, no format check in code |
| Session race condition | Medium | `router.ts:52-73` | Double `getSession()` call when visiting /login while authenticated |
| No loading state on redirect | Low | `LoginPage.vue` | No feedback during magic link redirect processing |

---

## 2. Data Sources Flow (Onboarding)

### Entry Point
- `/data-sources` - DataSourcesPage

### Happy Path: Sample Data

```
1. User visits /data-sources
2. Click "Try Sample Data" button
3. Loading state: button shows "Loading..."
4. loadSampleDataToSupabase() called
5. Clears existing data, inserts sample:
   - 30 customers across 4 plans
   - 6 months of cost records
   - Usage records with limits
6. refetchDataMode() updates status
7. Toast: "Sample data loaded!"
8. Sticky footer appears with progress checkmarks
```

**Code Location:** `src/pages/DataSourcesPage.vue:118-151`

### Happy Path: Stripe CSV Upload

```
1. User drops CSV files or clicks dropzone
2. Files parsed with Papa.parse
3. detectStripeFileType() identifies file type by headers:
   - customers.csv → parseStripeCustomers()
   - subscriptions.csv → parseStripeSubscriptions()
   - invoices.csv → parseStripeInvoices() (optional)
4. Toast shows count: "X customers/subscriptions found"
5. Click "Reconcile Data" button
6. reconcileStripeData() joins data:
   - Matches subscriptions to customers
   - Calculates MRR
   - Identifies orphaned subscriptions
   - Counts active/canceled
7. Shows reconciliation report with:
   - Customer count
   - Subscriptions matched %
   - Orphaned subscriptions warning
   - Calculated MRR
8. Click "Continue to Analysis"
9. uploadStripeData() saves to Supabase
10. Redirect to / (PricingPage)
```

**Code Location:** `src/pages/DataSourcesPage.vue:163-334`, `src/lib/stripe-import.ts`

### Happy Path: Costs CSV Upload

```
1. User drops costs.csv in AI Costs section
2. File parsed with Papa.parse
3. Records filtered: must have month + cost columns
4. uploadCostData() saves to Supabase:
   - Clears existing cost_records
   - Inserts new records
   - Updates user_data_status
5. Toast: "Costs uploaded! X records saved"
6. Progress bar updates
```

**Code Location:** `src/pages/DataSourcesPage.vue:358-441`

### Happy Path: Usage CSV Upload

```
1. User drops usage.csv in Usage section
2. File parsed with Papa.parse
3. Records filtered: must have month, customer_id, metric, value
4. uploadUsageData() saves to Supabase
5. Toast: "Usage uploaded! X records saved"
```

### Error Paths

| Error Case | Trigger | Handler | User Feedback |
|------------|---------|---------|---------------|
| Non-CSV file | Wrong file type | `DataSourcesPage.vue:186-189` | Toast: "Please upload CSV files" |
| Unknown Stripe file | Unrecognized headers | `DataSourcesPage.vue:223-227` | Toast: "File type not recognized" |
| CSV parse error | Malformed CSV | `DataSourcesPage.vue:228-232` | Toast: "Failed to parse CSV" |
| Empty costs file | No valid records | `DataSourcesPage.vue:393-398` | Toast: "No valid cost records found" |
| Empty usage file | No valid records | `DataSourcesPage.vue:419-424` | Toast: "No valid usage records found" |
| Not authenticated | Session expired | Upload functions | Error: "Not authenticated" |
| Supabase error | Database failure | Upload functions | Toast with error message |
| Upload failure | Network/DB error | `DataSourcesPage.vue:326-330` | Toast + uploadError displayed |

### Unsaved Changes Warning

```
1. User uploads files but doesn't save
2. Attempts to navigate away
3. onBeforeRouteLeave() intercepts
4. ConfirmDialog appears: "Discard changes?"
5. Cancel → stay on page
6. Confirm → discard data, navigate
```

**Code Location:** `src/pages/DataSourcesPage.vue:711-760`

### Audit Findings

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| Silent delete on sample load | Medium | `supabase-data.ts:131` | `clearUserData()` called without confirmation |
| No upload progress indicator | Low | `DataSourcesPage.vue` | Large files have no progress feedback |
| Race condition on rapid clicks | Medium | Multiple upload handlers | No debouncing on upload buttons |
| Error state not cleared | Low | `DataSourcesPage.vue:96` | `uploadError` persists until new upload |
| Memory leak potential | Low | `DataSourcesPage.vue:69-71` | File input refs not cleaned on unmount |

---

## 3. Pricing Analysis Flow

### Entry Point
- `/` - PricingPage (home)

### Happy Path: View Analysis

```
1. User visits / (authenticated)
2. onMounted checks hasData.value
3. If data exists: loadExistingData()
   - fetchAnalyzerData() gets all records
   - analyzeData() calculates metrics
   - analysisComplete = true
4. Dashboard renders with:
   - Hero metrics (ARR, MRR, Costs, Margin)
   - Secondary metrics (Customers, ARPU, NRR, LTV)
   - MRR Movement breakdown
   - Tabbed views (SaaS, Plan Health, Usage, Margin)
```

**Code Location:** `src/pages/PricingPage.vue:128-140`

### Happy Path: Empty State

```
1. User visits / with no data
2. hasData.value === false
3. Empty state card displays:
   - Features list
   - "Connect Data" button → /data-sources
   - "Try Sample Data" button
4. Click sample data:
   - loadSampleData() runs
   - Progress bar animates
   - Analysis displays on completion
```

**Code Location:** `src/pages/PricingPage.vue:154-229`

### Happy Path: Query Parameter Loading

```
1. User redirected with ?loadSample=true
2. onMounted detects query param
3. router.replace({ query: {} }) clears param
4. loadSampleData() auto-triggers
```

**Code Location:** `src/pages/PricingPage.vue:129-134`

### Error Paths

| Error Case | Trigger | Handler | User Feedback |
|------------|---------|---------|---------------|
| Data fetch failure | Network/DB error | `PricingPage.vue:98-100` | Alert with error message |
| Analysis failure | Invalid data | `PricingPage.vue:117-118` | Alert with error message |

### Audit Findings

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| No retry on fetch failure | Medium | `PricingPage.vue:106-122` | Single attempt, no recovery option |
| Stale data possible | Low | `PricingPage.vue` | No auto-refresh mechanism |
| Progress stuck at 90% | Low | `PricingPage.vue:76-78` | Interval cleared but can exceed 100ms timing |

---

## 4. Sign Out Flow

### Happy Path

```
1. User clicks "Sign out" in sidebar
2. signOut() called
3. supabase.auth.signOut() clears session
4. router.push('/login') navigates
5. Auth state clears via onAuthStateChange()
```

**Code Location:** `src/composables/useAuth.ts:55-59`

### Error Paths

| Error Case | Trigger | Handler | User Feedback |
|------------|---------|---------|---------------|
| Sign out fails | Network error | Error thrown | Unhandled - user stays logged in |

### Audit Findings

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| Unhandled sign-out error | Medium | `useAuth.ts:55-59` | Error thrown but not caught in UI |

---

## 5. Integration Request Flow

### Happy Path: Notify Me

```
1. User clicks "Notify me" on integration (Salesforce, HubSpot, etc.)
2. handleNotifyMe() called
3. Upsert to integration_requests table
4. requestedIntegrations.add(integration)
5. Button changes to "On the list"
6. Toast: "We'll let you know when X is ready"
```

**Code Location:** `src/pages/DataSourcesPage.vue:651-672`

### Happy Path: Custom Request

```
1. User clicks "Request integration"
2. showRequestForm = true
3. User enters integration name
4. Click "Submit Request"
5. Insert to integration_requests table
6. Form closes, toast shown
```

**Code Location:** `src/pages/DataSourcesPage.vue:674-709`

### Error Paths

| Error Case | Trigger | Handler | User Feedback |
|------------|---------|---------|---------------|
| Not authenticated | Session expired | `DataSourcesPage.vue:654-657` | Toast: "Please sign in first" |
| Empty integration | Submit empty form | `DataSourcesPage.vue:679-682` | Toast: "Please enter which integration you need" |
| DB error | Insert fails | `DataSourcesPage.vue:671` | Toast: "Failed to save request" |

---

## 6. Template Download Flow

### Happy Path

```
1. User clicks "Download template" (costs or usage)
2. downloadTemplate() creates Blob with CSV content
3. Creates <a> element with download attribute
4. Triggers click(), revokes URL
5. Toast: "X template downloaded"
```

**Code Location:** `src/pages/DataSourcesPage.vue:526-567`

---

## Security Audit Findings

### Authentication

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| No session timeout | Low | Consider adding idle timeout |
| No multi-tab sync | Low | Auth state shared via refs but no cross-tab events |
| Double session check | Low | `router.ts:56,66` - Optimize to single check |

### Data Access

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| User ID filtering good | - | All queries include `.eq('user_id', user.id)` |
| RLS assumed | - | Database should have Row Level Security enabled |
| No input sanitization | Medium | CSV parsing accepts any content |

### Error Handling

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| Inconsistent error handling | Medium | Some functions throw, some return, some toast |
| Console.error in production | Low | `useDataMode.ts:104` - Should use proper logging |
| Error messages exposed | Low | Raw Supabase errors shown to users |

---

## Improvements Implemented

The following improvements have been implemented based on the audit findings:

### High Priority (Completed)

1. **Sign-out error handling** (`useAuth.ts:55-71`) - Sign-out now gracefully handles errors and always clears local state
2. **Retry logic for data fetch** (`PricingPage.vue:106-137`) - Automatic retry with exponential backoff (up to 2 retries)
3. **Confirmation for sample data** (`DataSourcesPage.vue:119-131, 1542-1552`) - Confirmation dialog when replacing existing data

### Medium Priority (Completed)

4. **Email format validation** (`LoginPage.vue:12-17`) - Regex validation beyond HTML5 native
5. **Debouncing/duplicate prevention** (`DataSourcesPage.vue:134, 287, 313, 391`) - Guards on all async handlers
6. **Router optimization** (`router.ts:51-71`) - Single session check instead of double call
7. **Error state clearing** - Error states cleared at start of operations

### Additional Improvements (Completed)

8. **Logger utility** (`lib/logger.ts`) - Centralized logging with dev/prod awareness
9. **Error sanitization** (`lib/logger.ts:sanitizeErrorForUser`) - User-friendly error messages
10. **Vue error handler** (`main.ts:20-35`) - Global error boundary for uncaught Vue errors
11. **Cross-tab session sync** (`useAuth.ts:12-58`) - BroadcastChannel API for multi-tab auth sync

### Still Recommended

12. **Add upload progress** - For large CSV files (low priority)
