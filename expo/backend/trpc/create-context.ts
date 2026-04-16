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
      } else if (process.env.NODE_ENV !== "production") {
        console.log("[tRPC:context] Token validation failed");
      }
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.log("[tRPC:context] Token validation error");
      }
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
