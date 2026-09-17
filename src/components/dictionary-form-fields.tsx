import type { FieldOption, FieldType } from "@/lib/dictionaries/types";

export interface ResolvedField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  defaultValue?: string | boolean;
}

function toDateInputValue(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function resolveFieldDefault(type: FieldType, value: unknown): string | boolean {
  if (type === "checkbox") return Boolean(value);
  if (value === null || value === undefined) return "";
  if (type === "date") return toDateInputValue(value);
  return String(value);
}

export function DictionaryFormFields({ fields }: { fields: ResolvedField[] }) {
  return (
    <div className="form-grid">
      {fields.map((field) => (
        <label className="field" key={field.name}>
          <span>
            {field.label}
            {field.required ? " *" : ""}
          </span>
          {field.type === "select" ? (
            <select name={field.name} required={field.required} defaultValue={field.defaultValue as string}>
              <option value="">— не выбрано —</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input
              type="checkbox"
              name={field.name}
              defaultChecked={Boolean(field.defaultValue)}
              style={{ width: 18, height: 18 }}
            />
          ) : (
            <input
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              step={field.type === "number" ? "0.01" : undefined}
              name={field.name}
              required={field.required}
              defaultValue={field.defaultValue as string}
            />
          )}
        </label>
      ))}
    </div>
  );
}
