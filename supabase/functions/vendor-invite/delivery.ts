// Where an invitation may be dispatched from, decided before any Auth call.
// Disabled unless MERCURIUS_INVITATION_MODE names a mode whose every condition holds:
//
// - `local-test`: loopback/local Kong Supabase over HTTP and a loopback site.
// - `hosted`: the Supabase project and site origin the owner pinned when arming the
//   mode. `SUPABASE_URL` must be `https://<ref>.supabase.co` with that exact ref, and
//   `SITE_URL` must be the pinned HTTPS origin. A copied secret set, a preview site or a
//   custom Auth domain therefore fails closed instead of inviting from the wrong place.
//
// Returns the site root the recipient is redirected to, or null when dispatch is off.

type Environment = (name: string) => string | undefined;

const read = (env: Environment, name: string) => env(name)?.trim() ?? "";

function bareRoot(value: string, protocol: "http:" | "https:") {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === protocol &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    ? parsed
    : null;
}

const loopback = ["127.0.0.1", "localhost"];

export function invitationDeliverySite(env: Environment): URL | null {
  const mode = read(env, "MERCURIUS_INVITATION_MODE");
  if (mode === "local-test") {
    const backend = bareRoot(read(env, "SUPABASE_URL"), "http:");
    const site = bareRoot(read(env, "SITE_URL"), "http:");
    return backend && [...loopback, "kong"].includes(backend.hostname) &&
        site && loopback.includes(site.hostname)
      ? site
      : null;
  }
  if (mode === "hosted") {
    const ref = read(env, "MERCURIUS_INVITATION_PROJECT_REF");
    const pinnedOrigin = read(env, "MERCURIUS_INVITATION_SITE_ORIGIN");
    const backend = bareRoot(read(env, "SUPABASE_URL"), "https:");
    const site = bareRoot(read(env, "SITE_URL"), "https:");
    const pinned = bareRoot(pinnedOrigin, "https:");
    return /^[a-z0-9]{20}$/.test(ref) &&
        backend && !backend.port && backend.hostname === `${ref}.supabase.co` &&
        site && pinned && !site.port && site.origin === pinned.origin &&
        // The pin is an origin, written without a trailing path or slash variants.
        pinnedOrigin === pinned.origin &&
        !loopback.includes(site.hostname) &&
        // A bare IP literal is not a reviewed site; hostnames must contain a letter.
        /[a-z]/.test(site.hostname.split(".").at(-1) ?? "") &&
        !site.hostname.startsWith("[")
      ? site
      : null;
  }
  return null;
}
