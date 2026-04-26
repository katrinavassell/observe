<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileText,
  AlertCircle,
  CheckCircle,
  Loader2,
  Settings2,
  X,
} from "lucide-vue-next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@/components/ui";
import FileDropzone from "@/components/ui/file-dropzone.vue";
import ColumnMapper from "./ColumnMapper.vue";
import ImportGuide from "./ImportGuide.vue";
import {
  validateColumns,
  createProject,
  uploadFile,
  type ColumnValidation,
} from "@/lib/api";
const router = useRouter();
const queryClient = useQueryClient();

// Wizard state
const currentStep = ref(1);
const selectedTypes = ref<string[]>(["costs"]);
const files = ref<Record<string, File>>({});
const validations = ref<Record<string, ColumnValidation>>({});
const customMappings = ref<Record<string, Record<string, string>>>({});
const uploadStatus = ref<
  Record<string, "pending" | "uploading" | "success" | "error">
>({});
const uploadErrors = ref<Record<string, string>>({});

// Quick start banner state
const showQuickStart = ref(true);

// Column mapping modal state
const mappingTypeId = ref<string | null>(null);

// Data types — columns match the server-side Zod schemas in routes/data.ts
const dataTypes = [
  {
    id: "costs",
    name: "Costs",
    desc: "AI provider costs by month",
    required: true,
    columns: ["month", "cost", "provider", "customer_id"],
    template: `month,cost,provider,customer_id\n2024-12,3200,openai,cust_001\n2024-11,2800,anthropic,cust_001`,
    sources: [
      { name: "OpenAI", path: "Settings → Billing → Usage → Export" },
      { name: "Anthropic", path: "Console → Usage → Export CSV" },
    ],
  },
  {
    id: "usage",
    name: "Usage",
    desc: "API calls, tokens, and other metrics",
    required: false,
    columns: ["month", "customer_id", "metric", "value", "limit"],
    template: `month,customer_id,metric,value,limit\n2024-12,cust_001,api_calls,8500,10000\n2024-12,cust_001,tokens,9500000,10000000`,
    sources: [
      { name: "Your database", path: "Export usage metrics per customer" },
    ],
  },
  {
    id: "revenue",
    name: "Revenue",
    desc: "Customers, plans, and subscriptions",
    required: false,
    columns: [
      "customer_id",
      "name",
      "email",
      "segment",
      "plan_id",
      "plan_name",
      "price_amount",
    ],
    template: `customer_id,name,email,segment,plan_id,plan_name,price_amount\ncust_001,Acme Corp,billing@acme.com,Enterprise,plan_pro,Pro,99.00`,
    sources: [
      { name: "Stripe", path: "Customers → Export" },
      { name: "Chargebee", path: "Subscriptions → Export" },
    ],
  },
];

const canProceedStep1 = computed(() => selectedTypes.value.includes("costs"));
const canProceedStep2 = computed(() => {
  return selectedTypes.value.every((type) => {
    const file = files.value[type];
    const validation = validations.value[type];
    const hasCustomMapping = !!customMappings.value[type];
    // Valid if: has file AND (auto-validated OR has custom mapping)
    return file && (validation?.is_valid || hasCustomMapping);
  });
});

function openColumnMapper(typeId: string) {
  mappingTypeId.value = typeId;
}

function handleMappingConfirm(typeId: string, mapping: Record<string, string>) {
  customMappings.value[typeId] = mapping;
  mappingTypeId.value = null;
}

function handleMappingCancel() {
  mappingTypeId.value = null;
}

const allUploadsComplete = computed(() => {
  return selectedTypes.value.every(
    (type) => uploadStatus.value[type] === "success",
  );
});

function toggleType(typeId: string) {
  if (typeId === "costs") return; // Can't deselect costs

  const index = selectedTypes.value.indexOf(typeId);
  if (index >= 0) {
    selectedTypes.value.splice(index, 1);
    delete files.value[typeId];
    delete validations.value[typeId];
  } else {
    selectedTypes.value.push(typeId);
  }
}

