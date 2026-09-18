import { db } from "../lib/db";
import {
  CustomFieldType,
  DeviceStatus,
  EventStatus,
  RegistrationStatus,
  Role,
} from "../lib/generated/prisma/enums";
import { hashPassword } from "../lib/password";

/**
 * Demo data for local development, with fixed identifiers so the check-in
 * endpoint can be exercised straight away. Idempotent — safe to re-run.
 */
const DEMO_PASSWORD = "password123";
const DEMO_CREDENTIAL_TOKEN = "demo-credential-0001";
const DEMO_DEVICE_IDENTIFIER = "KIOSK-001";

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const organizer = await db.user.upsert({
    where: { email: "organizer@wavecheck.test" },
    // Named on update too, so re-seeding an existing database backfills it.
    update: { name: "Demo Organizer" },
    create: {
      email: "organizer@wavecheck.test",
      name: "Demo Organizer",
      passwordHash,
      role: Role.ORGANIZER,
    },
  });

  const attendee = await db.user.upsert({
    where: { email: "attendee@wavecheck.test" },
    update: { name: "Demo Attendee" },
    create: {
      email: "attendee@wavecheck.test",
      name: "Demo Attendee",
      passwordHash,
      role: Role.ATTENDEE,
    },
  });

  const existingEvent = await db.event.findFirst({
    where: { title: "WaveCheck Launch Conference" },
  });

  const event =
    existingEvent ??
    (await db.event.create({
      data: {
        organizerId: organizer.id,
        title: "WaveCheck Launch Conference",
        description: "Demo event seeded for local development.",
        startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        maxCapacity: 100,
        status: EventStatus.PUBLISHED,
        customFields: {
          create: [
            {
              label: "Dietary requirements",
              type: CustomFieldType.DROPDOWN,
              isRequired: false,
              options: ["None", "Vegetarian", "Vegan", "Gluten-free"],
            },
            {
              label: "Job title",
              type: CustomFieldType.TEXT,
              isRequired: false,
            },
          ],
        },
      },
    }));

  await db.registration.upsert({
    where: {
      eventId_attendeeId: { eventId: event.id, attendeeId: attendee.id },
    },
    update: {},
    create: {
      eventId: event.id,
      attendeeId: attendee.id,
      credentialToken: DEMO_CREDENTIAL_TOKEN,
      status: RegistrationStatus.REGISTERED,
      customFieldResponses: {},
    },
  });

  await db.device.upsert({
    where: { deviceIdentifier: DEMO_DEVICE_IDENTIFIER },
    update: {},
    create: {
      deviceIdentifier: DEMO_DEVICE_IDENTIFIER,
      locationName: "Main Entrance",
      status: DeviceStatus.OFFLINE,
    },
  });

  console.log("Seeded:");
  console.log(`  organizer  Demo Organizer <organizer@wavecheck.test> / ${DEMO_PASSWORD}`);
  console.log(`  attendee   Demo Attendee <attendee@wavecheck.test> / ${DEMO_PASSWORD}`);
  console.log(`  event      ${event.id}`);
  console.log(`  device     ${DEMO_DEVICE_IDENTIFIER}`);
  console.log(`  credential ${DEMO_CREDENTIAL_TOKEN}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
