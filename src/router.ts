import { createRouter, createWebHistory } from 'vue-router'
import { getDataStatus } from '@/api/client'

// Cache the data status check
let dataStatusCache: { hasData: boolean; timestamp: number } | null = null
const CACHE_TTL = 5000 // 5 seconds

async function checkHasData(): Promise<boolean> {
  const now = Date.now()
  if (dataStatusCache && now - dataStatusCache.timestamp < CACHE_TTL) {
    return dataStatusCache.hasData
  }

  try {
    const status = await getDataStatus()
    dataStatusCache = { hasData: status.has_data, timestamp: now }
    return status.has_data
  } catch {
    // If API fails, assume we have data to avoid redirect loop
    return true
  }
}

// Clear cache when needed (e.g., after loading sample data)
export function clearDataStatusCache() {
  dataStatusCache = null
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Onboarding routes (no layout wrapper)
    {
      path: '/onboarding',
      name: 'onboarding',
      component: () => import('@/pages/OnboardingScreen.vue'),
      meta: { skipDataCheck: true },
    },
    {
      path: '/onboarding/upload',
      name: 'upload-wizard',
      component: () => import('@/components/onboarding/UploadWizard.vue'),
      meta: { skipDataCheck: true },
    },
    // Main app routes
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: () => import('@/pages/AccountsPage.vue'),
    },
    // Hidden for P0 scope - account matching is P1
    // {
    //   path: '/matches',
    //   name: 'matches',
    //   component: () => import('@/pages/MatchesPage.vue'),
    // },
    {
      path: '/pricing',
      name: 'pricing',
      component: () => import('@/pages/PricingPage.vue'),
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/pages/ProjectsPage.vue'),
    },
    {
      path: '/data-sources',
      name: 'data-sources',
      component: () => import('@/pages/DataSourcesPage.vue'),
    },
  ],
})

// Navigation guard: redirect to onboarding if no data
router.beforeEach(async (to, _from, next) => {
  // Skip check for onboarding routes
  if (to.meta.skipDataCheck) {
    return next()
  }

  const hasData = await checkHasData()

  if (!hasData) {
    return next({ name: 'onboarding' })
  }

  next()
})

export default router
