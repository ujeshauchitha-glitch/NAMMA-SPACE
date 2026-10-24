/**
 * Motion tokens — the single JS source of truth (DESIGN_HANDOFF §7.1).
 * Mirrored in src/styles/tokens.css as --dur-* / --ease-* / --stagger.
 * GSAP consumes these via `gsap.to(el, { duration: M.dur.base, ease: M.ease.out })`;
 * never hardcode a duration or ease in JS that exists here or in tokens.css.
 *
 * Durations are seconds (GSAP unit); the CSS mirrors are milliseconds.
 */
export const M = {
  dur: { instant: 0.09, fast: 0.14, base: 0.22, panel: 0.32, workspace: 0.42, scene: 0.9 },
  ease: {
    out: 'power3.out',
    inOut: 'power2.inOut',
    standard: 'power1.inOut',
    settle: 'expo.out',
    pop: 'back.out(1.4)', // pop: dots/badges ONLY
  },
  stagger: 0.028,
  entrance: { from: { y: 8, opacity: 0 } },
} as const;

export type MotionTokens = typeof M;
