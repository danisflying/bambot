# BamBot Frontend Refactor — Performance & Architecture Proposal

> Replace Next.js entirely. Migrate the playground to an **Electron + Vite + React** desktop application for native hardware access and real-time performance. Replace the website with a minimal **Astro** static site for docs and assembly guides.

---

## Why Refactor?

### Current Pain Points

| Problem | Root Cause | Impact |
|---|---|---|
| **WebSerial latency** | Browser's Web Serial API adds ~2–5 ms per transaction, user-permission prompts on every connect, single-origin restriction | Leader-follower sync at 50 Hz is near the ceiling; 100 Hz unreliable |
| **Camera frame grabs are slow** | `getUserMedia` → canvas → `toBlob()` JPEG encode runs on the main thread, blocks React rendering | Dropped frames during 50 Hz episode recording; stuttery 3D viewport |
| **No native file I/O** | Episodes saved via `fetch('/api/episodes')` → Next.js API route → `fs.writeFile` | Round-trip through HTTP adds latency + limits throughput for large image data |
| **Main-thread contention** | Three.js render loop, servo polling, camera capture, React reconciliation, and episode recording all share **one thread** | GC pauses cause servo jitter; long frames drop camera grabs |
| **Next.js is the wrong tool** | The `"use client"` directives everywhere mean we pay for SSR hydration for a purely client-side app. The remaining docs site needs zero React. | Slower cold start, wasted bundle analysis, `suppressHydrationWarning` hacks, 200 MB `node_modules` for static content |
| **Massive dependency tree** | 40+ Radix UI primitives, recharts, ai-sdk, etc. — many unused on the playground page | Bloated bundle, slow HMR, long `pnpm install` |
| **No Python process management** | Training triggered via API route that shells out; no lifecycle control | Can't stream training logs, kill/restart cleanly, or manage GPU resources |
| **Browser tab can be killed** | User accidentally closes the tab mid-recording → episode data lost | No OS-level process persistence for critical operations |

### What Electron Solves

| Capability | Browser | Electron |
|---|---|---|
| Serial port access | Web Serial (permission prompt each time, limited API) | `serialport` npm — direct, fast, no prompts |
| File system | Fetch → API route → fs | `fs` / `fs/promises` directly from renderer or main process |
| Worker threads | Web Workers (limited, no `SharedArrayBuffer` by default) | Node.js `worker_threads` — real OS threads, shared memory |
| Camera capture | MediaDevices only | MediaDevices **or** native C++ via `node-opencv` / `ffmpeg` bindings |
| Python subprocess | Not possible | `child_process.spawn` with stdio piping, full lifecycle |
| Window management | Browser tab | Dedicated OS window, system tray, always-on-top mode |
| USB device access | WebUSB (limited) | `usb` / `node-hid` native modules |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Electron Main Process                          │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ Serial Manager   │  │ File Manager     │  │ Python Process Mgr   │  │
│  │ (serialport npm) │  │ (episodes, URDF) │  │ (training, inference)│  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           │ IPC                  │ IPC                    │ IPC          │
├───────────┼──────────────────────┼────────────────────────┼─────────────┤
│           ▼                      ▼                        ▼             │
│                        Renderer Process (Vite + React)                  │
│                                                                         │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ Three.js    │  │ Control  │  │ Episode  │  │ Training         │    │
│  │ Robot Viz   │  │ Panels   │  │ Recorder │  │ Dashboard        │    │
│  │ (Canvas)    │  │ (React)  │  │ (Worker) │  │ (streamed logs)  │    │
│  └─────────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Shared Worker — Real-Time Control Loop             │    │
│  │  • Read leader (via IPC → serialport in main)                  │    │
│  │  • Write follower (via IPC → serialport in main)               │    │
│  │  • Timestamps, frame sync                                      │    │
│  │  • Posts joint states to renderer at vsync                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Main process owns hardware** — Serial ports, file system, and Python subprocesses live in the main process. The renderer communicates via typed IPC channels.
2. **Dedicated Worker for control loop** — The 50–100 Hz leader-follower sync and episode frame capture run in a Worker thread, decoupled from React rendering and GC pauses.
3. **Vite replaces Next.js in the desktop app** — No SSR, no API routes needed. Vite gives <100ms HMR and smaller bundles.
6. **Astro replaces Next.js on the web** — The assembly guide and SDK docs are fully static. Astro ships zero JS by default, supports MDX, and deploys to Vercel identically.
4. **Camera capture offloaded** — Either via `OffscreenCanvas` in a Worker or native capture in the main process, JPEG-encoded in parallel.
5. **Direct file writes** — Episodes saved directly to `data/episodes/` with no HTTP round-trip.

