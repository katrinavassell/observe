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
      name: "customers",
      component: () => import("@/pages/CustomersPage.vue"),
    },
    {
      path: "/customers/:id",
      name: "customer-detail",
      component: () => import("@/pages/CustomerDetailPage.vue"),
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

// Initialize Supabase auth session once on app load.
//
// We DO NOT await inside beforeEach: App.vue already calls initialize()
// fire-and-forget at mount, and useAuth's init promise is idempotent. Awaiting
// here blocked every nav on the same cached promise, so if an internal fetch
// in initialize() hung (no timeouts on supabase.getSession / api.getMe), the
// sidebar would silently stop responding to clicks until the user refreshed.
// App.vue's isLoading ref handles the first-paint spinner for the case where
// the user lands on a protected page before init completes.
import { initialize } from "@/composables/useAuth";
let kickedOff = false;
router.beforeEach(() => {
  if (!kickedOff) {
    kickedOff = true;
    void initialize().catch(() => {
      // Let the page render — downstream queries surface errors appropriately.
      // Reset so the next nav can retry.
      kickedOff = false;
    });
  }
  return true;
});

export default router;
