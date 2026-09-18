"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeviceStatus, EventStatus, Role } from "@/lib/generated/prisma/enums";
import { hashPassword } from "@/lib/password";

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

export type GenerateCredentialsState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Present exactly once, on the response that created the device. */
  credentials?: {
    deviceIdentifier: string;
    locationName: string;
    apiKey: string;
  };
};

const generateCredentialsSchema = z.object({
  deviceIdentifier: z.string().trim().min(1).max(200).optional(),
  locationName: z.string().trim().min(1, "Location is required").max(200),
});

/**
 * Issues credentials for a new kiosk.
 *
 * The key is returned in plain text on this response and never again — only
 * its scrypt hash is stored, so a leaked database cannot be used to
 * impersonate a terminal. Losing the key means issuing a new device.
 */
export async function generateDeviceCredentials(
  _previousState: GenerateCredentialsState,
  formData: FormData,
): Promise<GenerateCredentialsState> {
  const session = await auth();

  if (!session?.user) {
    return { status: "error", message: "You need to sign in first." };
  }

  if (!ORGANIZER_ROLES.includes(session.user.role)) {
    return {
      status: "error",
      message: "Only organizers and admins can provision kiosks.",
    };
  }

  const parsed = generateCredentialsSchema.safeParse({
    deviceIdentifier: formData.get("deviceIdentifier") || undefined,
    locationName: formData.get("locationName"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};

    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] ??= issue.message;
    }

    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  const deviceIdentifier =
    parsed.data.deviceIdentifier ??
    `KIOSK-${randomBytes(4).toString("hex").toUpperCase()}`;

  const existing = await db.device.findUnique({ where: { deviceIdentifier } });

  if (existing) {
    return {
      status: "error",
      message: `A device called "${deviceIdentifier}" already exists. Key rotation is not supported yet — choose another identifier.`,
    };
  }

  // 256 bits from a CSPRNG. base64url keeps it safe to paste into a header.
  const apiKey = randomBytes(32).toString("base64url");

  await db.device.create({
    data: {
      deviceIdentifier,
      locationName: parsed.data.locationName,
      apiKeyHash: await hashPassword(apiKey),
      // OFFLINE until the kiosk actually reports in.
      status: DeviceStatus.OFFLINE,
    },
  });

  return {
    status: "success",
    message: "Copy the key now — it cannot be shown again.",
    credentials: {
      deviceIdentifier,
      locationName: parsed.data.locationName,
      apiKey,
    },
  };
}
