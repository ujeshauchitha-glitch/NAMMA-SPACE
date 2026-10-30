#!/usr/bin/env node
/**
 * Round 1 demo video builder (3-5 minutes).
 *
 * The video is a real record of the deployed app plus honest slides, never a
 * mock-up: every browser segment is a headed Chromium session against the live
 * public URLs (real WebGL, real pointer lock, real downloads), and every number
 * on the evidence slide is quoted from a run recorded in this repository.
 *
 * Pipeline per section:  narration (macOS `say`) -> duration -> visuals
 * (rendered slide PNG, or a Playwright screen recording padded to the narration
 * length) -> one H.264/AAC segment -> concat into the final MP4.
 *
 * Usage:  node scripts/build_demo_video.mjs [--only 04-viewer]
 * Requires: macOS `say`, `afinfo`, `ffmpeg`, and Playwright's Chromium.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'work', 'demo-video');
const APP = 'https://namma-space-studio.vercel.app';
const SPLAT = 'https://namma-space-pearl.vercel.app';
const SAMPLE_IMAGES = path.join(ROOT, 'tests', 'sample_data', 'images');
const VOICE = process.env.DEMO_VOICE || 'Samantha';
const W = 1280;
const H = 720;
const FINAL = path.join(ROOT, 'docs', 'submission', 'Namma_Space_Demo.mp4');

for (const dir of ['audio', 'clips', 'slides', 'record']) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
}

const sh = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });

/**
 * Sections are ordered as they appear. `kind: 'slide'` renders `html()`;
 * `kind: 'browser'` runs `act(page)` in a headed Chromium context that records
 * the viewport. `caption` is burned in as a lower-third.
 */
