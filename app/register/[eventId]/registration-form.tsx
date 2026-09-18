"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomFieldType } from "@/lib/generated/prisma/enums";

export type RegistrationField = {
  id: string;
  label: string;
  type: CustomFieldType;
  isRequired: boolean;
  /** Choices for DROPDOWN fields; empty for the other types. */
  options: string[];
};

type FormState =
  | { status: "idle" | "submitting" }
  | { status: "error"; message: string }
  | { status: "success"; credentialToken: string };

const SELECT_CLASS =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

/**
 * Reads one custom field out of the submitted form.
 *
 * A checkbox is absent from FormData when unticked, which is exactly the
 * "false" case — so booleans always produce an answer, and a required boolean
 * is satisfied either way. That matches how the API checks required fields:
 * it rejects undefined, null and "", and `false` is none of those.
 */
function readFieldValue(
  field: RegistrationField,
  form: FormData,
): string | boolean {
  if (field.type === CustomFieldType.BOOLEAN) {
    return form.get(field.id) !== null;
  }

  return String(form.get(field.id) ?? "");
}

export function RegistrationForm({
  eventId,
  fields,
}: {
  eventId: string;
  fields: RegistrationField[];
}) {
  const [state, setState] = useState<FormState>({ status: "idle" });

  async function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setState({ status: "submitting" });

    const form = new FormData(formEvent.currentTarget);

    // Keyed by CustomField.id, which is what the API validates against.
    const customFieldResponses: Record<string, string | boolean> = {};

    for (const field of fields) {
      customFieldResponses[field.id] = readFieldValue(field, form);
    }

    try {
      const response = await fetch("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          attendee: {
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          },
          customFieldResponses,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setState({
          status: "error",
          message: body?.error ?? "Registration failed. Please try again.",
        });
        return;
      }

      setState({
        status: "success",
        credentialToken: body.registration.credentialToken,
      });
    } catch {
      setState({
        status: "error",
        message: "Could not reach the server. Please try again.",
      });
    }
  }

  if (state.status === "success") {
    return (
      <div className="space-y-3" role="status">
        <p className="font-medium">Success! You are registered.</p>
        <p className="text-muted-foreground text-sm">Your ticket token is:</p>
        <code className="bg-muted block rounded-md px-3 py-2 font-mono text-sm break-all">
          {state.credentialToken}
        </code>
        <p className="text-muted-foreground text-sm">
          Save this for check-in — it is what the kiosk scans on arrival.
        </p>
      </div>
    );
  }

  const pending = state.status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">
          At least 8 characters. Creates your attendee account, or signs you in
          if you already have one.
        </p>
      </div>

      {fields.map((field) => {
        if (field.type === CustomFieldType.BOOLEAN) {
          return (
            <div key={field.id} className="flex items-center gap-2">
              <input
                id={field.id}
                name={field.id}
                type="checkbox"
                className="border-input text-primary focus-visible:ring-ring h-4 w-4 rounded border focus-visible:ring-2 focus-visible:ring-offset-2"
              />
              <label htmlFor={field.id} className="text-sm font-medium">
                {field.label}
              </label>
            </div>
          );
        }

        return (
          <div key={field.id} className="space-y-1.5">
            <label htmlFor={field.id} className="text-sm font-medium">
              {field.label}
              {field.isRequired ? null : (
                <span className="text-muted-foreground"> (optional)</span>
              )}
            </label>

            {field.type === CustomFieldType.DROPDOWN ? (
              <select
                id={field.id}
                name={field.id}
                required={field.isRequired}
                defaultValue=""
                className={SELECT_CLASS}
              >
                <option value="" disabled={field.isRequired}>
                  Select…
                </option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input id={field.id} name={field.id} required={field.isRequired} />
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Registering…" : "Register"}
        </Button>

        {state.status === "error" ? (
          <p className="text-destructive text-sm" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
