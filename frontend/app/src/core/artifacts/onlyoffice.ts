import { authFetch } from "@/core/auth/fetch";

import { urlOfOnlyOfficeConfig } from "./utils";

export type OnlyOfficeMode = "view" | "edit";
export type OnlyOfficeDocumentType = "word" | "cell" | "slide";

export interface OnlyOfficeDocumentDescriptor {
  documentType: OnlyOfficeDocumentType;
  defaultMode: OnlyOfficeMode;
  editorLabel: string;
}

export interface OnlyOfficeConfigResponse {
  documentServerUrl: string;
  config: Record<string, unknown>;
}

const officeDocumentDescriptors: Record<string, OnlyOfficeDocumentDescriptor> = {
  doc: {
    documentType: "word",
    defaultMode: "view",
    editorLabel: "Document editor",
  },
  docx: {
    documentType: "word",
    defaultMode: "edit",
    editorLabel: "Document editor",
  },
  xls: {
    documentType: "cell",
    defaultMode: "view",
    editorLabel: "Spreadsheet editor",
  },
  xlsx: {
    documentType: "cell",
    defaultMode: "edit",
    editorLabel: "Spreadsheet editor",
  },
  ppt: {
    documentType: "slide",
    defaultMode: "view",
    editorLabel: "Presentation editor",
  },
  pptx: {
    documentType: "slide",
    defaultMode: "edit",
    editorLabel: "Presentation editor",
  },
};

export function getOnlyOfficeDocumentDescriptor(
  filepath: string,
): OnlyOfficeDocumentDescriptor | null {
  if (filepath.startsWith("write-file:")) {
    return null;
  }

  const extension = filepath.split(".").pop()?.toLowerCase();
  if (!extension) {
    return null;
  }

  return officeDocumentDescriptors[extension] ?? null;
}

export function isOnlyOfficeDocument(filepath: string) {
  return getOnlyOfficeDocumentDescriptor(filepath) !== null;
}

export async function loadOnlyOfficeConfig({
  filepath,
  threadId,
  mode,
}: {
  filepath: string;
  threadId: string;
  mode: OnlyOfficeMode;
}): Promise<OnlyOfficeConfigResponse> {
  const res = await authFetch(
    urlOfOnlyOfficeConfig({
      filepath,
      threadId,
      mode,
    }),
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to load ONLYOFFICE configuration");
  }

  return (await res.json()) as OnlyOfficeConfigResponse;
}
