import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