---

## Migration Plan

### Phase 0 — Scaffold & Parallel Run (1 week)

| Task | Details |
|---|---|
| Initialize Electron + Vite project | Use `electron-vite` or `electron-forge` with Vite plugin |
| Copy React components as-is | All `components/`, `hooks/`, `lib/`, `config/` — zero changes initially |
| Stub IPC bridge | Create `preload.ts` exposing type-safe IPC for serial, file, python |
| Add robot selector screen | Replace the Next.js landing page with an in-app `RobotSelector` view — shows robot cards, navigates to the playground for the chosen robot |
| Replace Next.js website with Astro | Scaffold a new `docs/` Astro project. Migrate assembly guide and feetech.js SDK docs as `.mdx` pages. Delete the `website/` directory. |

**Deliverable:** Electron app launches, loads the existing playground UI, but still uses Web Serial internally.

### Phase 1 — Native Serial (1 week)

| Task | Details |
|---|---|
| Replace `feetech.js` Web Serial transport | Write a new `ElectronSerialTransport` that uses `serialport` npm via IPC |
| Keep `ScsServoSDK` API identical | `feetech.js` SDK stays the same — only the transport layer changes |
| Auto-detect serial ports | Main process enumerates ports, renderer picks from a list (no permission prompt) |
| Multi-port support | Open follower + leader ports simultaneously without browser restrictions |

**Measurable:** Servo read latency drops from ~3–5 ms → ~0.5–1 ms. 100 Hz teleoperation becomes stable.

### Phase 2 — Worker-Based Control Loop (1 week)

| Task | Details |
|---|---|
| Extract control loop into Worker | Move the `setInterval` from `useRobotControl.ts` and `useEpisodeRecorder.ts` into a dedicated `controlWorker.ts` |
| Worker ↔ Main IPC for serial | Worker sends batched read/write requests to main process |
| Worker → Renderer postMessage | Worker pushes `jointStates[]` at 60fps for smooth Three.js updates |
| Camera frame capture in Worker | Use `OffscreenCanvas` + `ImageCapture` API (or IPC to main for native capture) |

**Measurable:** Three.js viewport stays at 60fps even during 50Hz recording. Zero dropped frames.

### Phase 3 — Direct File I/O & Episode Improvements (1 week)

| Task | Details |
|---|---|
| Replace `/api/episodes` fetch calls | Use IPC → main process `fs` for saving/loading episodes |
| Stream images to disk as captured | Instead of buffering all frames in memory, write each JPEG to disk in real-time |
| Incremental episode export | Auto-export to LeRobot-compatible format on save |
| Episode management UI | Browse, delete, re-tag episodes with native file dialogs |

**Measurable:** Memory usage during recording drops from ~500 MB (buffered) → ~50 MB (streamed). Max episode length is now limited only by disk space.

### Phase 4 — Python Integration (1 week)

| Task | Details |
|---|---|
| Python process manager in main | Spawn `training/train_act.py` as child process, pipe stdout/stderr |
| Training dashboard in renderer | Real-time loss curves via streamed JSON lines from Python |
| Inference WebSocket server | Launch `training/inference_server.py`, connect from control worker |
| Model checkpoint browser | List `.pt` files from `training/checkpoints/`, load for inference |

**Measurable:** Train → evaluate → deploy loop runs entirely from the desktop app.

### Phase 5 — Polish & Distribution (1 week)

| Task | Details |
|---|---|
| Auto-updater | `electron-updater` for seamless updates |
| Installer builds | Windows (NSIS), macOS (DMG), Linux (AppImage) |
| System tray | Minimize to tray, show recording status |
| Crash reporting | `electron-log` + optional telemetry |
| Astro docs site live on Vercel | Includes download link to GitHub releases, assembly guide, SDK docs |

---

## Next.js is Removed Entirely

**Next.js is deleted.** The `website/` directory is replaced by a new `docs/` Astro project.

### Why Astro for the docs site

