import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { createAnonSupabaseClient, createServerSupabaseClient } from "../supabase-server";

type AppRole = "admin" | "practitioner" | "authenticated";

interface AuthUser {
  id: string;
  email: string | undefined;
  role: string;
  appRoles: AppRole[];
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
        // Fetch application-level roles from user_roles table
        let appRoles: AppRole[] = ["authenticated"];
        try {
          const sb = createServerSupabaseClient(sessionToken!);
          const { data: roleRows } = await sb
            .from("user_roles")
            .select("role")
            .eq("user_id", data.user.id);
          if (roleRows && roleRows.length > 0) {
            appRoles = roleRows.map((r: { role: string }) => r.role as AppRole);
            if (!appRoles.includes("authenticated")) {
              appRoles.push("authenticated");
            }
          }
        } catch {
          // Role lookup failed — proceed with default "authenticated"
        }

        user = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role ?? "authenticated",
          appRoles,
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
 * Procedure that requires the user to have a specific app role.
 * Usage: clinicianProcedure or adminProcedure
 */
function createRoleProcedure(...requiredRoles: AppRole[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const hasRole = requiredRoles.some((role) =>
      ctx.user.appRoles.includes(role)
    );
    if (!hasRole) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires one of: ${requiredRoles.join(", ")}`,
      });
    }
    return next({ ctx });
  });
}

/** Requires admin or practitioner role */
export const clinicianProcedure = createRoleProcedure("admin", "practitioner");

/** Requires admin role */
export const adminProcedure = createRoleProcedure("admin");
