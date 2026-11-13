"use client";

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import styles from "./finance-appearance.module.css";

const storageKey = "pts-finance-appearance";
const defaults = { background: "#f2f4f6", accent: "#485c00" };
const initial = { background: "#f6f7f8", accent: "#ff6a13", original: true };
const accents = [
  ["Оливковый", defaults.accent],
  ["Фирменный", "#ff6a13"],
  ["Медный", "#d9884f"],
  ["Янтарный", "#e9a834"],
] as const;
const defaultSnapshot = JSON.stringify(defaults);
let sessionSnapshot: string | undefined;
const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function subscribe(notify: () => void) {
  window.addEventListener(storageKey, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(storageKey, notify);
    window.removeEventListener("storage", notify);
  };
}

function getSnapshot() {
  try {
    return sessionSnapshot ?? localStorage.getItem(storageKey) ?? defaultSnapshot;
  } catch {
    return sessionSnapshot ?? defaultSnapshot;
  }
}

function readColors(snapshot: string) {
  try {
    const saved = JSON.parse(snapshot);
    if (saved?.background === defaults.background && saved?.accent === "#ff6a13" && !saved.customized) {
      return defaults;
    }
    if (saved?.original === true) return initial;
    return {
      background: isColor(saved?.background) ? saved.background : defaults.background,
      accent: isColor(saved?.accent) ? saved.accent : defaults.accent,
    };
  } catch {
    return defaults;
  }
}

function update(next: typeof defaults & { original?: boolean }) {
  const snapshot = JSON.stringify({ ...next, customized: true });
  try {
    localStorage.setItem(storageKey, snapshot);
    sessionSnapshot = undefined;
  } catch {
    sessionSnapshot = snapshot;
  }
  window.dispatchEvent(new Event(storageKey));
}

export function FinanceAppearance({ children }: { children: ReactNode }) {
  const colors = readColors(useSyncExternalStore(subscribe, getSnapshot, () => defaultSnapshot));

  return (
    <div className={`app-shell ${"original" in colors ? "" : styles.shell}`} style={{
      "--finance-background": colors.background,
      "--finance-accent": colors.accent,
    } as CSSProperties}>
      {children}
    </div>
  );
}

export function FinanceColorSettings() {
  const colors = readColors(useSyncExternalStore(subscribe, getSnapshot, () => defaultSnapshot));
  return (
    <details className={styles.settings}>
      <summary>Цвета оформления</summary>
      <div className={styles.controls}>
        <label>Фон <input type="color" value={colors.background} onInput={(event) => update({ ...colors, original: false, background: event.currentTarget.value })} /></label>
        <label>Акцент <input type="color" value={colors.accent} onInput={(event) => update({ ...colors, original: false, accent: event.currentTarget.value })} /></label>
        {accents.map(([label, accent]) => (
          <button key={accent} type="button" className="btn btn-secondary btn-sm"
            aria-pressed={colors.accent === accent} onClick={() => update({ ...colors, accent })}>
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" aria-pressed={"original" in colors} onClick={() => update(initial)}>Стандарт</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => update(defaults)}>Сбросить цвета</button>
      </div>
    </details>
  );
}
