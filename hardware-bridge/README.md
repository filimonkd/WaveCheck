# WaveCheck Hardware Bridge

Reads RFID credentials from a serial reader and checks attendees in through
the WaveCheck API. Runs on whatever is sitting at the door — a Raspberry Pi, a
mini PC, a laptop.

It is a standalone Node project: its own `package.json`, its own `tsconfig`,
no dependency on the Next.js app beyond the HTTP API.

## Which reader do I need?

This matters more than anything else on this page, because the two common
reader families need **different** parts of WaveCheck.

| Reader type | How it behaves | Use |
| --- | --- | --- |
| **USB serial / UART** (CDC-ACM, FTDI, CH340) | Appears as `/dev/ttyUSB0`, `/dev/ttyACM0` or `COM3` and writes the UID followed by a newline | **This bridge** |
| **USB HID "keyboard wedge"** | Pretends to be a keyboard and *types* the UID, then presses Enter | The `/kiosk` page in a browser — no bridge needed |
| **MFRC522 breakout** | Speaks SPI, not serial, on most boards | See below |

If your reader shows up as a serial device, this bridge is what you want. If
it types into whatever window has focus, open `/kiosk` instead and let it type
there — that path already works and needs no software on the machine.

### USB serial reader (simplest)

Plug it in. Nothing to wire. Find the port:

```bash
# Linux
ls /dev/serial/by-id/          # stable names, prefer these
dmesg | tail                   # shows ttyUSB0 / ttyACM0 on plug-in
# macOS
ls /dev/tty.usb*
# Windows: Device Manager → Ports (COM & LPT)
```

Prefer the `/dev/serial/by-id/...` path over `/dev/ttyUSB0`: the numbered name
can move when another USB device is plugged in first.

On Linux your user needs permission to open the port:

```bash
sudo usermod -aG dialout "$USER"   # log out and back in
```

### MFRC522 on a Raspberry Pi

An MFRC522 breakout is **SPI**, so it cannot talk to this bridge directly.
Two ways round it:

1. **UART mode.** Some MFRC522 boards can be switched to UART by moving a
   jumper or bridging `EA` to ground — check your board's datasheet, as it
   varies. Then wire it to the Pi's UART:

   | MFRC522 | Raspberry Pi |
   | --- | --- |
   | `3.3V` | pin 1 (3.3V) — **not 5V** |
   | `GND` | pin 6 |
   | `TX` | pin 10 (GPIO 15, RXD) |
   | `RX` | pin 8 (GPIO 14, TXD) |

   TX goes to RX and RX to TX. Then free the UART: `sudo raspi-config` →
   Interface Options → Serial Port → login shell **no**, hardware serial
   **yes**, and set `SERIAL_PORT=/dev/serial0`.

2. **Front it with a microcontroller.** Wire the MFRC522 to an Arduino or
   ESP32 over SPI, and have that sketch `Serial.println(uid)` for each card.
   The board then appears as a USB serial device and this bridge reads it with
   no changes. This is the more reliable route and the one to pick if the
   jumper on your board is ambiguous.

Whatever the reader, the contract is the same: **write the credential token as
text, then a newline.** `\n` and `\r\n` are both fine.

## Getting a device API key

Every `/api/hardware` route requires device credentials, so the bridge needs a
key before it can do anything:

1. Sign in to WaveCheck as an ORGANIZER or ADMIN.
2. Open **/dashboard** → **Kiosk Credentials**.
3. Enter an identifier (or leave it blank for a generated one) and a location,
   then press **Generate Kiosk Credentials**.
4. Copy the key. **It is shown once and never again** — only its hash is
   stored. If you lose it, issue a new device.

## Install and run

```bash
cd hardware-bridge
npm install
cp .env.example .env     # then fill it in
npm start                # compiles, then runs
```

`npm start` runs `tsc` and then `node dist/index.js`. `.env` is read from the
working directory, so run it from `hardware-bridge/`.

| Variable | Meaning |
| --- | --- |
| `API_BASE_URL` | Where WaveCheck is, e.g. `http://localhost:3000` |
| `DEVICE_IDENTIFIER` | From the dashboard |
| `DEVICE_API_KEY` | From the dashboard, shown once |
| `SERIAL_PORT` | `/dev/ttyUSB0`, `/dev/serial0`, `COM3`… |
| `SERIAL_BAUD_RATE` | Match the reader; 9600 is the usual default |

On start it sends one heartbeat to confirm the credentials, so a wrong key
fails immediately with a clear message rather than silently at the first scan.

## What you see

```
13:05:03 ✔ Credentials accepted
13:05:03 ✔ Listening on /dev/ttyUSB0 @ 9600 baud
13:05:20 ↳ scanned demo-credential-0001
13:05:21 ✅ CHECKED IN: Demo Attendee
13:05:28 ❌ ALREADY CHECKED IN at 13:05 (Demo Attendee)
13:05:30 ❌ INVALID CREDENTIAL
```

A successful check-in also sends a terminal bell. Colour and the bell are
suppressed when output is not a terminal, so logs stay readable.

## How it behaves when things go wrong

- **API unreachable** — retries three times with backoff, reports
  `API OFFLINE`, and keeps listening. A network blip never kills the bridge.
- **Reader unplugged** — reports the disconnect and retries the port every 5
  seconds until it comes back.
- **Bad credentials** — exits immediately at startup with what to fix.
- **Line noise** — non-printable characters are stripped, fragments shorter
  than 4 characters are ignored, and a reader that never sends a newline
  cannot grow the buffer past 512 characters.
- **Card held on the reader** — many readers repeat the UID several times a
  second. A repeat of the same token within 3 seconds is ignored, so one tap
  is one check-in.

## Running it as a service

On a Pi you want it to come back after a power cut. `/etc/systemd/system/wavecheck-bridge.service`:

```ini
[Unit]
Description=WaveCheck hardware bridge
After=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/WaveCheck/hardware-bridge
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
cd /home/pi/WaveCheck/hardware-bridge && npm install && npm run build
sudo systemctl enable --now wavecheck-bridge
journalctl -u wavecheck-bridge -f
```

Run `npm run build` yourself rather than letting the service compile on boot.

## Testing without a reader

`socat` gives you a pair of linked virtual serial ports, so you can exercise
the whole path with no hardware:

```bash
socat -d -d pty,raw,echo=0,link=/tmp/ttyBRIDGE pty,raw,echo=0,link=/tmp/ttyREADER
```

Point `SERIAL_PORT=/tmp/ttyBRIDGE`, start the bridge, then act as the reader:

```bash
printf 'demo-credential-0001\r\n' > /tmp/ttyREADER
```

Splitting a token across several writes is a good test too — that is exactly
what a real reader does, and the bridge reassembles it.

## Layout

| File | Purpose |
| --- | --- |
| `src/index.ts` | Config, API calls, serial wiring, console output |
| `src/line-assembler.ts` | Turns serial chunks into clean tokens; pure, so it is testable without hardware |
