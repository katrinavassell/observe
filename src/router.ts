import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Main app routes - Pricing Analyzer is the home page
    {
      path: '/',
      name: 'pricing',
      component: () => import('@/pages/PricingAnalyzerPage.vue'),
    },
    {
      path: '/pricing',
      redirect: '/',
    },
    {
      path: '/data-sources',
      name: 'data-sources',
      component: () => import('@/pages/DataSourcesPage.vue'),
    },
    {
      path: '/simulator',
      name: 'simulator',
      component: () => import('@/pages/SimulatorPage.vue'),
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
      redirect: '/',
    },
  ],
})

export default router
