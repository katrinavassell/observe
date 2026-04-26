const API_BASE = "/api";

export interface ColumnValidation {
  detected_columns: string[];
  expected_columns: string[];
  matched_columns: Record<string, string>;
  missing_required: string[];
  is_valid: boolean;
  row_count: number;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  upload_count: number;
}

export interface Upload {
  id: number;
  project_id: number;
  file_name: string;
  file_type: string;
  status: "pending" | "processing" | "completed" | "completed_with_errors";
  row_count: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export async function validateColumns(
  file: File,
  dataType: string,
): Promise<ColumnValidation> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE}/validate-columns?data_type=${dataType}`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(`Validation failed: ${response.status}`);
  }

  return response.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
}): Promise<Project> {
  const { request } = await import("./base");
  const params = new URLSearchParams();
  params.set("name", data.name);
  if (data.description) params.set("description", data.description);

  return request(`/projects?${params.toString()}`, {
    method: "POST",
  });
}

export async function uploadFile(
  projectId: number,
  file: File,
  options?: {
    fileType?: string;
    columnMapping?: Record<string, string>;
  },
): Promise<Upload> {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams();
  if (options?.fileType) {
    params.set("file_type", options.fileType);
  }
  if (options?.columnMapping) {
    params.set("column_mapping", JSON.stringify(options.columnMapping));
  }

  const query = params.toString();
  const url = `${API_BASE}/projects/${projectId}/uploads${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return response.json();
}
