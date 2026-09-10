# THE HUM

*It hears you.*

A first-person survival horror game for the browser. Built with Three.js, procedural
audio (zero asset files), and one unusual idea: **the entity — the Hum — hunts through
your real microphone**. Noise in your actual room — your keyboard, your chair, your
breathing — is heard by the thing in the dark.

## Run it

```bash
python3 serve.py 8130
# open http://localhost:8130
```

Headphones strongly recommended. Chrome/Brave/Edge (WebGL2 + microphone required).

## How to survive

| Key | Action |
| --- | --- |
| `WASD` | move |
| `Mouse` | look |
| `Shift` | sprint (drains stamina — a tired technician breathes loudly) |
| `Ctrl` / `C` | crouch (quieter, smaller) |
| `F` | flashlight (helps you see — helps *it* see you) |
| `E` | hide in lockers / interact |
| `Q` | throw a bottle (noise decoy) |
| `Space` | hold breath (silences in-game breathing, drains stamina) |
| `Esc` | pause |

### The rules of VOX-9

- Recover **4 resonance cores**, then release containment at the elevator.
- The entity hunts by **sound**: your footsteps, sprinting, thrown bottles, and —
  if you allow microphone access — **real noise in your room**.
- If it finds you: break line of sight and hide. Do not outrun it. You cannot.
- When it stands beside you in the elevator, **stay silent for 8 seconds.**
  In the real world too.
- It learns. Hide in the same locker twice and it will check that locker first.
- Die, and your previous run's route is replayed by your past self — and then
  it becomes solid.

The game uses your local time, death count, and room audio in what it says to you.
Progress (deaths, routes, learned hiding places) persists between sessions.

**Privacy:** everything runs client-side. Microphone audio is analysed locally with the
Web Audio API and is never recorded, stored, or uploaded anywhere. The game is a static
site with no backend.

## Deploy it

It's a static site (no build step). Any HTTPS static host works — microphones require
HTTPS in browsers, which all of these provide:

- **GitHub Pages:** push this folder to a repo, Settings → Pages → deploy from `main` / root.
- **Netlify Drop:** drag this folder onto https://app.netlify.com/drop.
- **Cloudflare Pages / Vercel:** connect the repo, no build command, output directory `/`.

`serve.py` is only for local development (it adds no-cache headers and a debug capture
endpoint); static hosts ignore it.

## Debug autopilot (for testing)

Append query params: `?auto=run|view|flash|hunt|hold|death|escape|ghost`.
Shows a state overlay and enables a framebuffer capture endpoint (`/__shot`).
