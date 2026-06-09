import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getProfile } from "@/lib/services/profile";

const PROTECTED_ROUTES = ["/dashboard", "/onboarding"];

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
    const profile = supabase ? await getProfile(supabase, context.locals.user.id) : null;
    const onOnboarding = context.url.pathname.startsWith("/onboarding");

    if (!profile && !onOnboarding) {
      return context.redirect("/onboarding");
    }
    if (profile && onOnboarding) {
      return context.redirect("/dashboard");
    }
  }

  return next();
});
