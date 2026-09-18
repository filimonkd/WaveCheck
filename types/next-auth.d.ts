import type { DefaultSession } from "next-auth";

import type { Role } from "@/lib/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

// `next-auth/jwt` only re-exports `@auth/core/jwt`, so the JWT interface has
// to be augmented at its source for the extra claims to be visible.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
