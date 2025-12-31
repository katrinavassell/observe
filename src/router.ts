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
    // Main app routes - Pricing is the home page
    {
      path: '/',
      name: 'pricing',
      component: () => import('@/pages/PricingPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/data-sources',
      name: 'data-sources',
      component: () => import('@/pages/DataSourcesPage.vue'),
      meta: { requiresAuth: true },
    },
    // Legacy redirects
    {
      path: '/pricing',
      redirect: '/',
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
    {
      path: '/accounts',
      redirect: '/',
    },
  ],
})

// Auth guard
router.beforeEach(async (to, _from, next) => {
  try {
    const requiresAuth = to.meta.requiresAuth !== false

    if (requiresAuth) {
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Auth guard error:', error.message)
        next('/login')
        return
      }

      if (!session) {
        next('/login')
        return
      }
    }

    // If authenticated and going to login, redirect to home
    if (to.path === '/login') {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        next('/')
        return
      }
    }

    next()
  } catch (error) {
    console.error('Router guard exception:', error)
    // On unexpected errors, redirect to login as a safe fallback
    next('/login')
  }
})

export default router
