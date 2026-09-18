"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  generateDeviceCredentials,
  type GenerateCredentialsState,
} from "./actions";

const initialState: GenerateCredentialsState = { status: "idle" };

export function GenerateCredentialsForm() {
  const [state, formAction, pending] = useActionState(
    generateDeviceCredentials,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const errors = state.fieldErrors ?? {};

  async function copyKey(apiKey: string) {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the key stays selectable on screen.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="deviceIdentifier" className="text-sm font-medium">
              Device Identifier{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="deviceIdentifier"
              name="deviceIdentifier"
              placeholder="Generated if left blank"
            />
            {errors.deviceIdentifier ? (
              <p className="text-destructive text-sm">
                {errors.deviceIdentifier}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="kioskLocation" className="text-sm font-medium">
              Location
            </label>
            <Input
              id="kioskLocation"
              name="locationName"
              placeholder="Main Entrance"
              required
            />
            {errors.locationName ? (
              <p className="text-destructive text-sm">{errors.locationName}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate Kiosk Credentials"}
          </Button>

          {state.status === "error" && state.message ? (
            <p className="text-destructive text-sm" role="alert">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>

      {state.credentials ? (
        <div
          role="alert"
          className={cn(
            "space-y-3 rounded-lg border-2 p-4",
            "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
          )}
        >
          <p className="font-semibold">
            Save these now — the key is not stored and cannot be shown again.
          </p>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Device Identifier</dt>
              <dd className="font-mono break-all">
                {state.credentials.deviceIdentifier}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Location</dt>
              <dd>{state.credentials.locationName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">API Key</dt>
              <dd
                data-testid="device-api-key"
                className="bg-background mt-1 rounded-md px-3 py-2 font-mono break-all select-all"
              >
                {state.credentials.apiKey}
              </dd>
            </div>
          </dl>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => copyKey(state.credentials!.apiKey)}
          >
            {copied ? "Copied" : "Copy key"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
