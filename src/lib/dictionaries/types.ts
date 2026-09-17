import type { PermissionCode } from "@/lib/permissions";

export type FieldType = "text" | "number" | "date" | "checkbox" | "select";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  loadOptions?: (excludeId?: string) => Promise<FieldOption[]>;
  formatValue?: (value: unknown) => string;
  /** Used to prefill new-record forms and as the stored value when the field is left empty (for columns with a non-null DB default). */
  defaultValue?: string;
}

export interface DictionaryDelegate {
  findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
}

export interface DictionaryConfig {
  slug: string;
  title: string;
  singularTitle: string;
  entityAuditType: string;
  delegate: DictionaryDelegate;
  fields: FieldConfig[];
  listColumns: string[];
  permissionView: PermissionCode;
  permissionManage: PermissionCode;
  orderBy?: Record<string, "asc" | "desc">;
}