const SECTIONS = [
  {
    id: '01-title',
    kind: 'slide',
    caption: 'Round 1 · Techfest 2026-27',
    narration:
      'Namma Space. We turn a walk through an indoor space into a photorealistic three-D twin that anyone can explore in a web browser. This is our Round 1 submission for Techfest twenty twenty-six, twenty-seven, from team T M one two three five four C three F six F two at Vellore Institute of Technology.',
    html: () => titleSlide({
      eyebrow: 'TECHFEST 2026-27 · ROUND 1',
      title: 'Namma Space',
      lede: 'Phone video in. A walkable digital twin out.',
      footer: 'Nilesh Kumar Srivastava · Ojas Ashish Kulkarni · Ujesha Sivaramakrishnan · Ashwin Dandotiya',
    }),
  },
  {
    id: '02-problem',
    kind: 'slide',
    caption: 'Why floor plans are not enough',
    narration:
      'A floor plan tells you where a room is. It does not tell you what it looks like, where the entrance you want actually is, or whether the stall you are looking for is behind a pillar. Photo tours show a place, but you cannot move through them. What a visitor really wants is to walk the space before arriving, on the phone already in their hand.',
    html: () => bulletSlide({
      eyebrow: '01 · PROBLEM',
      title: 'You cannot walk a floor plan',
      bullets: [
        ['Blueprints', 'Where rooms are, not what they look like.'],
        ['Photo tours', 'A fixed path, no free movement, no depth.'],
        ['360 photos', 'Stitch seams, no geometry, no scale.'],
        ['What people want', 'Walk the space before arriving, in a browser, with nothing to install.'],
      ],
    }),
  },
  {
    id: '03-system',
    kind: 'slide',
    caption: 'One heavy pipeline, one static viewer',
    narration:
      'The system has two halves, and only one of them is heavy. Offline, a single GPU workstation extracts sharp frames from phone video, recovers camera poses with COLMAP, trains a Gaussian splat with Brush, and compresses it to a web-sized SOG file. Every stage checks its own output and writes the result into one report, and a person walks the finished model before it is published. Online, the model and the viewer are plain static files on a CDN. No server code runs, so viewing is instant, cheap and identical on any device with WebGL two.',
    html: () => diagramSlide({
      eyebrow: '02 · ARCHITECTURE',
      title: 'Offline reconstruction, static delivery',
      left: {
        heading: 'One GPU workstation',
        steps: ['Phone video, filmed to the SOP', 'Frames + blur filter (ffmpeg, OpenCV)', 'Camera poses (COLMAP SfM)', 'Gaussian splat training (Brush, 30k steps)', 'Compression to SOG under 50 MB', 'Human sign-off in report.json'],
      },
      right: {
        heading: 'No server, nothing to install',
        steps: ['Splat on a public Hugging Face dataset', 'Viewer: React, three.js, Spark on Vercel', 'Any WebGL2 browser, desktop or phone', 'Publishing a new capture is a file upload'],
      },
    }),
  },
  {
    id: '04-viewer',
    kind: 'browser',
    caption: 'Live viewer · namma-space-studio.vercel.app',
    narration:
      'This is the studio viewer, deployed and public at namma-space-studio dot vercel dot app. Click once to take the mouse and you are inside the room. W A S D walks, and the movement is checked against a walkable grid, so blocked cells are refused rather than walked through. Now type a destination: the app ranks points of interest and scores the match. Pick one and it plans a shortest path with A star across the grid, and draws that route on the floor as a strip of verified cells.',
    act: async (page, hold) => {
      await page.goto(`${APP}/?workspace=viewer`, { waitUntil: 'load' });
      await page.getByText('Ready to explore', { exact: true }).waitFor({ timeout: 30_000 });
      await hold(1200);
      await page.locator('canvas').hover();
      await page.getByRole('button', { name: 'Enter walkthrough' }).click();
      await hold(700);
      // Walk forward with real pointer lock, then look around.
      await page.keyboard.down('w');
      await hold(1500);
      await page.keyboard.up('w');
      await page.mouse.move(640, 360);
      for (let i = 0; i < 24; i += 1) {
        await page.mouse.move(640 + i * 6, 360 - Math.round(i * 1.2));
        await page.waitForTimeout(30);
      }
      await hold(600);
      await page.keyboard.press('Escape');
      await hold(400);
      // Search, select, route.
      await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('registration');
      await hold(900);
      await page.getByRole('option', { name: /Registration Desk/ }).click();
      await hold(1100);
      await page.getByRole('button', { name: /Plot route/ }).click();
      await hold(2200);
      await page.getByRole('button', { name: 'Jump to view' }).click();
      await hold(1600);
    },
  },
  {
    id: '05-capture',
    kind: 'browser',
    caption: 'Capture Studio · staged locally, verified before upload',
    narration:
      'The other half of the product is how the capture leaves the phone. Capture Studio ingests the photos in the browser itself: it sniffs the real format from the bytes, decodes, resizes, hashes with SHA two fifty-six, and stores the result in IndexedDB. Images are grouped by room and view, so the reconstruction step knows which walls were photographed. Export produces a ZIP with a manifest and the integrity hashes, which is exactly the bundle the pipeline expects. Nothing is claimed about geometry here, and nothing leaves the device until the operator exports it.',
    act: async (page, hold) => {
      await page.goto(`${APP}/?workspace=capture`, { waitUntil: 'load' });
      await page.getByTestId('workspace-capture').waitFor({ timeout: 30_000 });
      await hold(900);
      const files = fs
        .readdirSync(SAMPLE_IMAGES)
        .filter((name) => name.endsWith('.jpg'))
        .slice(0, 4)
        .map((name) => path.join(SAMPLE_IMAGES, name));
      await page.getByLabel('Choose capture images').setInputFiles(files);
      await page.getByText('4 images staged').waitFor({ timeout: 60_000 });
      await hold(1400);
      await page.getByRole('button', { name: 'Staged image 1' }).click();
      await hold(600);
      await page.getByLabel('Assign to view group').selectOption({ label: 'Front' });
      await hold(500);
      await page.getByRole('button', { name: 'Assign', exact: true }).click();
      await hold(1200);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export bundle' }).click();
      await download;
      await hold(1800);
    },
  },
  {
    id: '06-splat',
    kind: 'browser',
    caption: 'Gaussian splat viewer · synthetic fixture, labelled SYNTHETIC',
    narration:
      'The model itself is a Gaussian splat, not a mesh, because splats reproduce what makes a room feel real: soft lighting, glossy surfaces that change with your viewpoint, and thin clutter that photogrammetry tends to blur away. This public viewer streams the splat with a progress bar, then hands you a first-person camera. The room you are walking is a synthetic test fixture, and it says so on screen: it validates the viewer path end to end, but it is not a capture of a real venue.',
    act: async (page, hold) => {
      await page.goto(SPLAT, { waitUntil: 'load' });
      await hold(2500);
      const enter = page.getByRole('button', { name: /enter|start|explore/i }).first();
      if (await enter.isVisible().catch(() => false)) await enter.click();
      await hold(800);
      await page.locator('canvas, body').first().hover();
      await page.mouse.click(640, 380);
      await hold(500);
      await page.keyboard.down('w');
      await hold(1500);
      await page.keyboard.up('w');
      for (let i = 0; i < 30; i += 1) {
        await page.mouse.move(640 + i * 5, 360);
        await page.waitForTimeout(30);
      }
      await hold(1200);
    },
  },
  {
    id: '07-evidence',
    kind: 'slide',
    caption: 'What is verified, and what is refused',
    narration:
      'Evidence, stated exactly. Six hundred and seventy-nine unit tests pass across thirty-six files, seventy-eight Python tests pass, and the browser suites run in Playwright. Two scene bundles validate, including hash checks on every declared asset. The pipeline ran end to end on a synthetic clip: COLMAP registered one hundred thirty-nine of one hundred thirty-nine frames, Brush trained, and compression produced a seventeen megabyte SOG. Then we pointed it at a real room, seventy WhatsApp-compressed photos. It registered fifty-seven percent, which is below our sixty percent gate, so the pipeline refused to train and told the operator to re-shoot. That refusal is the product working: a bad model is worse than an honest stop.',
    html: () => evidenceSlide(),
  },
  {
    id: '08-limits',
    kind: 'slide',
    caption: 'Limits, and the next two rounds',
    narration:
      'What Round 1 does not have. There is no real reconstructed venue yet: the capture that would prove it was refused by the gate, and a re-shoot is scheduled. Walking uses a hand-authored navigation grid, not geometry derived from the capture. Reflections, glass and blank walls remain hard, and scale comes from one measured length. Round 2 attaches points of interest, search and obstacle-aware routing to a real model in one coordinate frame. Round 3 pairs the phone with the studio for on-site capture, and adds optional AR navigation against the twin.',
    html: () => bulletSlide({
      eyebrow: '05 · LIMITS AND NEXT',
      title: 'Honest gaps, planned closure',
      bullets: [
        ['No real venue yet', 'The real capture attempt was refused at 57% registration; a re-shoot is scheduled.'],
        ['Navigation grid', 'Hand-authored, not yet fitted to the capture floor (Round 2).'],
        ['Round 2', 'Points of interest, search and A* on a real model, one coordinate frame.'],
        ['Round 3', 'Phone-to-studio on-site capture, optional AR navigation.'],
      ],
    }),
  },
  {
    id: '09-close',
    kind: 'slide',
    caption: 'Everything is public',
    narration:
      'Everything in this video is public. The viewer is live at namma-space-studio dot vercel dot app. The repository is NAMMA SPACE on GitHub, branch ashwinwork, with the setup commands, the capture standard operating procedure, the reconstruction pipeline, and synthetic sample data in the tests folder. Thank you for watching.',
    html: () => linksSlide(),
  },
];

