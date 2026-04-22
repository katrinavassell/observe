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
      redirect: "/cohorts",
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
      path: "/help",
      name: "help",
      component: () => import("@/pages/HelpPage.vue"),
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
      redirect: "/",
    },
    {
      path: "/dashboard",
      redirect: "/",
    },
    {
      path: "/forgot-password",
      redirect: "/login",
    },
    {
      path: "/reset-password",
      redirect: "/login",
    },
    {
      path: "/login/:pathMatch(.*)*",
      name: "login",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { noLayout: true },
    },
    {
      path: "/signup/:pathMatch(.*)*",
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
      redirect: "/analytics",
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

router.onError((err) => {
  if (
    err.message.includes("Failed to fetch dynamically imported module") ||
    err.message.includes("Importing a module script failed")
  ) {
    window.location.reload();
  }
});

export default router;