- Ships **zero JS** to the browser by default — the assembly guide and SDK reference are pure static HTML
- **MDX support** — step-by-step assembly instructions with embedded images are trivial to write
- Same **Tailwind** setup reused for visual consistency
- Deploys to Vercel identically, same custom domain
- `node_modules` shrinks from ~200 MB (Next.js) → ~30 MB (Astro)

### What the Astro site contains

| Route | Content |
|---|---|
| `/` | Download hero — links to GitHub releases for the desktop app |
| `/assemble/so-101` | Assembly guide (MDX, step photos) |
| `/feetech.js` | SDK API reference (MDX) |

All robot interaction — including robot selection — happens inside the Electron app.

## Robot Selection in the Desktop App

The Electron app opens to a **Robot Selector** screen (replaces the Next.js landing page). It reads `robotConfigMap` directly and renders the same robot cards.

```
App launch
  └─► RobotSelector screen
        ├── SO-ARM100 card  → clicks → opens Playground("so-arm100")
        ├── [future robot]  → clicks → opens Playground("...")
        └── Settings button → serial port prefs, theme, data directory
```

Navigation is handled by a lightweight in-process router (`wouter` or a simple `useState` enum) — no Next.js router, no URL bar needed.

---

## New Project Structure

```
bambot/
├── desktop/                          ← NEW: Electron app
│   ├── package.json
│   ├── electron.vite.config.ts
│   ├── src/
│   │   ├── main/                     # Electron main process
│   │   │   ├── index.ts              # App entry, window creation
│   │   │   ├── ipc/                  # IPC handlers
│   │   │   │   ├── serial.ts         # serialport wrapper
│   │   │   │   ├── filesystem.ts     # Episode read/write
│   │   │   │   └── python.ts         # Child process management
│   │   │   └── menu.ts               # Application menu
│   │   ├── preload/
│   │   │   └── index.ts              # contextBridge API
│   │   ├── renderer/                 # React app (Vite)
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx               # Router: RobotSelector ↔ Playground
│   │   │   ├── screens/
│   │   │   │   ├── RobotSelector.tsx # ← Replaces Next.js landing page
│   │   │   │   └── Playground.tsx    # ← Wraps existing RobotLoader
│   │   │   ├── components/           # ← Moved from website/components/playground/
│   │   │   ├── hooks/                # ← Moved from website/hooks/
│   │   │   ├── lib/                  # ← Moved from website/lib/
│   │   │   ├── config/               # ← Moved from website/config/
│   │   │   ├── workers/
│   │   │   │   ├── controlLoop.ts    # Real-time servo + camera worker
│   │   │   │   └── imageEncoder.ts   # JPEG encoding worker
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   └── shared/                   # Types shared between main & renderer
│   │       ├── ipc-channels.ts
│   │       └── types.ts
│   ├── resources/                    # URDFs, icons, etc.
│   └── build/                        # electron-builder config
├── docs/                             ← NEW: Astro static site (replaces website/)
│   ├── package.json
│   ├── astro.config.mjs
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.astro           # Download hero → GitHub releases
│   │   │   ├── assemble/
│   │   │   │   └── so-101.mdx        # Assembly guide
│   │   │   └── feetech-js.mdx        # SDK docs
│   │   ├── layouts/
│   │   │   └── Base.astro
│   │   └── components/
│   │       └── DownloadButton.astro
│   └── public/                       # Static assets (images, URDFs)
├── website/                          ← DELETED
├── feetech.js/                       ← Untouched (used by both)
├── training/                         ← Untouched (managed by desktop app)
└── data/                             ← Untouched (shared episode storage)
```

---

## Dependency Changes

### Removed entirely (from the codebase)

| Package | Reason |
|---|---|
| `next` | Deleted with `website/`. Desktop uses Vite; docs site uses Astro |
| `@vercel/analytics` | Desktop app has no Vercel. Astro site uses Vercel's native analytics if needed |
| `@ai-sdk/openai`, `ai` | Move to Electron main process — direct `fetch` to OpenAI from Node.js |
| Most Radix UI primitives | Keep only the ~8 actually used in playground panels |
| `recharts` | Replace with `uplot` (~10 KB vs ~200 KB) for training loss curves |

### Added — Electron desktop (`desktop/`)

| Package | Purpose |
|---|---|
| `electron` | Desktop shell |
| `electron-vite` | Build tooling |
| `serialport` | Native serial port access |
| `electron-store` | Persistent settings (replaces localStorage) |
| `electron-updater` | Auto-updates |
| `electron-log` | Structured logging |

