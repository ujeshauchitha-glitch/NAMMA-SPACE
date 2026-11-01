# Release Manifest — Namma Space Final Release

**Release Date**: October 31, 2026  
**Competition Deadline**: October 31, 2026  
**Git Branch**: `finalashwinintegration`  
**Release Commit**: `a39b7a2` (verified fast-forward push to `origin/finalashwinintegration`)  
**Verdict**: **READY TO SUBMIT**

---

## 1. Primary Public Links & Deliverables

| Deliverable | Location / Artifact | Public URL / Reference | Verification Details |
| :--- | :--- | :--- | :--- |
| **1. Technical Abstract** | `submission/TECHNICAL_ABSTRACT.pdf` | Included in master Google Drive folder | 5 pages max (`mdls` verified = 5), 186 KB, SHA-256: `8a2f67239b7fbbb9cf6fb2c210317cf6af2b713f221ec077e25c16043231a98b` |
| **2. Proof of Concept & Viewer** | `submission/PROOF_OF_CONCEPT.md` | [https://namma-space-studio.vercel.app](https://namma-space-studio.vercel.app) | Tested anonymously via Playwright browser; 5 scene bundles loaded without console errors |
| **3. Demonstration Video** | `docs/submission/Namma_Space_Demo.mp4` | Uploaded to master Google Drive folder | Duration: 254.2s (4m 14s), 1080p H.264/AAC, 8.1 MB, SHA-256: `a8a1cd82580de9c0ddd6cbede2f387cd0207902c9f92db4098884fab2ecdfd5d` |
| **4. Code Repository** | Entire workspace | [https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git](https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git) | Clean-clone setup verified, tests pass, sample data non-empty in `tests/sample_data/` |

---

## 2. Automated Quality & Release Gates
- **TypeScript Typecheck**: PASSED (0 errors).
- **ESLint**: PASSED (0 errors).
- **Vitest Unit & Integration**: PASSED (36 test files, 679/679 tests passing).
- **Python Ingestion & Preflight Suite**: PASSED (78/78 tests passing).
- **Scene Bundle Validation**: PASSED (5/5 scene bundles validated).
- **Bundle Size Budget**: PASSED (Entry gzip 147.27 KB ≤ 368.64 KB budget).
- **Predeploy Verification**: PASSED (All 5 scene bundles and assets verified).
- **Playwright End-to-End Suite**: PASSED (37/37 browser tests passing).

---

## 3. Sample Data Inventory
Located in `tests/sample_data/`:
- `images/`: 8 synthetic JPG captures (`sample_synthetic_01.jpg` – `08.jpg`).
- `synthetic_capture_bundle.zip`: Signed capture archive with `manifest.json`.
- `synthetic_clip.mp4`: Representative short video for automated frame extraction testing.
- `PROVENANCE.md`: Exact cryptographic SHA-256 digests and provenance records.
- `EXPECTED.md`: Step-by-step reproduction commands and expected outputs.

---

## 4. Master Google Drive Submission Checklist

Organize the four deliverables into a single Drive folder named:
**`NAMMA_SPACE_FINAL_SUBMISSION`**

Set folder permissions to:
**`Anyone with the link — Viewer`**

Contents to place inside the folder:
1. `Technical_Abstract.pdf` (from `submission/TECHNICAL_ABSTRACT.pdf`)
2. `Proof_of_Concept.pdf` or link to `https://namma-space-studio.vercel.app`
3. `Namma_Space_Demo.mp4` (from `docs/submission/Namma_Space_Demo.mp4`)
4. `Repository_Link.txt` pointing to `https://github.com/ujeshauchitha-glitch/NAMMA-SPACE` (branch `finalashwinintegration`)

