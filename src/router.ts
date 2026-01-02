import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '@/lib/supabase'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Auth routes (no layout)
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { requiresAuth: false },
    },
    // Main app routes - Pricing Analyzer is the home page
    {
      path: '/',
      name: 'pricing',
      component: () => import('@/pages/PricingAnalyzerPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/pricing',
      redirect: '/',
    },
    {
      path: '/data-sources',
      name: 'data-sources',
      component: () => import('@/pages/DataSourcesPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/simulator',
      name: 'simulator',
      component: () => import('@/pages/SimulatorPage.vue'),
      meta: { requiresAuth: true },
    },
    // Legacy redirects
    {
      path: '/pricing-model',
      redirect: '/pricing',
    },
    {
      path: '/onboarding',
      redirect: '/',
    },
    {
      path: '/onboarding/upload',
      redirect: '/data-sources',
    },
    {
      path: '/dashboard',
      redirect: '/',
    },
  ],
})

// Auth guard - single session check for efficiency
router.beforeEach(async (to, _from, next) => {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const isAuthenticated = !!session
    const requiresAuth = to.meta.requiresAuth !== false
    const isLoginPage = to.path === '/login'

    // Redirect unauthenticated users to login (except for login page)
    if (requiresAuth && !isAuthenticated) {
      next('/login')
      return
    }

    // Redirect authenticated users away from login page
    if (isLoginPage && isAuthenticated) {
      next('/')
      return
    }

    next()
  } catch (error) {
    console.error('Router guard exception:', error)
    // On unexpected errors, redirect to login as a safe fallback
    next('/login')
  }
})

export default router
