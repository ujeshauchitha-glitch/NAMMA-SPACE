# BLOCKERS — Round 1 Rescue Sprint

(format: ID · description · impact · evidence · attempted · alternatives · next step)

## B-001 — No COLMAP/CUDA on this machine
- Impact: real reconstruction cannot run locally (sparse needs colmap binary; dense patch_match_stereo has no CPU fallback → needs CUDA).
- Evidence: `which colmap` → missing; `preflight:reconstruction` JSON: colmap available:false, nvidia-smi available:false (audit 2026-10-29).
- Status: OPEN — human-owned if real capture arrives; see Workstream B.
