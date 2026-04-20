import { createApp } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { setupClerk } from "./lib/clerk";
import router from "./router";
import App from "./App.vue";
import { logger } from "./lib/logger";
import "./assets/index.css";
import "vue-sonner/style.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

const app = createApp(App);

// Global error handler for uncaught Vue errors
app.config.errorHandler = (err, instance, info) => {
  logger.error("Uncaught Vue error", err, {
    component: instance?.$options?.name || "Unknown",
    info,
  });
};

// Global warning handler (development only)
app.config.warnHandler = (msg, instance, trace) => {
  logger.warn("Vue warning", {
    message: msg,
    component: instance?.$options?.name || "Unknown",
    trace,
  });
};

setupClerk(app);
app.use(router);
app.use(VueQueryPlugin, { queryClient });

app.mount("#app");
