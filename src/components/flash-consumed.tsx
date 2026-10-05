"use client";

import { useEffect } from "react";
import type { FlashName } from "@/lib/flash";

/**
 * Ставится рядом с показанным флеш-сообщением: после показа удаляет его куку,
 * чтобы при обновлении страницы сообщение не появилось снова. Через маршрут,
 * а не Server Action, — иначе страница обновится и сообщение сразу исчезнет.
 */
export function FlashConsumed({ name }: { name: FlashName }) {
  useEffect(() => {
    void fetch(`/api/flash?name=${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => undefined);
  }, [name]);
  return null;
}
