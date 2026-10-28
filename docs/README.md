# Documentation index

Start with [`../PROJECT_STATE.md`](../PROJECT_STATE.md): what the repository contains today, verified.

## Reconstruction pipeline and Spark viewer (this repo's `pipeline/`, `viewer/`)
| Document | Purpose |
|---|---|
| [`HANDOFF_UJESHA.md`](HANDOFF_UJESHA.md) | Step-by-step: setup, dry run, real capture, send outputs |
| [`SOP.md`](SOP.md) | Capture procedure and pass criteria enforced by the pipeline |
| [`TRAINING.md`](TRAINING.md) | Which machine runs which stage; Brush versus Nerfstudio; Linux/WSL2 notes |
| [`TECH_STACK.md`](TECH_STACK.md) | What is in the stack, what is deferred, and why |
| [`STATUS.md`](STATUS.md) | Tested versus untested features and known limitations |
| [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) | Skeleton for the 3-5 minute video |

## Studio app (Ashwin, `apps/studio/`)
Its own documentation lives next to its code: `apps/studio/README.md`, `ARCHITECTURE.md`, `PIPELINE.md`, `VALIDATION.md`, `CAPTURE_SOP.md`, `ROADMAP.md`, `DECISION_LOG.md`, `TECH_STACK_COMPARISON.md`, `CONTEXT.md` (Nilesh's session notes), `WINDOWS_SETUP.md`, and the task spec `apps/studio/docs/V1_SPEC.md` (defines T1-T27).

## Not on this branch
Submission planning drafted on `ujesha/local-viewer-pipeline` (`docs/round1/`: `SUBMISSION.md`, `ABSTRACT.md`, `CAPTURE_DAY.md`, `INTEGRATION.md`) has not been merged here.

## Local-only folders (git-ignored)
`tools/` (downloaded COLMAP, Brush, splat-transform), `work/` (per-run outputs), `.venv/` (Python environment).
