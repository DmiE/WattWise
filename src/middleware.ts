import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getProfile } from "@/lib/services/profile";
import { getActivePlan, isPlanExpired } from "@/lib/services/plan";

const PROTECTED_ROUTES = ["/dashboard", "/onboarding", "/profile", "/renewal"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }

    // Authenticated on a protected route: profile presence decides placement.
    // No profile yet → send to onboarding; already onboarded → keep out of it.
    // Guards against redirect loops by checking whether we're already there.
    const onOnboarding = context.url.pathname.startsWith("/onboarding");
    const onRenewal = context.url.pathname.startsWith("/renewal");
    const todayIso = new Date().toISOString().slice(0, 10);

    try {
      const profile = supabase ? await getProfile(supabase, context.locals.user.id) : null;
      if (!profile && !onOnboarding) {
        return context.redirect("/onboarding");
      }
      if (profile && onOnboarding) {
        return context.redirect("/dashboard");
      }

      // Renewal gate runs after the profile gate: an un-onboarded user has no
      // plan and must reach /onboarding first. For an onboarded user not on
      // onboarding, an expired active plan routes them to /renewal; an
      // ineligible user is bounced off /renewal.
      if (supabase && profile && !onOnboarding) {
        const active = await getActivePlan(supabase, context.locals.user.id);
        const expired = !!active && isPlanExpired(active, todayIso);
        if (expired && !onRenewal) {
          return context.redirect("/renewal");
        }
        if (!expired && onRenewal) {
          return context.redirect("/dashboard");
        }
      }
    } catch {
      // Profile lookup failed — fall open to the requested route rather than
      // misrouting an onboarded user on a transient read error.
    }
  }

  return next();
});
