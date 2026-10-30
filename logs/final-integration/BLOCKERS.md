# Disclosed Blockers and Limitations

## BLK-001: External GPU Photogrammetry Worker Requirement
- **Status**: DISCLOSED & PREFLIGHT-CHECKED
- **Detail**: Dense 3D Gaussian Splatting (Brush 3DGS) and Structure-from-Motion (COLMAP feature extraction/matching) require an NVIDIA GPU with CUDA or high-memory local metal acceleration. Vercel Serverless Functions have a 250 MB size limit, strict execution timeouts (15–60s), and no GPU access.
- **Handling**:
  - The client application prepares, validates, organizes, and packages raw captures into a deterministic observation bundle (`capture-bundle.zip`).
  - `scripts/reconstruct_colmap.py preflight` inspects local CLI tools (`colmap`, `ffmpeg`, `nvidia-smi`) and provides clear diagnostic statuses.
  - The application provides verified pre-computed demonstration scenes (`The Amber Hall` procedural, `The Amber Hall` GLB mesh, and `Synthetic Splat fixture` SOG) so every feature of the spatial viewer, navigation, and POI index is 100% testable out of the box.

## BLK-002: Live Scan WebRTC Mobile Relay Dev-Server Boundary
- **Status**: DOCUMENTED & LABELED IN UI
- **Detail**: The local WebSocket signaling relay used for phone-to-desktop WebRTC camera pairing (`npm run dev:lan`) runs as part of the Vite development server. On static hosting like Vercel, persistent arbitrary WebSocket relays are not natively supported without a separate serverful relay host (e.g. Railway or Render).
- **Handling**:
  - The Live Scan tab clearly displays "Live Scan · dev only" on hosted builds (`import.meta.env.DEV ? 'Live Scan' : 'Live Scan · dev only'`).
  - Offline mode and manual capture uploads in Capture Studio remain 100% operational on production deployments.
