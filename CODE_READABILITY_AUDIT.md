# Code Readability & Organization Audit

**Project:** Tanso - Revenue Analytics Dashboard
**Audit Date:** December 2024
**Codebase Size:** ~11,000 lines across 61 source files

---

## Overall Score: 72/100 (Good)

| Category | Score | Grade |
|----------|-------|-------|
| File Organization | 85/100 | A |
| Naming Conventions | 80/100 | B+ |
| Code Documentation | 55/100 | D+ |
| Code Modularity | 65/100 | C |
| Type Safety | 88/100 | A |
| Consistency | 75/100 | B |
| Error Handling | 60/100 | D |
| Maintainability | 70/100 | B- |

---

## Detailed Analysis

### 1. File Organization (85/100) - Excellent

**Strengths:**
- Clear directory structure with logical separation: `pages/`, `components/`, `composables/`, `lib/`, `api/`
- UI components properly organized with subdirectories for complex components (`tabs/`, `tooltip/`)
- Barrel exports in `components/ui/index.ts` provide clean public API
- Configuration files well organized at root level

**Areas for Improvement:**
- Consider creating a `types/` directory for shared type definitions (currently scattered across files)
- The `lib/` directory has 7 files with mixed responsibilities - could benefit from subdirectories

**Example of good organization:**
```
src/components/ui/
├── index.ts          # Clean barrel exports
├── button.vue
├── card.vue
├── tabs/
│   ├── index.ts
│   └── tabs.vue (etc.)
```

---

### 2. Naming Conventions (80/100) - Good

**Strengths:**
- Consistent PascalCase for Vue components (`PricingPage.vue`, `AccountDetailPanel.vue`)
- Consistent camelCase for TypeScript files (`pricing-analyzer.ts`, `supabase-data.ts`)
- Function names are descriptive (`calculateMRR`, `analyzeUsageAnomalies`)
- Interface names clearly describe their purpose (`RevenueAnalytics`, `PlanHealth`)

**Areas for Improvement:**
- Some inconsistency in ref naming (e.g., `stripeFileInput` vs `costsFileInput`)
- Missing prefix conventions for private/internal functions
- Boolean refs could use `is`/`has` prefix consistently

**Examples:**
```typescript
// Good
const isLoading = ref(true)
const hasUnsavedChanges = ref(false)

// Inconsistent - could be named `isLoadingRevenue`
const isLoadingRevenue = ref(false)
const isLoadingCosts = ref(false)
const isLoadingUsage = ref(false)
```

---

### 3. Code Documentation (55/100) - Needs Improvement

**Strengths:**
- Section delimiters in large files help navigation:
  ```typescript
  // =============================================================================
  // STATE
  // =============================================================================
  ```
- File-level comments in some files (`pricing-analyzer.ts`, `supabase-data.ts`)

**Critical Gaps:**
- **No JSDoc comments** on exported functions - makes IDE support and API discovery harder
- **No inline comments** explaining business logic (e.g., why `previousMargin = 66`?)
- **Magic numbers** throughout without explanation
- Missing README for `src/` directory structure

**Examples of missing documentation:**
```typescript
// src/lib/pricing-analyzer.ts:919-925
// What is the significance of 66? Why is this hardcoded?
const previousMargin = 66 // July margin from PRD

// This should be:
/**
 * Historical margin baseline from July PRD analysis.
 * Used as reference point for margin trend calculations.
 */
const BASELINE_MARGIN_JULY = 66
```

**Recommended improvements:**
```typescript
/**
 * Calculates Monthly Recurring Revenue from active subscriptions.
 * Uses mrr_override if provided, otherwise calculates from plan price.
 *
 * @param subscriptions - List of subscription records
 * @param plans - List of available plans with pricing
 * @returns Total MRR across all active subscriptions
 */
export function calculateMRR(subscriptions: Subscription[], plans: Plan[]): number {
  // ...
}
```

---

### 4. Code Modularity (65/100) - Moderate

**Strengths:**
- Composables pattern (`useAuth`, `useDataMode`) for state management
- Separation between API client and business logic
- Reusable UI components

**Critical Issues:**
- **Large page components:**
  - `DataSourcesPage.vue`: **1,526 lines** - far too long
  - `PricingPage.vue`: **735 lines** - should be split

- **Long functions:**
  - `calculatePlanHealth()`: 140 lines
  - `analyzeUsageAnomalies()`: 130 lines
  - These should be broken into smaller, focused functions

**Recommendations:**
```
DataSourcesPage.vue (1,526 lines) should be split into:
├── DataSourcesPage.vue (~200 lines) - orchestration
├── RevenueSection.vue (~300 lines)
├── CostsSection.vue (~200 lines)
├── UsageSection.vue (~200 lines)
├── ComingSoonSection.vue (~100 lines)
└── composables/useStripeUpload.ts (~300 lines)
```

---

### 5. Type Safety (88/100) - Excellent

**Strengths:**
- Full TypeScript with strict mode enabled
- Comprehensive interface definitions
- Good use of discriminated unions (`'up' | 'down' | 'neutral'`)
- Proper typing of Vue refs and computed properties

