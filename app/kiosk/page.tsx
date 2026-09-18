"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEVICE_API_KEY_HEADER,
  DEVICE_IDENTIFIER_HEADER,
} from "@/lib/hardware-headers";
import { cn } from "@/lib/utils";

const HEARTBEAT_INTERVAL_MS = 60_000;
const MIN_SEARCH_LENGTH = 3;
const STORAGE_KEY = "wavecheck.kiosk.credentials";

type Credentials = { deviceIdentifier: string; apiKey: string };

/**
 * Credentials live in localStorage so a tablet that reloads — or reboots —
 * comes back ready without a staff member re-entering the key.
 *
 * That does mean the key sits in the browser of a public terminal. It is
 * scoped to one device and revocable by deleting the Device row, but treat a
 * lost tablet as a lost key. Every accessor is guarded: storage can be
 * disabled or throw in private browsing.
 */
function readStoredCredentials(): Credentials | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Credentials).deviceIdentifier === "string" &&
      typeof (parsed as Credentials).apiKey === "string"
    ) {
      return parsed as Credentials;
    }

    return null;
  } catch {
    return null;
  }
}

function writeStoredCredentials(credentials: Credentials) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // Not fatal: the kiosk still works for this session.
  }
}

function clearStoredCredentials() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

function authHeaders(credentials: Credentials): Record<string, string> {
  return {
    [DEVICE_IDENTIFIER_HEADER]: credentials.deviceIdentifier,
    [DEVICE_API_KEY_HEADER]: credentials.apiKey,
  };
}

type KioskEvent = {
  id: string;
  title: string;
  startTime: string;
  maxCapacity: number;
  totalRegistrations: number;
  checkedIn: number;
};

type SearchResult = {
  id: string;
  status: string;
  checkedInAt: string | null;
  name: string | null;
  email: string;
};

type Outcome = {
  ok: boolean;
  headline: string;
  detail?: string;
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Short confirmation tones, so staff need not watch the screen. */
function useTones() {
  const contextRef = useRef<AudioContext | null>(null);

  // Browsers only allow audio after a user gesture, so this is primed by the
  // Connect click rather than on mount.
  const prime = useCallback(() => {
    if (contextRef.current) return;

    try {
      contextRef.current = new AudioContext();
    } catch {
      // No audio available; visuals still carry the result.
    }
  }, []);

  const play = useCallback((frequency: number) => {
    const context = contextRef.current;
    if (!context) return;

    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value = frequency;
      gain.gain.value = 0.04;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    } catch {
      // Ignore: a failed beep must never block a check-in.
    }
  }, []);

  return { prime, play };
}

