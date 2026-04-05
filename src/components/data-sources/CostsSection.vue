<script setup lang="ts">
import { ref } from "vue";
import { toast } from "vue-sonner";
import Papa from "papaparse";
import { Upload, Download, CheckCircle, X } from "lucide-vue-next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui";
import * as api from "@/lib/api";
import {
  validateFileSize,
  validateCsvExtension,
  validateCostRecords,
} from "@/lib/validation";

const props = defineProps<{
  file: { name: string; isSample: boolean } | null;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  fileUploaded: [file: { name: string; isSample: boolean }];
  fileCleared: [];
}>();

const isUploading = ref(false);
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileInput(): void {
  fileInput.value?.click();
}

function handleFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    processFile(file);
  }
  input.value = "";
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) {
    processFile(file);
  }
}

async function processFile(file: File): Promise<void> {
  const extValidation = validateCsvExtension(file);
  if (!extValidation.valid) {
    toast.error(extValidation.error!);
    return;
  }

  const sizeValidation = validateFileSize(file);
  if (!sizeValidation.valid) {
    toast.error(sizeValidation.error!);
    return;
  }

  isUploading.value = true;

  try {
    const parseResult = await new Promise<
      Papa.ParseResult<Record<string, unknown>>
    >((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
        error: reject,
      });
    });

    const rows = parseResult.data;
    const validation = validateCostRecords(
      rows as {
        customer_id?: string;
        month?: string;
        cost?: number | string;
      }[],
    );

    if (!validation.valid) {
      toast.error("No valid cost records found", {
        description:
          validation.errors.length > 0
            ? validation.errors.slice(0, 3).join("; ")
            : "CSV must have columns: month, cost (and optionally provider)",
      });
      return;
    }

    const records = rows
      .filter((r) => r.month && r.cost)
      .map((r) => ({
        month: String(r.month),
        provider: r.provider ? String(r.provider) : undefined,
        customer_id: r.customer_id ? String(r.customer_id) : undefined,
        cost: parseFloat(String(r.cost)) || 0,
      }));

    const result = await api.uploadCostData(records);
    emit("fileUploaded", { name: file.name, isSample: false });
    window.posthog?.capture("csv_uploaded");

    const description =
      validation.invalidRecords > 0
        ? `${result.count} records saved, ${validation.invalidRecords} invalid rows skipped`
        : `${result.count} cost records saved`;

    toast.success("Costs uploaded!", { description });
  } catch (error) {
    toast.error("Failed to upload cost data", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    isUploading.value = false;
  }
}

function downloadTemplate(): void {
  const content = `month,provider,cost
2024-12,openai,3200
2024-12,anthropic,3000
2024-11,openai,2800
2024-11,anthropic,2600`;

  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "costs-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section>
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">Cost CSV</CardTitle>
        <CardDescription>
          Monthly cost breakdown — columns: month, provider, cost
        </CardDescription>
      </CardHeader>
      <CardContent class="p-5 pt-0 space-y-4">
        <input
          v-if="!props.readonly"
          ref="fileInput"
          type="file"
          accept=".csv"
          class="hidden"
          @change="handleFileSelect"
        />

        <div
          v-if="!file && !props.readonly"
          :class="[
            'border-2 border-dashed rounded-lg p-5 transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25',
          ]"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div class="text-center cursor-pointer" @click="triggerFileInput">
            <Upload class="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
            <p class="text-sm text-muted-foreground">
              Drop one CSV here or
              <span class="text-primary font-medium">browse</span>
            </p>
          </div>
        </div>

        <div v-if="file" class="border rounded-lg p-4">
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <CheckCircle class="h-4 w-4 text-green-500" />
              <span>{{ file.name }}</span>
            </div>
            <button
              v-if="!props.readonly"
              type="button"
              class="p-0.5 rounded hover:bg-muted transition-colors"
              @click="emit('fileCleared')"
            >
              <X class="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div v-if="!props.readonly" class="flex items-center justify-center">
          <button
            type="button"
            class="text-xs text-primary hover:underline flex items-center gap-1"
            @click="downloadTemplate"
          >
            <Download class="h-3 w-3" />
            Download template
          </button>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