/* ------------------------------------------------------------------ slides */

const baseCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; }
  body {
    background: #F2EFE6; color: #16181D; padding: 56px 72px 104px;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .eyebrow { font: 500 13px/1 monospace; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6F76; }
  h1 { font-size: 64px; line-height: 1.02; letter-spacing: -0.02em; margin: 14px 0 0; font-weight: 600; }
  h2 { font-size: 42px; line-height: 1.08; letter-spacing: -0.015em; margin: 12px 0 0; font-weight: 600; }
  .lede { font-size: 24px; line-height: 1.35; color: #4A4F57; margin-top: 18px; max-width: 900px; }
  .rule { height: 3px; background: #B9D400; width: 96px; margin: 22px 0 0; }
  footer { font: 400 14px/1.5 monospace; color: #6B6F76; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 26px; }
  .card { border: 1px solid #D5D9E0; background: #FBFAF6; padding: 22px 24px; }
  .card h3 { margin: 0 0 12px; font: 600 17px/1.2 "Helvetica Neue", sans-serif; }
  .card ol { margin: 0; padding-left: 20px; font-size: 17px; line-height: 1.55; color: #33383F; }
  .rows { display: grid; gap: 14px; margin-top: 26px; }
  .row { display: grid; grid-template-columns: 250px 1fr; gap: 20px; border-top: 1px solid #D5D9E0; padding-top: 13px; }
  .row b { font-size: 19px; }
  .row span { font-size: 19px; color: #4A4F57; line-height: 1.45; }
  .table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 18px; }
  .table td { padding: 8px 10px; border-bottom: 1px solid #D5D9E0; }
  .table td:first-child { color: #4A4F57; width: 46%; }
  .table td:last-child { font-weight: 600; }
  .mono { font-family: Menlo, monospace; font-size: 15px; }
  .accent { color: #6F8A00; font-weight: 600; }
`;

function pageShell({ eyebrow, title, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}</style></head>
  <body>
    <div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <div class="rule"></div>
      ${body}
    </div>
    <footer>${footer ?? 'Namma Space · Team TM-12354C3F6F2 · Vellore Institute of Technology'}</footer>
  </body></html>`;
}

function titleSlide({ eyebrow, title, lede, footer }) {
  return pageShell({
    eyebrow,
    title,
    body: `<p class="lede">${lede}</p>`,
    footer,
  });
}

function bulletSlide({ eyebrow, title, bullets }) {
  return pageShell({
    eyebrow,
    title,
    body: `<div class="rows">${bullets
      .map(([label, text]) => `<div class="row"><b>${label}</b><span>${text}</span></div>`)
      .join('')}</div>`,
  });
}

function diagramSlide({ eyebrow, title, left, right }) {
  const card = (data) => `<div class="card"><h3>${data.heading}</h3><ol>${data.steps
    .map((step) => `<li>${step}</li>`)
    .join('')}</ol></div>`;
  return pageShell({
    eyebrow,
    title,
    body: `<div class="grid">${card(left)}${card(right)}</div>`,
  });
}

function evidenceSlide() {
  const rows = [
    ['Unit tests (Vitest)', '679 / 679 passed · 36 files'],
    ['Python tests (pytest)', '78 / 78 passed'],
    ['Browser E2E (Playwright)', '33 passed + 3 retried on this run (software WebGL)'],
    ['Scene bundles validated', '2 / 2 PASS · sha256 verified before load'],
    ['Synthetic pipeline run (28 Oct)', 'COLMAP 139/139 frames · Brush 7k + 30k steps · SOG 17 MB'],
    ['Real capture attempt (70 photos)', '57% registered — refused by the 60% gate, by design'],
  ];
  return pageShell({
    eyebrow: '03 · EVIDENCE',
    title: 'Measured, not asserted',
    body: `<table class="table">${rows
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join('')}</table>
      <p class="lede mono" style="font-size:14px;margin-top:18px">Numbers quoted from this repository: apps/studio/VALIDATION.md, pipeline report.json, logs/round1-rescue/</p>`,
  });
}

function linksSlide() {
  return pageShell({
    eyebrow: '06 · LINKS',
    title: 'Try it yourself',
    body: `<div class="rows">
      <div class="row"><b>Live viewer</b><span class="mono">namma-space-studio.vercel.app</span></div>
      <div class="row"><b>Splat viewer</b><span class="mono">namma-space-pearl.vercel.app</span></div>
      <div class="row"><b>Repository</b><span class="mono">github.com/ujeshauchitha-glitch/NAMMA-SPACE · branch ashwinwork</span></div>
      <div class="row"><b>Docs</b><span class="mono">docs/SOP.md · docs/HANDOFF_UJESHA.md · docs/SUBMISSION_ROUND1.md</span></div>
    </div>`,
  });
}

/* ---------------------------------------------------------------- narration */

function narrate(section) {
  const textPath = path.join(OUT, 'audio', `${section.id}.txt`);
  const aiffPath = path.join(OUT, 'audio', `${section.id}.aiff`);
  fs.writeFileSync(textPath, section.narration, 'utf8');
  if (!fs.existsSync(aiffPath) || process.env.DEMO_RESAY === '1') {
    execFileSync('say', ['-v', VOICE, '-r', '168', '-f', textPath, '-o', aiffPath], { stdio: 'ignore' });
  }
  const info = sh('afinfo', [aiffPath]);
  const match = info.match(/estimated duration:\s*([\d.]+)/);
  if (!match) throw new Error(`no duration for ${section.id}`);
  return Number(match[1]);
}

/* ------------------------------------------------------------------ capture */

async function renderSlide(browser, section) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(section.html(), { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const file = path.join(OUT, 'slides', `${section.id}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

async function recordBrowserSection(browser, section, minSeconds) {
  const dir = path.join(OUT, 'record');
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.bringToFront();
  const started = Date.now();
  const hold = async (ms) => page.waitForTimeout(ms);
  try {
    await section.act(page, hold);
  } finally {
    // Pad so the visuals outlast the narration (the encoder trims to the audio).
    const remaining = minSeconds * 1000 - (Date.now() - started);
    if (remaining > 0) await page.waitForTimeout(remaining);
    const video = page.video();
    await context.close();
    const recorded = await video.path();
    const target = path.join(OUT, 'clips', `${section.id}.webm`);
    fs.copyFileSync(recorded, target);
    return target;
  }
}

/* ------------------------------------------------------------------- encode */

function captionPng(section) {
  const file = path.join(OUT, 'slides', `${section.id}-caption.png`);
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;background:transparent}
    .strip{display:inline-block;background:rgba(18,20,24,0.82);color:#F6F5F0;
      font:500 20px/1.3 "Helvetica Neue", Arial, sans-serif;padding:12px 20px;letter-spacing:0.01em}
  </style></head><body><div class="strip">${section.caption}</div></body></html>`;
  fs.writeFileSync(file.replace(/\.png$/, '.html'), html, 'utf8');
  return { file, html };
}

async function renderCaption(browser, section) {
  const { file, html } = captionPng(section);
  const page = await browser.newPage({ viewport: { width: W, height: 64 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(80);
  const strip = path.join(OUT, 'slides', `${section.id}-strip.png`);
  await page.locator('.strip').screenshot({ path: strip });
  await page.close();
  return strip;
}

function encodeSegment({ section, visual, audio, captionStrip, duration }) {
  const out = path.join(OUT, 'clips', `${section.id}.mp4`);
  const isStill = visual.endsWith('.png');
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (isStill) args.push('-loop', '1', '-i', visual);
  else args.push('-i', visual);
  args.push('-i', audio, '-i', captionStrip);
  const filter = isStill
    ? `[0:v]scale=${W}:${H},fps=30[base];[2:v]null[cap];[base][cap]overlay=24:H-h-20[v]`
    : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30[base];[2:v]null[cap];[base][cap]overlay=24:H-h-20[v]`;
  args.push(
    '-filter_complex', filter,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-t', String(duration + 0.4),
    out,
  );
  sh('ffmpeg', args);
  return out;
}

function concatSegments(segments) {
  const list = path.join(OUT, 'clips', 'concat.txt');
  fs.writeFileSync(list, segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(OUT, 'namma-space-demo.mp4');
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  return out;
}

/* --------------------------------------------------------------------- main */

const only = (() => {
  const index = process.argv.indexOf('--only');
  return index >= 0 ? process.argv[index + 1] : null;
})();
const sections = only ? SECTIONS.filter((s) => s.id.startsWith(only)) : SECTIONS;

const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const segments = [];
let total = 0;
try {
  for (const section of sections) {
    const duration = narrate(section);
    const captionStrip = await renderCaption(browser, section);
    const visual = section.kind === 'slide' ? await renderSlide(browser, section) : await recordBrowserSection(browser, section, duration + 1);
    const audio = path.join(OUT, 'audio', `${section.id}.aiff`);
    const segment = encodeSegment({ section, visual, audio, captionStrip, duration });
    segments.push(segment);
    total += duration;
    console.log(`${section.id.padEnd(12)} ${duration.toFixed(1)}s  -> ${path.relative(ROOT, segment)}`);
  }
} finally {
  await browser.close();
}

if (segments.length > 1) {
  const merged = concatSegments(segments);
  fs.mkdirSync(path.dirname(FINAL), { recursive: true });
  fs.copyFileSync(merged, FINAL);
  const probe = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', FINAL]);
  const { duration, size } = JSON.parse(probe).format;
  console.log(`\nFinal: ${path.relative(ROOT, FINAL)}  ${Number(duration).toFixed(1)}s  ${(Number(size) / 1e6).toFixed(1)} MB`);
  console.log(`Narration total: ${(total / 60).toFixed(2)} min across ${segments.length} sections`);
}
