import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'analytics',
      component: () => import('@/pages/AnalyticsPage.vue'),
    },
    {
      path: '/analytics',
      redirect: '/',
    },
    {
      path: '/pricing',
      redirect: '/',
    },
    {
      path: '/events',
      name: 'events',
      component: () => import('@/pages/EventsPage.vue'),
    },
    {
      path: '/features',
      name: 'features',
      component: () => import('@/pages/FeaturesPage.vue'),
    },
    {
      path: '/features/:key',
      name: 'feature-detail',
      component: () => import('@/pages/FeatureDetailPage.vue'),
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('@/pages/ModelsPage.vue'),
    },
    {
      path: '/customers',
      name: 'customers',
      component: () => import('@/pages/CustomersPage.vue'),
    },
    {
      path: '/customers/:id',
      name: 'customer-detail',
      component: () => import('@/pages/CustomerDetailPage.vue'),
    },
    {
      path: '/savings',
      redirect: '/analytics',
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: () => import('@/pages/AlertsPage.vue'),
    },
    {
      path: '/data-sources',
      name: 'data-sources',
      component: () => import('@/pages/DataSourcesPage.vue'),
    },
    {
      path: '/insights',
      name: 'insights',
      component: () => import('@/pages/InsightsPage.vue'),
    },
    {
      path: '/referrals',
      name: 'referrals',
      component: () => import('@/pages/ReferralsPage.vue'),
    },
    {
      path: '/simulations',
      redirect: '/analytics',
    },
    {
      path: '/simulator',
      redirect: '/analytics',
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
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { noLayout: true },
    },
    {
      path: '/signup',
      name: 'signup',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { noLayout: true },
    },
    {
      path: '/plans',
      name: 'plans',
      component: () => import('@/pages/PlansPage.vue'),
    },
    {
      path: '/checkout',
      name: 'checkout',
      component: () => import('@/pages/CheckoutPage.vue'),
    },
    {
      path: '/checkout/success',
      name: 'checkout-success',
      component: () => import('@/pages/CheckoutSuccessPage.vue'),
    },
    {
      path: '/admin/pricing',
      name: 'admin-pricing',
      component: () => import('@/pages/AdminPricingPage.vue'),
    },
    {
      path: '/team',
      name: 'team',
      component: () => import('@/pages/TeamSettingsPage.vue'),
    },
    {
      path: '/join/:token',
      name: 'join-team',
      component: () => import('@/pages/JoinTeamPage.vue'),
      meta: { noLayout: true },
    },
  ],
})

// Auth guard — import the refs directly to avoid composable lifecycle issues
import { useAuth } from '@/composables/useAuth'
const { isLoggedIn, isInitialized } = useAuth()

router.beforeEach((to) => {
  if (to.meta?.noLayout) return
  // Allow demo mode users to navigate freely
  if (sessionStorage.getItem('demo_mode') === 'true') return
  if (isInitialized.value && !isLoggedIn.value) {
    return { name: 'signup' }
  }
})

export default router
