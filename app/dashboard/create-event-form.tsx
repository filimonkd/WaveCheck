"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { createEvent, type CreateEventState } from "./actions";

const initialState: CreateEventState = { status: "idle" };

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return <p className="text-destructive text-sm">{message}</p>;
}

export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(createEvent, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <Input id="title" name="title" required placeholder="Spring Conference" />
        <FieldError message={errors.title} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <Input id="description" name="description" placeholder="Optional" />
        <FieldError message={errors.description} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="startTime" className="text-sm font-medium">
            Starts
          </label>
          <Input id="startTime" name="startTime" type="datetime-local" required />
          <FieldError message={errors.startTime} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="endTime" className="text-sm font-medium">
            Ends
          </label>
          <Input id="endTime" name="endTime" type="datetime-local" required />
          <FieldError message={errors.endTime} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="maxCapacity" className="text-sm font-medium">
            Capacity
          </label>
          <Input
            id="maxCapacity"
            name="maxCapacity"
            type="number"
            min={1}
            defaultValue={100}
            required
          />
          <FieldError message={errors.maxCapacity} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue="DRAFT"
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </select>
          <FieldError message={errors.status} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create Event"}
        </Button>

        {state.message ? (
          <p
            className={cn(
              "text-sm",
              state.status === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
            role="status"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
