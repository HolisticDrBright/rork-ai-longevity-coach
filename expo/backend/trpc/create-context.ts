import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { createAnonSupabaseClient, createServerSupabaseClient } from "../supabase-server";

interface AuthUser {
  id: string;
  email: string | undefined;
  role: string;
}

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const authHeader = opts.req.headers.get("authorization");
  const sessionToken = authHeader?.replace("Bearer ", "") || null;

  let user: AuthUser | null = null;

  if (sessionToken) {
    try {
      const supabase = createAnonSupabaseClient();
      const { data, error } = await supabase.auth.getUser(sessionToken);

      if (!error && data?.user) {
        user = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role ?? "authenticated",
        };
      } else {
        console.log("[tRPC:context] Token validation failed");
      }
    } catch {
      console.log("[tRPC:context] Token validation error");
    }
  }

  return {
    req: opts.req,
    sessionToken,
    user,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : shape.message,
      data: {
        ...shape.data,
        stack: undefined,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      sessionToken: ctx.sessionToken!,
    },
  });
});

/**
 * Clinician-only procedure. Checks the user's `profiles.role` is
 * 'clinician', 'staff', or 'admin'. Use this on any endpoint that
 * reads other patients' data or performs sign-off / acknowledgement
 * actions on behalf of the clinic.
 *
 * If the `profiles` table doesn't have a role column (older deploys)
 * the check fails closed — better to reject a real clinician until the
 * migration runs than to silently allow a patient to acknowledge their
 * own red flags.
 */
export const clinicianProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // Use the user's own session client so profile RLS (auth.uid() = id)
  // permits self-read of the role column. The anon client would fail
  // against typical profiles RLS that requires authentication.
  const supabase = createServerSupabaseClient(ctx.sessionToken);
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", ctx.user.id)
    .maybeSingle();

  if (error) {
    console.log("[tRPC:clinicianProcedure] profile lookup failed:", error.message);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Clinician role check failed",
    });
  }
  const role = (data as { role?: string } | null)?.role;
  if (role !== "clinician" && role !== "staff" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Clinician role required",
    });
  }
  return next({
    ctx: {
      ...ctx,
      clinicianRole: role,
    },
  });
});
