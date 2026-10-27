import { NextResponse, type NextRequest } from "next/server";
import { ACTIVITY_COOKIE, activityStamp, idleVerdict, readActivityStamp } from "@/lib/idle-timeout";
import { isHttpsRequest } from "@/lib/request-security";

const SESSION_COOKIE = "pts_session";
const COOKIE_MAX_AGE = 60 * 60 * 12;

/**
 * Выход при бездействии (src/lib/idle-timeout.ts): до страниц и действий
 * сеанс, в котором не работали дольше предела, не доходит — переход ведёт на
 * вход с пояснением, а действие получает «сеанса нет» (и тоже ведёт на вход).
 * Остальные проверки сеанса — в src/lib/session.ts.
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return NextResponse.next();

  const now = Date.now();
  const verdict = idleVerdict(readActivityStamp(request.cookies.get(ACTIVITY_COOKIE)?.value, token, secret), now);
  if (verdict === "fresh") return NextResponse.next();

  if (verdict === "refresh") {
    const response = NextResponse.next();
    response.cookies.set(ACTIVITY_COOKIE, activityStamp(now, token, secret), {
      httpOnly: true,
      secure: isHttpsRequest({
        setting: process.env.COOKIE_SECURE,
        forwardedProto: request.headers.get("x-forwarded-proto"),
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      }),
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    return response;
  }

  const { pathname } = request.nextUrl;
  let response: NextResponse;
  if (request.method === "GET" && !pathname.startsWith("/login") && !pathname.startsWith("/api/")) {
    response = NextResponse.redirect(new URL("/login?idle=1", request.url));
  } else {
    // The app below sees no session and answers as for a signed-out visitor.
    request.cookies.delete(SESSION_COOKIE);
    request.cookies.delete(ACTIVITY_COOKIE);
    response = NextResponse.next({ request: { headers: request.headers } });
  }
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACTIVITY_COOKIE);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt).*)"],
};
