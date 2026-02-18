# BamBot Training Platform Proposal

> Fork of BamBot to train ACT and SMoLv imitation learning models.  
> The "playground" becomes a training and inference workbench.

---

## Current State

| Layer | Status | Notes |
|---|---|---|
| **feetech.js** (servo SDK) | Solid | Full read/write API, Web Serial, 2 independent connections already work |
| **Leader-follower teleop** | Works at 100Hz | Leader arm torque-off, follower mirrors — data collection backbone |
| **Recording** | 50Hz joint-only | Saves `number[][]` frames as JSON — needs major upgrades for ACT |
| **3D visualization** | Works | URDF-based, reads `jointStates` every frame — keep as-is for monitoring |

### Recording Gap

```
Current Recording:   [ [180, 175, 182, 180, 180, 0], ... ]  ← joint angles only, no images

ACT needs:           { observation: { images: {cam_high, cam_low}, qpos },
                       action: qpos[t+1:t+chunk_size] }
                     in HDF5 episodes, with normalization stats
```

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Playground (Browser)                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Leader   │  │ Follower │  │ Camera(s)│  │ 3D Viz       │  │
│  │ Robot    │  │ Robot    │  │ MediaAPI │  │ (monitor)    │  │
│  │ (read)   │  │ (write)  │  │          │  │              │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────┘  │
│       │              │              │                           │
│       └──────┬───────┘              │                           │
│              ▼                      ▼                           │
│  ┌─────────────────────────────────────────────────────┐       │
│  │          Episode Recorder (new)                      │       │
│  │  • Syncs leader read + follower write + camera grab  │       │
│  │  • Timestamps each frame                             │       │
│  │  • Bundles into episodes with metadata               │       │
│  └──────────────────────┬──────────────────────────────┘       │
│                         │                                       │
│                         ▼  POST /api/episodes                   │
├─────────────────────────────────────────────────────────────────┤
│                    Server (Next.js API)                          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Episode Store    │  │ Training API     │                    │
│  │ /api/episodes    │  │ /api/train       │                    │
│  │ • save episode   │  │ • trigger train  │                    │
│  │ • list episodes  │  │ • check status   │                    │
│  │ • export HDF5    │  │                  │                    │
│  └────────┬─────────┘  └────────┬─────────┘                    │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌──────────────────────────────────────────┐                  │
│  │           Python Backend (new)            │                  │
│  │  • ACT / SMoLv training loop              │                  │
│  │  • Dataset loading (HDF5 / LeRobot)       │                  │
│  │  • Model checkpoint management            │                  │
│  │  • Inference server (WebSocket)           │                  │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Episode Data Format

### Per-frame

```typescript
type EpisodeFrame = {
  timestamp_ms: number;
  observation: {
    qpos: number[];        // leader joint angles (degrees), length = num_joints
    images: {
      [camera_name: string]: Blob; // JPEG compressed
    };
  };
  action: number[];          // follower joint angles (what was commanded)
};
```

### Per-episode

```typescript
type Episode = {
  task: string;              // e.g. "pick_cup"
  episode_id: number;
  robot: string;             // "so-arm100"
  fps: number;               // target Hz
  success: boolean;
  frames: EpisodeFrame[];
  joint_names: string[];     // ["Rotation","Pitch","Elbow","Wrist_Pitch","Wrist_Roll","Jaw"]
  created_at: string;
};
```

---

## Phase 1 — Data Collection Pipeline

**Goal:** Record leader-follower demonstrations with camera images, producing ACT-compatible episodes.

| Task | Location | Details |
|---|---|---|
| Add camera capture | `hooks/useCamera.ts` (new) | `navigator.mediaDevices.getUserMedia()` + canvas to grab frames as JPEG blobs at recording Hz |
| Upgrade Episode Recorder | `hooks/useEpisodeRecorder.ts` (new) | On each tick: read leader positions (observation `qpos`), grab camera frame, record follower write (action). Bundle as typed episode frames |
| Episode metadata UI | `components/playground/episodeControl/EpisodeControl.tsx` (new) | Replaces current `RecordControl` — adds task name, episode number, success/fail tagging, notes |
| Episode storage API | `app/api/episodes/route.ts` (new) | POST: receive episode JSON + images (multipart), save to `data/episodes/{task}/{ep_N}/`. GET: list episodes |
| Export to HDF5 | `training/dataset/convert_episodes.py` (new) | Convert stored episodes → HDF5 in LeRobot/ACT format |

---

## Phase 2 — Training Integration

**Goal:** Train ACT/SMoLv from collected episodes, managed from the playground UI.

| Task | Location | Details |
|---|---|---|
| Python training backend | `training/train_act.py` (new) | ACT training script using collected HDF5 data. PyTorch, `detr` backbone, image encoders |
| Training API | `app/api/train/route.ts` (new) | Spawns Python training process, streams logs. Config: model type, chunk size, epochs, LR |
| Training dashboard | `components/playground/trainingPanel/TrainingPanel.tsx` (new) | Loss curve, episode stats, model checkpoints. Lives in the playground |
| Dataset stats | Computed at export time | Normalization stats (mean/std per joint, image normalization) stored alongside HDF5 |

