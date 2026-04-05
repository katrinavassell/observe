import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "analytics",
      component: () => import("@/pages/AnalyticsPage.vue"),
    },
    {
      path: "/analytics",
      redirect: "/",
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
      redirect: "/",
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
      path: "/alerts",
      name: "alerts",
      component: () => import("@/pages/AlertsPage.vue"),
    },
    {
      path: "/traces",
      name: "traces",
      component: () => import("@/pages/TracesPage.vue"),
    },
    {
      path: "/insights",
      redirect: "/",
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
      redirect: "/data-sources",
    },
    {
      path: "/onboarding/upload",
      redirect: "/data-sources",
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

// Initialize session once on app load — no auth guard, anonymous browsing is allowed
import { initialize } from "@/composables/useAuth";
let initialized = false;
router.beforeEach(async () => {
  if (!initialized) {
    await initialize();
    initialized = true;
  }
});

export default router;
