import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { createAnonSupabaseClient } from "../supabase-server";

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
 * Server-side role check against the user_roles table (RLS lets a user read
 * their own roles). Fails closed: no row or query error means no role.
 */
export async function getAppRoles(sessionToken: string, userId: string): Promise<string[]> {
  try {
    const { createServerSupabaseClient } = await import("../supabase-server");
    const sb = createServerSupabaseClient(sessionToken);
    const { data, error } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error || !data) return [];
    return data.map((r: { role: string }) => String(r.role));
  } catch {
    return [];
  }
}

/** Requires an authenticated user whose user_roles include practitioner/admin. */
export const practitionerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const roles = await getAppRoles(ctx.sessionToken, ctx.user.id);
  const isPractitioner = roles.includes("practitioner") || roles.includes("admin");
  if (!isPractitioner) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Practitioner role required",
    });
  }
  return next({
    ctx: {
      ...ctx,
      roles,
    },
  });
});
