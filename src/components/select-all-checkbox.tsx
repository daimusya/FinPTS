"use client";

/** «Отметить все»: ставит или снимает отметки у флажков с именем name, привязанных к форме formId. */
export function SelectAllCheckbox({ formId, name, label }: { formId: string; name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      onChange={(e) => {
        const boxes = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"][form="${formId}"]`);
        boxes.forEach((box) => {
          box.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