### Added — Astro docs site (`docs/`)

| Package | Purpose |
|---|---|
| `astro` | Static site framework |
| `@astrojs/mdx` | MDX support for assembly guides |
| `@astrojs/tailwind` | Shared Tailwind config |

### Kept (moved to desktop/renderer)

| Package | Notes |
|---|---|
| `three`, `@react-three/fiber`, `@react-three/drei` | Core 3D visualization — unchanged |
| `urdf-loader` | URDF parsing — unchanged |
| `react`, `react-dom` | UI framework |
| `tailwindcss`, `tailwind-merge`, `clsx` | Styling |
| `react-resizable-panels` | Panel layout |
| `feetech.js` | Servo SDK (transport layer swapped) |

---

## Performance Targets

| Metric | Current (Browser) | Target (Electron) |
|---|---|---|
| Servo round-trip latency | 3–5 ms | < 1 ms |
| Control loop jitter (stddev) | ±8 ms | ±1 ms |
| Max stable teleop Hz | 50 Hz | 200 Hz |
| Camera frame grab | 15–25 ms (main thread) | 5–8 ms (worker) |
| Episode recording Hz | 50 Hz (drops frames) | 100 Hz (stable) |
| Three.js FPS during recording | 30–45 fps | 60 fps locked |
| Cold start time | 3–5 s (SSR + hydration) | < 1.5 s |
| Memory during 60s recording | ~500 MB (buffered) | ~50 MB (streamed) |
| Max episode length | ~60 s (memory limit) | Unlimited (disk) |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Electron app size (~150 MB)** | Acceptable for a desktop robotics tool. Use `electron-builder` ASAR packing. Chromium is already installed on dev machines. |
| **Cross-platform serial quirks** | `serialport` has mature Windows/macOS/Linux support. Test on all three early. |
| **IPC overhead for serial** | Batch serial operations. `syncReadPositions` already reads all servos in one command — one IPC round-trip per batch, not per servo. |
| **Migration effort** | Phases are designed so each one is independently shippable and testable. Web Serial fallback can remain for initial testing. |
| **Two repos to maintain** | The Astro docs site is intentionally minimal — mostly MDX files with no logic. Shared Tailwind config via a symlinked `tailwind.config.ts`. |
| **User adoption friction** | Provide one-click installers. Auto-updater keeps it current. Browser fallback for quick demos. |

---

## Alternative Considered: Stay in the Browser

Instead of Electron, we could:
1. Move serial + camera to a local **companion server** (Rust/Python) and communicate via WebSocket
2. Use Web Workers more aggressively for the control loop
3. Use `SharedArrayBuffer` + `Atomics` for zero-copy servo data sharing

**Why Electron wins:** The companion server approach adds deployment complexity (two processes to install, firewall issues, WebSocket latency). Electron gives us everything in one package with a single install. The entire training-platform-proposal.md Phase 2–3 (Python training/inference) also benefits enormously from having native process management.

---

## Decision Needed

Before starting implementation:

1. **Next.js removed entirely** — Confirmed. Desktop app uses Electron + Vite; docs site uses Astro.
2. **Serial library** — `serialport` (most popular, C++ binding) vs `usb` + raw serial (lighter, no native compile)?  
3. **Build tooling** — `electron-vite` (most community support) vs `electron-forge` (Electron official)?  
4. **Python venv management** — Bundle Python with the app, or require the user to have it installed?

---

## Summary

| | Current | Proposed |
|---|---|---|
| **App runtime** | Browser (Next.js) | Electron + Vite |
| **Docs site** | Next.js (website/) | Astro (docs/) |
| **Entry point** | `/` landing page (browser) | In-app Robot Selector screen |
| **Serial access** | Web Serial API | `serialport` (native) |
| **Control loop** | Main thread `setInterval` | Dedicated Worker thread |
| **Camera capture** | Main thread canvas | Worker + OffscreenCanvas |
| **File I/O** | HTTP API route | Direct `fs` via IPC |
| **Python integration** | Manual CLI | Managed child processes |
| **Distribution** | URL | Installer + auto-updater |
| **Timeline** | — | ~5 weeks (5 phases) |

The core React components, Three.js visualization, and feetech.js SDK all transfer with minimal changes. The refactor is about **where code runs** (main thread → workers, browser APIs → native APIs), not rewriting application logic.