### ACT Training Requirements

- `observation.images.cam_high` — 480×640 RGB images
- `observation.qpos` — current joint positions (normalized)
- `action` — next `chunk_size` joint positions (the action chunk)
- Typical chunk_size: 20–100 steps
- Architecture: ResNet18 image encoder → Transformer → action chunk prediction

### SMoLv Training Requirements

- Same data format, may use a VLM (vision-language model) as backbone
- Text task descriptions as additional conditioning
- Potentially smaller/distilled architecture

---

## Phase 3 — Inference / Policy Deployment

**Goal:** Run a trained ACT/SMoLv policy live on the robot from the playground.

| Task | Location | Details |
|---|---|---|
| Inference server | `training/inference_server.py` (new) | WebSocket server — loads checkpoint, receives camera+qpos, returns action chunks |
| Inference hook | `hooks/useModelInference.ts` (new) | Browser connects to inference WebSocket, sends observations at policy Hz, receives action chunks, executes on robot |
| Policy Control panel | `components/playground/policyControl/PolicyControl.tsx` (new) | Select model checkpoint, start/stop, visualize predicted vs actual trajectories |
| Action chunking executor | Inside `useModelInference.ts` | Receives chunk of N future actions, executes sequentially at control Hz, re-queries with temporal ensembling |

### Inference Loop

```
Every 50ms:
  1. Read current qpos from robot (syncReadPositions)
  2. Grab camera frame
  3. Send {qpos, image} → Python inference server (WebSocket)
  4. Receive action_chunk[0:chunk_size] back
  5. Execute action_chunk[0] → syncWritePositions to robot
  6. (With temporal ensembling: blend overlapping chunks)
```

---

## New File Structure

```
bambot/
├── feetech.js/                    # ← untouched
├── training/                      # ← NEW: Python training code
│   ├── requirements.txt
│   ├── train_act.py               # ACT training script
│   ├── train_smolov.py            # SMoLv training script
│   ├── inference_server.py        # WebSocket inference server
│   ├── dataset/
│   │   ├── convert_episodes.py    # JSON episodes → HDF5
│   │   └── normalize.py           # Compute normalization stats
│   └── models/
│       ├── act.py                 # ACT model definition
│       └── smolov.py              # SMoLv model definition
├── data/                          # ← NEW: Episode storage
│   └── episodes/
│       └── {task_name}/
│           └── ep_{N}/
│               ├── episode.json   # Metadata + joint data
│               └── images/        # Camera frames as JPEGs
├── website/
│   ├── app/
│   │   ├── api/
│   │   │   ├── episodes/          # ← NEW
│   │   │   │   └── route.ts       # CRUD for episodes
│   │   │   ├── train/             # ← NEW
│   │   │   │   └── route.ts       # Trigger/monitor training
│   │   │   └── bambot/v1/         # Existing API
│   │   └── play/[slug]/page.tsx   # Existing playground
│   ├── hooks/
│   │   ├── useRobotControl.ts     # Existing (minor changes)
│   │   ├── useLeaderRobotControl.ts # Existing (minor changes)
│   │   ├── useCamera.ts           # ← NEW: camera capture
│   │   ├── useEpisodeRecorder.ts  # ← NEW: replaces recording
│   │   └── useModelInference.ts   # ← NEW: policy execution
│   └── components/playground/
│       ├── episodeControl/        # ← NEW: replaces recordControl
│       │   └── EpisodeControl.tsx
│       ├── policyControl/         # ← NEW
│       │   └── PolicyControl.tsx
│       └── trainingPanel/         # ← NEW
│           └── TrainingPanel.tsx
```

---

## Technical Decisions

| Decision | Options | Recommendation |
|---|---|---|
| **Camera count** | 1 (top-down) vs 2 (top-down + wrist) | Start with 1 USB webcam, add wrist cam later |
| **Recording Hz** | 10Hz, 25Hz, or 50Hz | 30Hz — good balance of data quality vs image file size |
| **Image resolution** | 240×320, 480×640, or 720×1280 | 480×640 — ACT default, compress as JPEG quality 85 |
| **Where to train** | Local GPU, Colab, or remote server | Local first; API can swap to remote SSH later |
| **LeRobot compatibility** | Custom HDF5 vs LeRobot schema | Target LeRobot HDF5 format for ecosystem compatibility |
| **Action chunk size** | 20, 50, or 100 | 50 — standard ACT default for robot arms |

---

## Implementation Order

| Priority | What | Phase | Why |
|---|---|---|---|
| **1** | `useCamera.ts` + camera preview in playground | P1 | Foundation — need images before anything |
| **2** | `useEpisodeRecorder.ts` + `EpisodeControl.tsx` | P1 | Collect full demonstrations (joints + images) |
| **3** | Episode storage API + HDF5 export script | P1 | Persist and format data for training |
| **4** | ACT training script (`training/train_act.py`) | P2 | Train on collected data |
| **5** | Inference server + `useModelInference.ts` | P3 | Close the loop — run trained policies |
| **6** | Training dashboard UI | P2 | Quality of life |
| **7** | SMoLv training script | P2 | Second model architecture |
