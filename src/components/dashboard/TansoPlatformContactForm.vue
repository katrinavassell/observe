<script setup lang="ts">
/**
 * "Talk to us about implementing this" dialog. Captures a Tanso Platform
 * implementation lead with the context from the originating recommendation.
 *
 * Opens as a modal. Submission flow:
 *   1. POST /api/v1/contact/tanso-implementation with email + context
 *   2. Backend persists the lead and triggers the AE notification email
 *      (using the existing Resend integration in server/routes/alerts.ts)
 *   3. Dialog shows success + Cal.com link to schedule a 20-min call
 *
 * v1 ships as a sales-touch flow. When Tanso Platform integration ships,
 * the same dialog can be repurposed to apply the fix in-product.
 */
import { ref, computed, watch } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "radix-vue";
import { useMutation } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Calendar, X, ExternalLink, Loader2 } from "lucide-vue-next";
import { useUser } from "@clerk/vue";
import {
  captureTansoLead,
  type TansoLeadInput,
} from "@/lib/api/tanso-leads";
import type { Recommendation } from "@/lib/api/recommendations";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";

const props = defineProps<{
  open: boolean;
  recommendation?: Recommendation | null;
  /** Cal.com handle for AE booking. Defaults to katrina-laszlo. */
  calHandle?: string;
  /** Cal.com event slug. Defaults to 20-minute-meeting. */
  calEvent?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { user } = useUser();

const email = ref("");
const note = ref("");
const submitted = ref(false);

const customerName = computed(
  () => props.recommendation?.customer_name ?? null,
);

const recoveredDollars = computed<number | null>(() => {
  const payload = props.recommendation?.action_payload ?? {};
  const ctx = props.recommendation?.context ?? {};
  const v =
    (payload.recovered_dollars as number | undefined) ??
    (payload.recoveredDollars as number | undefined) ??
    (ctx.recovered_dollars as number | undefined) ??
    null;
  return typeof v === "number" ? v : null;
});

const headerCopy = computed(() => {
  if (customerName.value) return `Let's fix ${customerName.value}.`;
  return "Let's fix this for you.";
});

const calHandle = computed(() => props.calHandle ?? "katrina-laszlo");
const calEvent = computed(() => props.calEvent ?? "20-minute-meeting");
const calUrl = computed(() => {
  const ctx = encodeURIComponent(
    customerName.value
      ? `Lead from Observe — fix ${customerName.value}`
      : "Lead from Observe",
  );
  return `https://cal.com/${calHandle.value}/${calEvent.value}?note=${ctx}`;
});

// Pre-fill email when the user is logged in (Clerk).
watch(
  () => user.value?.primaryEmailAddress?.emailAddress,
  (newEmail) => {
    if (newEmail && !email.value) email.value = newEmail;
  },
  { immediate: true },
);

// Reset state when dialog reopens.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      submitted.value = false;
      note.value = "";
      if (user.value?.primaryEmailAddress?.emailAddress) {
        email.value = user.value.primaryEmailAddress.emailAddress;
      }
    }
  },
);

function close() {
  emit("update:open", false);
}

const submit = useMutation({
  mutationFn: async () => {
    const input: TansoLeadInput = {
      email: email.value.trim(),
      customer_name: customerName.value,
      action_type: props.recommendation?.action_type ?? null,
      action_payload: props.recommendation?.action_payload ?? null,
      recovered_dollars: recoveredDollars.value,
      recommendation_id: props.recommendation?.id ?? null,
      note: note.value.trim() || null,
    };
    return captureTansoLead(input);
  },
  onSuccess: () => {
    submitted.value = true;
    toast.success("We'll be in touch", {
      description: "Check your inbox for next steps.",
    });
  },
  onError: (err) => {
    toast.error("Couldn't send", {
      description: err instanceof Error ? err.message : "Try again in a moment.",
    });
  },
});

function onSubmit(e: Event) {
  e.preventDefault();
  if (!email.value.trim() || submit.isPending.value) return;
  submit.mutate();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:rounded-lg"
      >
        <DialogClose
          class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </DialogClose>

        <!-- Pre-submit state -->
        <template v-if="!submitted">
          <DialogTitle class="text-lg font-semibold">
            {{ headerCopy }}
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            We saw you want to act on a margin issue Observe surfaced. Here's
            what happens next:
          </DialogDescription>

          <ol class="ml-1 space-y-1.5 text-sm text-foreground">
            <li class="flex gap-2">
              <span class="text-muted-foreground">1.</span>
              <span>
                We map<template v-if="customerName"> {{ customerName }}'s</template>
                current usage and pricing
              </span>
            </li>
            <li class="flex gap-2">
              <span class="text-muted-foreground">2.</span>
              <span>We show you the fix in test mode — no production changes</span>
            </li>
            <li class="flex gap-2">
              <span class="text-muted-foreground">3.</span>
              <span>We send you a one-page implementation doc</span>
            </li>
          </ol>

          <form class="space-y-4 pt-2" @submit="onSubmit">
            <div class="space-y-1.5">
              <Label for="tanso-lead-email">Your email</Label>
              <Input
                id="tanso-lead-email"
                v-model="email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@example.com"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="tanso-lead-note">
                Anything we should know? <span class="text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="tanso-lead-note"
                v-model="note"
                rows="3"
                maxlength="1000"
                class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="e.g., We've been trying to raise BlazeML's rate for 2 months."
              />
            </div>

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="default"
                @click="close"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="default"
                :loading="submit.isPending.value"
                :disabled="!email.trim() || submit.isPending.value"
              >
                <Loader2 v-if="submit.isPending.value" class="mr-2 h-4 w-4 animate-spin" />
                Send
              </Button>
            </div>
          </form>
        </template>

        <!-- Post-submit state -->
        <template v-else>
          <DialogTitle class="text-lg font-semibold">
            We got it. Pick a slot.
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            You'll get a calendar invite + a one-page implementation prep doc
            in your inbox.
          </DialogDescription>

          <div class="rounded-md border bg-muted/30 p-4 text-sm text-foreground">
            <p class="font-medium">A 20-minute call is enough to scope it.</p>
            <p class="mt-1 text-muted-foreground">
              Or reply to the email we just sent if you'd rather async.
            </p>
          </div>

          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="default"
              @click="close"
            >
              Close
            </Button>
            <a
              :href="calUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-1.5"
            >
              <Button type="button" variant="default" size="default">
                <Calendar class="h-4 w-4" />
                Pick a 20-min slot
                <ExternalLink class="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
