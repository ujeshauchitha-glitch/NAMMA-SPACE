#!/usr/bin/env python3
"""Generate high-resolution presentation renders for both Nerfstudio and Real Room scenes."""

import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPTS_DIR.parents[2]
CLI = ROOT_DIR / "tools" / "splat-transform" / "node_modules" / "@playcanvas" / "splat-transform" / "bin" / "cli.mjs"

def render(ply_path: Path, out_path: Path, cam_pos: str, cam_target: str, res: str = "1280x720"):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "node", str(CLI), "-w", str(ply_path),
        "--camera-pos", cam_pos,
        "--camera-target", cam_target,
        "--resolution", res,
        str(out_path)
    ]
    res_run = subprocess.run(cmd, capture_output=True, text=True)
    if out_path.is_file():
        print(f"Generated {out_path.name} ({out_path.stat().st_size} bytes)")
    else:
        print(f"Failed {out_path.name}: {res_run.stderr}")

def main():
    # 1. Nerfstudio Poster Renders
    nerf_ply = ROOT_DIR / "apps" / "studio" / "public" / "scenes" / "nerfstudio-poster" / "visual" / "poster.ply"
    nerf_renders = ROOT_DIR / "apps" / "studio" / "public" / "scenes" / "nerfstudio-poster" / "renders"

    print("Generating Nerfstudio Poster renders...")
    render(nerf_ply, nerf_renders / "poster_overview.webp", "0,1.2,2.8", "0,0.65,0")
    render(nerf_ply, nerf_renders / "poster_detail.webp", "0,0.75,1.1", "0,0.65,0")
    render(nerf_ply, nerf_renders / "poster_orbit.webp", "2.5,2.4,2.5", "0,0.65,0")
    render(nerf_ply, nerf_renders / "poster_walkthrough.webp", "0,1.55,1.8", "0,0.7,-0.4")

    # 2. Real Room Workshop Renders
    room_ply = ROOT_DIR / "apps" / "studio" / "public" / "scenes" / "real-room" / "visual" / "room_sparse.ply"
    room_renders = ROOT_DIR / "apps" / "studio" / "public" / "scenes" / "real-room" / "renders"

    print("Generating Real Room Workshop renders...")
    render(room_ply, room_renders / "room_overview.webp", "0,1.6,2.2", "0,1.1,-1.0")
    render(room_ply, room_renders / "room_sink_detail.webp", "-1.2,1.3,0.2", "-1.8,1.1,-1.0")
    render(room_ply, room_renders / "room_luggage_detail.webp", "0.6,0.8,0.8", "1.2,0.4,1.5")
    render(room_ply, room_renders / "room_walkthrough.webp", "0,1.65,2.6", "0,1.2,-1.0")

    print("All renders generated successfully!")

if __name__ == "__main__":
    main()
