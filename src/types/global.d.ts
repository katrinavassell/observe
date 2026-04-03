interface Window {
  posthog?: {
    identify(id: string, properties?: Record<string, unknown>): void;
    capture(event: string, properties?: Record<string, unknown>): void;
    reset(): void;
  };
}
