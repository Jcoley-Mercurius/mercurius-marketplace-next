import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getBrowserEnvironment } from "@/lib/env/browser";

type ProtectedRole = "admin" | "vendor";

function requiredRoleForPath(pathname: string): ProtectedRole {
  return pathname === "/admin" || pathname.startsWith("/admin/")
    ? "admin"
    : "vendor";
}

function copySessionCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  destination: string | URL,
) {
  return copySessionCookies(
    sessionResponse,
    NextResponse.redirect(new URL(destination, request.url)),
  );
}

/**
 * Server-side portal gate. Client layout checks remain as defense in depth,
 * while this guard prevents protected pages from rendering before auth and
 * role membership have been verified against Supabase.
 */
export async function proxy(request: NextRequest) {
  let sessionResponse = NextResponse.next({ request });
  const env = getBrowserEnvironment();

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          sessionResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            sessionResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser validates the access token with Supabase Auth before it is trusted.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requiredRole = requiredRoleForPath(request.nextUrl.pathname);

  if (!user) {
    const loginUrl = new URL(
      requiredRole === "admin" ? "/login" : "/login/vendor",
      request.url,
    );
    loginUrl.searchParams.set(
      "redirect",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return copySessionCookies(
      sessionResponse,
      NextResponse.redirect(loginUrl),
    );
  }

  const { data: hasRequiredRole, error: roleError } = await supabase.rpc(
    "has_role",
    {
      _user_id: user.id,
      _role: requiredRole,
    },
  );

  // Fail closed if the role lookup is unavailable or membership is absent.
  if (roleError || !hasRequiredRole) {
    return redirectWithSession(
      request,
      sessionResponse,
      requiredRole === "admin" ? "/" : "/dashboard",
    );
  }

  return sessionResponse;
}

export const config = {
  matcher: ["/admin/:path*", "/vendor/:path*"],
};
