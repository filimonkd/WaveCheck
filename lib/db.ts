import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma 7 connects through a driver adapter rather than a `url` in
 * schema.prisma, so the connection string is read here at runtime.
 */
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * Next.js clears the module registry on every hot reload in development, which
 * would otherwise open a brand new connection pool on each edit until Postgres
 * refuses them. Caching the client on `globalThis` survives those reloads.
 * In production the module is only evaluated once, so the cache is skipped.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

let client: ReturnType<typeof createPrismaClient> | undefined;

function getClient() {
  if (!client) {
    client = globalForPrisma.prisma ?? createPrismaClient();

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    }
  }

  return client;
}

/**
 * The client is built on first use rather than on import. `next build` imports
 * every route module to collect its configuration, so connecting eagerly here
 * would make a build fail on any machine without DATABASE_URL set — including
 * CI, which needs no database to typecheck, lint and build.
 */
export const db = new Proxy({} as ReturnType<typeof createPrismaClient>, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property, instance);

    // Methods must stay bound to the real client, not the proxy.
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export default db;