**Minor Issues:**
- Some `any` types could be more specific
- Some `unknown` types in error handling could be narrowed

**Example of good typing:**
```typescript
export interface TrendData {
  current: number
  previous: number
  change_amount: number
  change_percent: number
  direction: 'up' | 'down' | 'neutral'  // Good discriminated union
}
```

---

### 6. Consistency (75/100) - Good

**Strengths:**
- Consistent Vue 3 Composition API usage
- Consistent import ordering (Vue, third-party, local)
- Consistent use of `@/` path alias

**Inconsistencies Found:**
- Error handling varies between throw/catch patterns
- Some functions return `Promise<void>`, others return results
- Async function patterns not always consistent

**Examples of inconsistency:**
```typescript
// In api/client.ts - returns data or throws
export async function getRevenueAnalytics(): Promise<RevenueAnalytics> {
  return request('/analytics/revenue')
}

// In lib/supabase-data.ts - returns null on error
export async function fetchAnalyzerData(): Promise<AnalyzerData | null> {
  if (!user) return null  // Silent fail
  // ...
}
```

---

### 7. Error Handling (60/100) - Needs Work

**Issues:**
- Inconsistent error handling strategies
- Some errors silently ignored (e.g., `console.error` only)
- Missing error boundaries for Vue components
- No centralized error handling/reporting

**Examples of poor error handling:**
```typescript
// src/composables/useAuth.ts:24
} catch (error) {
  console.error('Failed to get session:', error)
  // Error is swallowed - user has no feedback
}

// src/composables/useDataMode.ts:34-46
} catch (error) {
  console.error('Failed to fetch data status:', error)
  // Returns default object, hiding the error from callers
  dataStatus.value = { data_mode: 'none', ... }
}
```

**Recommended pattern:**
```typescript
try {
  await loadData()
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  toast.error('Failed to load data', { description: message })
  throw error  // Re-throw for upstream handling
}
```

---

### 8. Maintainability (70/100) - Moderate

**Strengths:**
- Modern Vue 3 patterns are used
- Dependencies are current and well-chosen
- Build configuration is standard and well-documented

**Issues:**
- **No tests** - critical gap for maintainability
- **No contribution guidelines**
- **Complex business logic** not well-documented
- **Duplicate code patterns** for handling different data types

**Duplication example** (DataSourcesPage.vue):
```typescript
// Very similar code repeated for costs, usage, revenue
async function handleUseSampleData(type: 'costs' | 'usage') {
  const loadingRefs = { costs: isLoadingCosts, usage: isLoadingUsage }
  const loaders = { costs: loadSampleCosts, usage: loadSampleUsage }
  // ... nearly identical logic
}
```

---

## Priority Improvements

### Critical (Should address immediately)

1. **Break up large components**
   - `DataSourcesPage.vue` (1,526 lines) into 5-6 smaller components
   - Extract complex logic into composables

2. **Add JSDoc documentation**
   - Focus on exported functions in `lib/` directory
   - Document public API in `api/client.ts`

3. **Document magic numbers**
   - Create named constants with comments explaining business context
   - Example: `const BASELINE_MARGIN_JULY = 66`

### Important (Should address soon)

4. **Centralize type definitions**
   - Create `src/types/` directory
   - Move shared interfaces (Account, Subscription, etc.) there

5. **Standardize error handling**
   - Create error handling utilities
   - Implement consistent patterns across all async operations

6. **Add inline comments for complex logic**
   - Focus on `pricing-analyzer.ts` business calculations
   - Explain usage trend detection algorithms

### Nice-to-have

7. **Create README for src/ directory**
   - Document folder structure
   - Explain component patterns

8. **Add testing infrastructure**
   - Set up Vitest for unit tests
   - Add component tests with Vue Test Utils

---

## Code Smells Identified

| Location | Issue | Severity |
|----------|-------|----------|
| `DataSourcesPage.vue` | 1,526 lines - too long | High |
| `PricingPage.vue` | 735 lines - should split | Medium |
| `pricing-analyzer.ts:919` | Magic number `66` | Medium |
| `supabase-data.ts:192-196` | Hardcoded customer costs | Medium |
| `calculatePlanHealth()` | 140 line function | Medium |
| `useDataMode.ts:34` | Silent error swallowing | Medium |
| `api/client.ts` | No JSDoc on 30+ functions | Low |

---

## Positive Patterns to Keep

1. **Section delimiters** - Good use of visual separators
2. **Composables pattern** - Clean state management
3. **Barrel exports** - UI component organization
4. **TypeScript strictness** - Enforced type safety
5. **Vue Query** - Good async state management choice
6. **Path aliases** - Clean import statements with `@/`

---

## Summary

The codebase demonstrates solid foundational patterns with Vue 3 + TypeScript, but has grown organically without sufficient attention to documentation and modularity. The main concerns are:

1. **Large components** that should be split
2. **Missing documentation** that hinders onboarding
3. **Inconsistent error handling** that could cause user-facing issues
4. **Magic numbers** that make business logic opaque

Addressing the Critical and Important items would significantly improve maintainability and bring the overall score to ~82/100.
