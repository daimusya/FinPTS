import { clearFlash, isFlashName } from "@/lib/flash";

/**
 * Удаление показанного флеш-сообщения (например, временного пароля), чтобы
 * оно не появлялось снова при обновлении страницы. Удаляет только куку
 * самого браузера и только из известного списка имён.
 */
export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!isFlashName(name)) return Response.json({ error: "unknown flash" }, { status: 400 });
  await clearFlash(name);
  return new Response(null, { status: 204 });
}