export default function KioskPage() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [restoring, setRestoring] = useState(true);

  const [identifierInput, setIdentifierInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [locationName, setLocationName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [events, setEvents] = useState<KioskEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Bumped on every scan so the focus effect re-runs even when two scans
  // produce an identical outcome.
  const [focusNonce, setFocusNonce] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  const tokenInputRef = useRef<HTMLInputElement>(null);
  const { prime, play } = useTones();

  const selectedEvent = events.find((event) => event.id === selectedEventId);

  const refreshEvents = useCallback(async (active: Credentials) => {
    try {
      const response = await fetch("/api/hardware/events", {
        headers: authHeaders(active),
      });
      if (!response.ok) return;

      const body = await response.json();
      const list: KioskEvent[] = body.events ?? [];
      setEvents(list);
      setSelectedEventId((current) =>
        current || (list.length > 0 ? list[0].id : ""),
      );
    } catch {
      // Leave the last known list on screen rather than blanking the kiosk.
    }
  }, []);

  /** Authenticate, then load the event list. */
  const connect = useCallback(
    async (candidate: Credentials, location?: string) => {
      const response = await fetch("/api/hardware/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(candidate),
        },
        body: JSON.stringify(location ? { locationName: location } : {}),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        return { ok: false as const, error: body?.error ?? "Could not register this device." };
      }

      setLocationName(body.device?.locationName ?? "");
      await refreshEvents(candidate);
      setCredentials(candidate);

      return { ok: true as const };
    },
    [refreshEvents],
  );

  /** Come back authenticated after a reload, or fall back to provisioning. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = readStoredCredentials();

        if (stored) {
          const result = await connect(stored);

          // Credentials that no longer work are worse than none: clear them
          // so staff are prompted rather than left at a dead terminal.
          if (!cancelled && !result.ok) {
            clearStoredCredentials();
          }
        }
      } catch {
        // Offline at boot: keep the stored key and let staff retry.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connect]);

  /**
   * Keep the scanner focused: on entry, and after every scan.
   *
   * `scanning` is in the dependencies on purpose. The input is disabled while
   * a check-in is in flight, and a disabled element cannot take focus — so
   * refocusing only on `focusNonce` would silently no-op and the next badge
   * tap would go nowhere. Re-running as it becomes enabled again is what
   * makes this reliable.
   */
  useEffect(() => {
    if (credentials && !scanning) {
      tokenInputRef.current?.focus();
    }
  }, [credentials, scanning, focusNonce]);

  /** Keep the Device row alive while this terminal is on. */
  useEffect(() => {
    if (!credentials) return;

    const beat = () => {
      void fetch("/api/hardware/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(credentials),
        },
        body: "{}",
      }).catch(() => {
        // A missed beat is not worth interrupting check-in for.
      });
    };

    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [credentials]);

  async function handleConnect(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setConnecting(true);
    setConnectError(null);
    prime();

    const candidate: Credentials = {
      deviceIdentifier: identifierInput.trim(),
      apiKey: apiKeyInput.trim(),
    };

    try {
      const result = await connect(candidate, locationName.trim() || undefined);

      if (!result.ok) {
        setConnectError(result.error);
        return;
      }

      writeStoredCredentials(candidate);
      setApiKeyInput("");
    } catch {
      setConnectError("Could not reach the server.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    clearStoredCredentials();
    setCredentials(null);
    setEvents([]);
    setSelectedEventId("");
    setOutcome(null);
    setToken("");
    setResults(null);
    setApiKeyInput("");
  }

  const finishScan = useCallback(
    (next: Outcome) => {
      setOutcome(next);
      play(next.ok ? 880 : 220);
      setToken("");
      setFocusNonce((nonce) => nonce + 1);
    },
    [play],
  );

  const checkIn = useCallback(
    async (payload: { credentialToken?: string; registrationId?: string }) => {
      if (!credentials) return;

      setScanning(true);

      try {
        const response = await fetch("/api/hardware/check-in", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(credentials),
          },
          body: JSON.stringify(payload),
        });

        const body = await response.json();

        if (!response.ok) {
          finishScan({
            ok: false,
            headline: "Check-in failed",
            detail: body?.error ?? "The server rejected that request.",
          });
          return;
        }

        if (body.success) {
          finishScan({
            ok: true,
            headline: `Welcome, ${body.attendeeName || "guest"}!`,
            detail: "Checked in just now.",
          });
        } else if (body.message === "Already checked in") {
          const at = body.checkedInAt
            ? timeFormat.format(new Date(body.checkedInAt))
            : null;

          finishScan({
            ok: false,
            headline: body.attendeeName || "Already checked in",
            detail: at ? `Already checked in at ${at}` : "Already checked in",
          });
        } else {
          finishScan({
            ok: false,
            headline: body.message ?? "Invalid Token",
            detail:
              body.message === "Invalid credential"
                ? "That badge is not recognised."
                : undefined,
          });
        }

        await refreshEvents(credentials);
      } catch {
        finishScan({
          ok: false,
          headline: "Network error",
          detail: "Could not reach the server.",
        });
      } finally {
        setScanning(false);
      }
    },
    [credentials, finishScan, refreshEvents],
  );

  /** The RFID wedge types the token then presses Enter, which submits this. */
  async function handleScan(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const value = token.trim();
    if (!value) return;

    await checkIn({ credentialToken: value });
  }

  async function handleSearch(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!credentials) return;
    if (query.trim().length < MIN_SEARCH_LENGTH || !selectedEventId) return;

    setSearching(true);

    try {
      const params = new URLSearchParams({
        eventId: selectedEventId,
        q: query.trim(),
      });
      const response = await fetch(`/api/hardware/registrations?${params}`, {
        headers: authHeaders(credentials),
      });
      const body = await response.json();
      setResults(response.ok ? (body.registrations ?? []) : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function handleReset() {
    setToken("");
    setOutcome(null);
    setQuery("");
    setResults(null);
    setFocusNonce((nonce) => nonce + 1);
  }

  // --- Restoring stored credentials -----------------------------------------
  if (restoring) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Starting up…</p>
      </main>
    );
  }

  // --- State 1: provisioning -------------------------------------------------
  if (!credentials) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Connect this terminal</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="deviceIdentifier" className="text-sm font-medium">
                  Device Identifier
                </label>
                <Input
                  id="deviceIdentifier"
                  name="deviceIdentifier"
                  value={identifierInput}
                  onChange={(event) => setIdentifierInput(event.target.value)}
                  placeholder="KIOSK-001"
                  autoComplete="off"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="apiKey" className="text-sm font-medium">
                  API Key
                </label>
                <Input
                  id="apiKey"
                  name="apiKey"
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder="From the organizer dashboard"
                  autoComplete="off"
                  required
                />
                <p className="text-muted-foreground text-xs">
                  Generated under Kiosk Credentials on the dashboard.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="locationName" className="text-sm font-medium">
                  Location <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="locationName"
                  name="locationName"
                  value={locationName}
                  onChange={(event) => setLocationName(event.target.value)}
                  placeholder="Main Entrance"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={connecting}>
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
                {connectError ? (
                  <p className="text-destructive text-sm" role="alert">
                    {connectError}
                  </p>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  // --- State 2: active kiosk -------------------------------------------------
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Check-in</h1>
          <p className="text-muted-foreground text-sm">
            {credentials.deviceIdentifier}
            {locationName ? ` · ${locationName}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset} type="button">
            Reset
          </Button>
          <Button variant="ghost" onClick={handleDisconnect} type="button">
            Disconnect
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <label htmlFor="event" className="text-sm font-medium">
              Event
            </label>
            <select
              id="event"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setResults(null);
              }}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {events.length === 0 ? (
                <option value="">No published events</option>
              ) : null}
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm" aria-live="polite">
            <span className="font-semibold">Checked In: </span>
            {selectedEvent?.checkedIn ?? 0} / {selectedEvent?.totalRegistrations ?? 0}{" "}
            Total Registrations
          </p>
        </CardContent>
      </Card>

      {outcome ? (
        <div
          key={focusNonce}
          role="status"
          className={cn(
            "animate-in fade-in rounded-lg p-6 text-white duration-200",
            outcome.ok ? "bg-green-600" : "bg-red-600",
          )}
        >
          <p className="text-2xl font-semibold">{outcome.headline}</p>
          {outcome.detail ? (
            <p className="mt-1 text-sm opacity-90">{outcome.detail}</p>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleScan} className="space-y-3">
            <label htmlFor="credentialToken" className="text-sm font-medium">
              Scan badge or enter token
            </label>
            <Input
              id="credentialToken"
              name="credentialToken"
              ref={tokenInputRef}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="h-16 text-center font-mono text-xl"
              placeholder="Waiting for scan…"
              autoComplete="off"
              autoFocus
              disabled={scanning}
            />
            <p className="text-muted-foreground text-xs">
              The reader types the token and presses Enter.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <button
              type="button"
              onClick={() => setManualOpen((open) => !open)}
              className="underline-offset-4 hover:underline"
            >
              Search by Email/Name {manualOpen ? "▾" : "▸"}
            </button>
          </CardTitle>
        </CardHeader>

        {manualOpen ? (
          <CardContent className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or email (min 3 characters)"
                aria-label="Search attendees"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={searching || query.trim().length < MIN_SEARCH_LENGTH}
              >
                {searching ? "Searching…" : "Search"}
              </Button>
            </form>

            {results?.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matches.</p>
            ) : null}

            {results && results.length > 0 ? (
              <ul className="divide-border divide-y">
                {results.map((result) => (
                  <li
                    key={result.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {result.name ?? result.email}
                      </p>
                      <p className="text-muted-foreground truncate text-sm">
                        {result.email} · {result.status}
                        {result.checkedInAt
                          ? ` at ${timeFormat.format(new Date(result.checkedInAt))}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={scanning || result.status !== "REGISTERED"}
                      onClick={() => checkIn({ registrationId: result.id })}
                    >
                      Check in
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
