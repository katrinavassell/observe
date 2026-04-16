import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/analytics",
    },
    {
      path: "/analytics",
      name: "analytics",
      component: () => import("@/pages/AnalyticsPage.vue"),
    },
    {
      path: "/pricing",
      redirect: "/",
    },
    {
      path: "/events",
      name: "events",
      component: () => import("@/pages/EventsPage.vue"),
    },
    {
      path: "/features",
      name: "features",
      component: () => import("@/pages/FeaturesPage.vue"),
    },
    {
      path: "/features/:key",
      redirect: "/",
    },
    {
      path: "/models",
      name: "models",
      component: () => import("@/pages/ModelsPage.vue"),
    },
    {
      path: "/cohorts",
      name: "cohorts",
      component: () => import("@/pages/CohortsPage.vue"),
    },
    {
      path: "/customers",
      redirect: "/",
    },
    {
      path: "/customers/:id",
      redirect: "/",
    },
    {
      path: "/data-sources",
      name: "data-sources",
      component: () => import("@/pages/DataSourcesPage.vue"),
    },
    {
      path: "/insights",
      redirect: "/analytics",
    },
    {
      path: "/chat",
      redirect: "/analytics",
    },
    {
      path: "/alerts",
      name: "alerts",
      component: () => import("@/pages/AlertsPage.vue"),
    },
    {
      // Routing is hidden pending QA. Existing links redirect home.
      path: "/routing",
      redirect: "/analytics",
    },
    {
      path: "/traces",
      name: "traces",
      component: () => import("@/pages/TracesPage.vue"),
    },
    {
      path: "/referrals",
      redirect: "/",
    },
    // Legacy redirects
    {
      path: "/pricing-model",
      redirect: "/pricing",
    },
    {
      path: "/onboarding",
      name: "onboarding",
      component: () => import("@/pages/OnboardingPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/onboarding/upload",
      redirect: "/onboarding",
    },
    {
      path: "/dashboard",
      redirect: "/",
    },
    {
      path: "/forgot-password",
      name: "forgot-password",
      component: () => import("@/pages/ForgotPasswordPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/reset-password",
      name: "reset-password",
      component: () => import("@/pages/ResetPasswordPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/login",
      name: "login",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/signup",
      name: "signup",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/plans",
      name: "plans",
      component: () => import("@/pages/PlansPage.vue"),
    },
    {
      path: "/checkout/success",
      name: "checkout-success",
      component: () => import("@/pages/CheckoutSuccessPage.vue"),
    },
    {
      path: "/admin/pricing",
      redirect: "/models",
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("@/pages/AdminPage.vue"),
    },
    {
      path: "/team",
      name: "team",
      component: () => import("@/pages/TeamSettingsPage.vue"),
    },
    {
      path: "/join/:token",
      name: "join-team",
      component: () => import("@/pages/JoinTeamPage.vue"),
      meta: { noLayout: true },
    },
  ],
});

// Initialize Supabase auth session once on app load
import { initialize } from "@/composables/useAuth";
let initialized = false;
router.beforeEach(async () => {
  if (!initialized) {
    await initialize();
    initialized = true;
  }
});

export default router;
