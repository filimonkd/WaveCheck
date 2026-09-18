"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EventStatus, Role } from "@/lib/generated/prisma/enums";

const ORGANIZER_ROLES: Role[] = [Role.ORGANIZER, Role.ADMIN];

export type CreateEventState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
};

const createEventSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(5000).optional(),
    startTime: z.coerce.date("Start time is required"),
    endTime: z.coerce.date("End time is required"),
    maxCapacity: z.coerce
      .number("Capacity must be a number")
      .int("Capacity must be a whole number")
      .positive("Capacity must be greater than zero"),
    status: z.enum([EventStatus.DRAFT, EventStatus.PUBLISHED]),
  })
  .refine((event) => event.endTime > event.startTime, {
    message: "End time must be after the start time",
    path: ["endTime"],
  });

/**
 * Creates an event owned by the signed-in organizer.
 *
 * Server Actions are reachable by a direct POST, not only through this form,
 * so the session and role are checked here rather than relying on `proxy.ts`
 * — that only confirms a session cookie exists.
 */
export async function createEvent(
  _previousState: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const session = await auth();

  if (!session?.user) {
    return { status: "error", message: "You need to sign in first." };
  }

  if (!ORGANIZER_ROLES.includes(session.user.role)) {
    return {
      status: "error",
      message: "Only organizers and admins can create events.",
    };
  }

  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    maxCapacity: formData.get("maxCapacity"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");

      // Keep the first message per field; later ones are usually noisier.
      fieldErrors[field] ??= issue.message;
    }

    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  const event = await db.event.create({
    data: { ...parsed.data, organizerId: session.user.id },
  });

  revalidatePath("/dashboard");

  return { status: "success", message: `Created "${event.title}".` };
}