function handleDownloadTemplate(typeId: string) {
  const dataType = dataTypes.find((d) => d.id === typeId);
  if (!dataType?.template) return;
  const blob = new Blob([dataType.template], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${typeId}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleFileSelect(typeId: string, file: File) {
  files.value[typeId] = file;

  try {
    const validation = await validateColumns(file, typeId);
    validations.value[typeId] = validation;
  } catch (error) {
    console.error("Validation failed:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    validations.value[typeId] = {
      detected_columns: [],
      expected_columns: [],
      matched_columns: {},
      missing_required: [
        `Couldn't read file: ${errorMessage}. Make sure it's a valid CSV with column headers.`,
      ],
      is_valid: false,
      row_count: 0,
    };
  }
}

function handleFileClear(typeId: string) {
  delete files.value[typeId];
  delete validations.value[typeId];
  delete customMappings.value[typeId];
}

const processUploadsMutation = useMutation({
  mutationFn: async () => {
    // Create a project first
    const project = await createProject({
      name: `Upload ${new Date().toLocaleDateString()}`,
      description: "Uploaded via wizard",
    });

    // Upload each file
    for (const typeId of selectedTypes.value) {
      const file = files.value[typeId];
      if (!file) continue;

      uploadStatus.value[typeId] = "uploading";

      try {
        const mapping = customMappings.value[typeId];
        await uploadFile(project.id, file, {
          fileType: typeId,
          columnMapping: mapping,
        });
        uploadStatus.value[typeId] = "success";
      } catch (error) {
        uploadStatus.value[typeId] = "error";
        const rawMessage =
          error instanceof Error ? error.message : "Unknown error";
        // Make error messages more user-friendly
        if (rawMessage.includes("413") || rawMessage.includes("too large")) {
          uploadErrors.value[typeId] =
            "File is too large. Try a smaller file or split it into parts.";
        } else if (
          rawMessage.includes("400") ||
          rawMessage.includes("invalid")
        ) {
          uploadErrors.value[typeId] =
            "Invalid file format. Make sure it's a CSV with the correct columns.";
        } else {
          uploadErrors.value[typeId] = `Upload failed: ${rawMessage}`;
        }
      }
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["data-status"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["revenue-analytics"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    // Invalidate all analytics queries so AnalyticsPage shows fresh data
    queryClient.invalidateQueries({ queryKey: ["events-by-feature"] });
    queryClient.invalidateQueries({ queryKey: ["events-by-model"] });
    queryClient.invalidateQueries({ queryKey: ["events-by-customer"] });
    queryClient.invalidateQueries({ queryKey: ["events-by-agent"] });
    queryClient.invalidateQueries({ queryKey: ["events-by-cost-type"] });
    queryClient.invalidateQueries({ queryKey: ["source-breakdown"] });
    queryClient.invalidateQueries({ queryKey: ["mrr-movements"] });
    queryClient.invalidateQueries({ queryKey: ["insights"] });
    queryClient.invalidateQueries({ queryKey: ["usage-limits"] });
    queryClient.invalidateQueries({ queryKey: ["feature-pricing"] });
  },
});

function nextStep() {
  if (currentStep.value === 1 && canProceedStep1.value) {
    currentStep.value = 2;
  } else if (currentStep.value === 2 && canProceedStep2.value) {
    currentStep.value = 3;
    processUploadsMutation.mutate();
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

function goToDashboard() {
  router.push("/");
}
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-3xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <button
          class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          @click="router.push('/data-sources')"
        >
          <ArrowLeft class="h-4 w-4" />
          Back to options
        </button>
        <h1 class="text-2xl font-bold">Upload Your Data</h1>
        <p class="text-muted-foreground">
          Import CSV files to populate your dashboard
        </p>
      </div>

      <!-- Step indicator -->
      <div class="flex items-center gap-4 mb-8">
        <div v-for="step in 3" :key="step" class="flex items-center gap-2">
          <div
            :class="[
              'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
              currentStep > step
                ? 'bg-success text-success-foreground'
                : currentStep === step
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
            ]"
          >
            <Check v-if="currentStep > step" class="h-4 w-4" />
            <span v-else>{{ step }}</span>
          </div>
          <span
            :class="[
              'text-sm font-medium',
              currentStep >= step ? 'text-foreground' : 'text-muted-foreground',
            ]"
          >
            {{
              step === 1
                ? "Select Data"
                : step === 2
                  ? "Upload Files"
                  : "Processing"
            }}
          </span>
          <div v-if="step < 3" class="w-8 h-px bg-border" />
        </div>
      </div>

      <!-- Quick Start Tip -->
      <Card
        v-if="showQuickStart && currentStep === 1"
        class="bg-muted/50 border-muted mb-6"
      >
        <CardContent class="p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <span class="text-lg">💡</span>
              <div>
                <p class="text-sm">
                  <span class="font-medium">Tip:</span> Each data type shows
                  where to find it in common tools. Select what you have, then
                  export from your source.
                </p>
              </div>
            </div>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground p-1 shrink-0"
              @click="showQuickStart = false"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      <!-- Step 1: Select Data Types -->
      <Card v-if="currentStep === 1">
        <CardHeader>
          <CardTitle>What data do you want to import?</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div
            v-for="type in dataTypes"
            :key="type.id"
            :class="[
              'flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors',
              selectedTypes.includes(type.id)
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/50',
              type.required && 'cursor-default',
            ]"
            @click="toggleType(type.id)"
          >
            <div
              :class="[
                'flex h-5 w-5 items-center justify-center rounded border',
                selectedTypes.includes(type.id)
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground/30',
              ]"
            >
              <Check
                v-if="selectedTypes.includes(type.id)"
                class="h-3 w-3 text-primary-foreground"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ type.name }}</span>
                <Badge v-if="type.required" variant="secondary" class="text-xs">
                  Required
                </Badge>
              </div>
              <p class="text-sm text-muted-foreground">{{ type.desc }}</p>
              <!-- Source hints -->
              <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                <span
                  v-for="source in type.sources"
                  :key="source.name"
                  class="text-[11px] text-muted-foreground"
                >
                  <span class="font-medium">{{ source.name }}:</span>
                  {{ source.path }}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="shrink-0"
              @click.stop="handleDownloadTemplate(type.id)"
            >
              <Download class="h-4 w-4 mr-1" />
              Template
            </Button>
          </div>

          <div class="flex justify-end pt-4">
            <Button :disabled="!canProceedStep1" @click="nextStep">
              Continue
              <ArrowRight class="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Step 2: Upload Files -->
      <Card v-if="currentStep === 2">
        <CardHeader>
          <CardTitle>Upload your CSV files</CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
          <div v-for="typeId in selectedTypes" :key="typeId" class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <FileText class="h-4 w-4 text-muted-foreground" />
                <span class="font-medium">
                  {{ dataTypes.find((t) => t.id === typeId)?.name }}
                </span>
                <button
                  type="button"
                  class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  @click="handleDownloadTemplate(typeId)"
                >
                  <Download class="h-3 w-3" />
                  Template
                </button>
              </div>
              <div v-if="validations[typeId]" class="flex items-center gap-2">
                <CheckCircle
                  v-if="validations[typeId].is_valid"
                  class="h-4 w-4 text-success"
                />
                <AlertCircle v-else class="h-4 w-4 text-destructive" />
                <span class="text-sm text-muted-foreground">
                  {{ validations[typeId].row_count }} rows
                </span>
              </div>
            </div>

            <FileDropzone
              @file="(f) => handleFileSelect(typeId, f)"
              @clear="handleFileClear(typeId)"
            />

            <!-- Validation feedback -->
            <div v-if="validations[typeId]">
              <!-- Success: Auto-validated -->
              <div
                v-if="validations[typeId].is_valid && !customMappings[typeId]"
                class="rounded-md bg-success/10 p-3 text-sm text-success flex items-center justify-between"
              >
                <span>Columns matched automatically</span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground hover:text-foreground h-auto py-1"
                  @click="openColumnMapper(typeId)"
                >
                  <Settings2 class="h-3 w-3 mr-1" />
                  Edit
                </Button>
              </div>

              <!-- Success: Custom mapping applied -->
              <div
                v-else-if="customMappings[typeId]"
                class="rounded-md bg-success/10 p-3 text-sm text-success flex items-center justify-between"
              >
                <span>Custom column mapping applied</span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground hover:text-foreground h-auto py-1"
                  @click="openColumnMapper(typeId)"
                >
                  <Settings2 class="h-3 w-3 mr-1" />
                  Edit
                </Button>
              </div>

              <!-- Needs mapping -->
              <div v-else class="rounded-md bg-warning/10 p-3 text-sm">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="text-warning font-medium"
                      >Column mapping needed</span
                    >
                    <p class="text-muted-foreground text-xs mt-0.5">
                      {{ validations[typeId].missing_required.length }} required
                      column(s) not found
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    @click="openColumnMapper(typeId)"
                  >
                    <Settings2 class="h-4 w-4 mr-1.5" />
                    Map Columns
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- Import Guide (collapsible) -->
          <div class="border-t pt-4">
            <ImportGuide
              :data-type="selectedTypes[0] || 'costs'"
              @download-template="handleDownloadTemplate"
            />
          </div>

          <div class="flex justify-between pt-4">
            <Button variant="outline" @click="prevStep">
              <ArrowLeft class="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button :disabled="!canProceedStep2" @click="nextStep">
              Start Upload
              <ArrowRight class="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Step 3: Processing -->
      <Card v-if="currentStep === 3">
        <CardHeader>
          <CardTitle>
            {{
              allUploadsComplete
                ? "Upload Complete!"
                : "Processing your data..."
            }}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div
            v-for="typeId in selectedTypes"
            :key="typeId"
            class="flex items-center gap-4 p-4 rounded-lg border"
          >
            <div class="flex-1">
              <div class="font-medium">
                {{ dataTypes.find((t) => t.id === typeId)?.name }}
              </div>
              <div class="text-sm text-muted-foreground">
                {{ files[typeId]?.name }}
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Loader2
                v-if="uploadStatus[typeId] === 'uploading'"
                class="h-5 w-5 text-primary animate-spin"
              />
              <CheckCircle
                v-else-if="uploadStatus[typeId] === 'success'"
                class="h-5 w-5 text-success"
              />
              <AlertCircle
                v-else-if="uploadStatus[typeId] === 'error'"
                class="h-5 w-5 text-destructive"
              />
              <div
                v-else
                class="h-5 w-5 rounded-full border-2 border-muted-foreground/30"
              />
            </div>
          </div>

          <div v-if="allUploadsComplete" class="pt-4">
            <Button class="w-full" @click="goToDashboard">
              View Dashboard
              <ArrowRight class="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Column Mapper Modal -->
    <Teleport to="body">
      <div
        v-if="mappingTypeId && validations[mappingTypeId]"
        class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        @click.self="handleMappingCancel"
      >
        <div
          class="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-lg border bg-card p-6 shadow-lg"
        >
          <ColumnMapper
            :data-type="mappingTypeId"
            :validation="validations[mappingTypeId]!"
            :file-name="files[mappingTypeId]?.name || 'file'"
            @confirm="
              (m: Record<string, string>) =>
                handleMappingConfirm(mappingTypeId!, m)
            "
            @cancel="handleMappingCancel"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>
