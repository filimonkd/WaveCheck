import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/** Shape every error response the API returns, so clients can rely on it. */
export function apiError(message: string, status: number, extra?: object) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Turn a Zod failure into a 400 listing the offending fields. */
export function validationError(error: ZodError) {
  return apiError("Invalid request body", 400, {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/** Parse a JSON body, tolerating a malformed or absent one. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** True when Prisma rejected a write for violating a unique constraint. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
