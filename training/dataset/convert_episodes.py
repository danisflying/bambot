"""
Convert BamBot episode recordings (JSON + JPEG images) into HDF5 format
compatible with ACT / LeRobot training pipelines.

Usage:
    python convert_episodes.py --data-dir ../../data/episodes --output-dir ./hdf5
    python convert_episodes.py --data-dir ../../data/episodes --task pick_cup --output-dir ./hdf5

Directory structure expected:
    data/episodes/{task}/ep_{N}/
        episode.json   — metadata (task, fps, joint_names, etc.)
        frames.json    — [{timestamp_ms, observation: {qpos, images: {cam: "images/..."}}, action}]
        images/        — JPEG frames: frame_000000_cam_high.jpg, ...

Output HDF5 structure (per episode):
    /observations/qpos           — (T, num_joints) float32
    /observations/images/cam_high — (T, H, W, 3) uint8
    /action                      — (T, num_joints) float32
    /timestamp_ms                — (T,) float64

Plus a dataset-level stats.json with normalization stats.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

try:
    import h5py
except ImportError:
    print("h5py is required. Install with: pip install h5py")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


def load_episode(episode_dir: Path) -> dict | None:
    """Load a single episode from disk."""
    meta_path = episode_dir / "episode.json"
    frames_path = episode_dir / "frames.json"

    if not meta_path.exists() or not frames_path.exists():
        print(f"  Skipping {episode_dir.name}: missing episode.json or frames.json")
        return None

    with open(meta_path) as f:
        meta = json.load(f)

    with open(frames_path) as f:
        frames = json.load(f)

    return {"meta": meta, "frames": frames, "dir": episode_dir}


def convert_episode_to_hdf5(
    episode: dict, output_path: Path, image_size: tuple[int, int] = (480, 640)
) -> dict:
    """Convert a single episode to HDF5 and return stats for normalization."""
    meta = episode["meta"]
    frames = episode["frames"]
    episode_dir = episode["dir"]
    num_frames = len(frames)

    if num_frames == 0:
        print(f"  Skipping empty episode: {episode_dir.name}")
        return {}

    num_joints = len(frames[0]["observation"]["qpos"])
    camera_names = list(meta.get("camera_names", []))

    # Pre-allocate arrays
    qpos_data = np.zeros((num_frames, num_joints), dtype=np.float32)
    action_data = np.zeros((num_frames, num_joints), dtype=np.float32)
    timestamp_data = np.zeros(num_frames, dtype=np.float64)
    image_data = {}
    for cam in camera_names:
        image_data[cam] = np.zeros(
            (num_frames, image_size[0], image_size[1], 3), dtype=np.uint8
        )

    for i, frame in enumerate(frames):
        qpos_data[i] = frame["observation"]["qpos"]
        action_data[i] = frame["action"]
        timestamp_data[i] = frame["timestamp_ms"]

        # Load images
        for cam in camera_names:
            img_ref = frame["observation"].get("images", {}).get(cam, "")
            if img_ref:
                img_path = episode_dir / img_ref
                if img_path.exists():
                    img = Image.open(img_path).convert("RGB")
                    img = img.resize(
                        (image_size[1], image_size[0]), Image.BILINEAR
                    )
                    image_data[cam][i] = np.array(img)

    # Write HDF5
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(str(output_path), "w") as hf:
        hf.attrs["task"] = meta["task"]
        hf.attrs["episode_id"] = meta["episode_id"]
        hf.attrs["robot"] = meta.get("robot", "so-arm100")
        hf.attrs["fps"] = meta["fps"]
        hf.attrs["success"] = meta["success"]
        hf.attrs["num_frames"] = num_frames
        hf.attrs["joint_names"] = json.dumps(meta.get("joint_names", []))

        obs_grp = hf.create_group("observations")
        obs_grp.create_dataset("qpos", data=qpos_data, compression="gzip")

        img_grp = obs_grp.create_group("images")
        for cam in camera_names:
            img_grp.create_dataset(
                cam, data=image_data[cam], compression="gzip", chunks=(1, image_size[0], image_size[1], 3)
            )

        hf.create_dataset("action", data=action_data, compression="gzip")
        hf.create_dataset("timestamp_ms", data=timestamp_data)

    # Compute stats for this episode
    stats = {
        "qpos_sum": qpos_data.sum(axis=0).tolist(),
        "qpos_sq_sum": (qpos_data**2).sum(axis=0).tolist(),
        "action_sum": action_data.sum(axis=0).tolist(),
        "action_sq_sum": (action_data**2).sum(axis=0).tolist(),
        "count": num_frames,
    }
    return stats


def compute_normalization_stats(all_stats: list[dict]) -> dict:
    """Compute mean and std across all episodes."""
    if not all_stats:
        return {}

    num_joints = len(all_stats[0]["qpos_sum"])
    total_count = sum(s["count"] for s in all_stats)

    qpos_sum = np.zeros(num_joints)
    qpos_sq_sum = np.zeros(num_joints)
    action_sum = np.zeros(num_joints)
    action_sq_sum = np.zeros(num_joints)

    for s in all_stats:
        qpos_sum += np.array(s["qpos_sum"])
        qpos_sq_sum += np.array(s["qpos_sq_sum"])
        action_sum += np.array(s["action_sum"])
        action_sq_sum += np.array(s["action_sq_sum"])

    qpos_mean = qpos_sum / total_count
    qpos_std = np.sqrt(qpos_sq_sum / total_count - qpos_mean**2)
    action_mean = action_sum / total_count
    action_std = np.sqrt(action_sq_sum / total_count - action_mean**2)

    # Prevent division by zero
    qpos_std = np.maximum(qpos_std, 1e-6)
    action_std = np.maximum(action_std, 1e-6)

    return {
        "qpos_mean": qpos_mean.tolist(),
        "qpos_std": qpos_std.tolist(),
        "action_mean": action_mean.tolist(),
        "action_std": action_std.tolist(),
        "total_frames": total_count,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Convert BamBot episodes to HDF5 for ACT/LeRobot training"
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="../../data/episodes",
        help="Path to the episodes directory",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./hdf5",
        help="Output directory for HDF5 files",
    )
    parser.add_argument(
        "--task",
        type=str,
        default=None,
        help="Only convert episodes for this task (default: all tasks)",
    )
    parser.add_argument(
        "--image-height",
        type=int,
        default=480,
        help="Target image height (default: 480)",
    )
    parser.add_argument(
        "--image-width",
        type=int,
        default=640,
        help="Target image width (default: 640)",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    image_size = (args.image_height, args.image_width)

    if not data_dir.exists():
        print(f"Data directory not found: {data_dir}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    all_stats = []
    converted = 0

    # Iterate tasks
    task_dirs = sorted(
        [d for d in data_dir.iterdir() if d.is_dir()]
    )

    if args.task:
        task_dirs = [d for d in task_dirs if d.name == args.task]

    for task_dir in task_dirs:
        task_name = task_dir.name
        print(f"\nTask: {task_name}")

        ep_dirs = sorted(
            [d for d in task_dir.iterdir() if d.is_dir()],
            key=lambda p: p.name,
        )

        for ep_dir in ep_dirs:
            ep = load_episode(ep_dir)
            if ep is None:
                continue

            output_path = output_dir / task_name / f"{ep_dir.name}.hdf5"
            print(f"  Converting {ep_dir.name} ({ep['meta'].get('frame_count', '?')} frames)...")

            stats = convert_episode_to_hdf5(ep, output_path, image_size)
            if stats:
                all_stats.append(stats)
                converted += 1

    # Compute and save normalization stats
    if all_stats:
        norm_stats = compute_normalization_stats(all_stats)
        stats_path = output_dir / "stats.json"
        with open(stats_path, "w") as f:
            json.dump(norm_stats, f, indent=2)
        print(f"\nNormalization stats saved to {stats_path}")

    print(f"\nDone! Converted {converted} episodes to {output_dir}")


if __name__ == "__main__":
    main()
