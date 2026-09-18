"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Key the dietary answer is stored under in `Registration.customFieldResponses`.
 *
 * The API keys responses by `CustomField.id` when it checks an event's
 * required fields, so this hardcoded field is stored alongside rather than
 * satisfying one. An event with required custom fields will be rejected until
 * this form renders the event's real fields.
 */
const DIETARY_RESPONSE_KEY = "dietaryRestriction";

type FormState =
  | { status: "idle" | "submitting" }
  | { status: "error"; message: string }
  | { status: "success"; credentialToken: string };

export function RegistrationForm({ eventId }: { eventId: string }) {
  const [state, setState] = useState<FormState>({ status: "idle" });

  async function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setState({ status: "submitting" });

    const form = new FormData(formEvent.currentTarget);

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
          customFieldResponses: {
            [DIETARY_RESPONSE_KEY]: String(form.get("dietaryRestriction") ?? ""),
          },
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
        <p className="text-muted-foreground text-sm">
          Your ticket token is:
        </p>
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

      <div className="space-y-1.5">
        <label htmlFor="dietaryRestriction" className="text-sm font-medium">
          Dietary Restriction
        </label>
        <Input
          id="dietaryRestriction"
          name="dietaryRestriction"
          placeholder="e.g. Vegetarian"
        />
      </div>

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
