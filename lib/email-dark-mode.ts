/**
 * Dark mode for HTML email bodies rendered in a viewer iframe.
 *
 * Instead of inverting the whole body with a CSS filter (which turns brand
 * red into pink, flips photos that then need re-inverting, and depends on
 * which background attributes survived the external-content blocker), the
 * rendered document is read back through getComputedStyle and its colours are
 * rewritten in place:
 *
 * - Light backgrounds are darkened with their hue kept. Vivid colours (brand
 *   buttons, banners) and backgrounds that are already dark stay as sent.
 * - Text and borders only change when they lack contrast against the new
 *   background; they are then lightened (or darkened) in their own hue.
 * - Images are never touched. An element painted with a background image keeps
 *   its colours, and so does the text drawn straight on it: the sender
 *   designed the two to be read together.
 *
 * Because the pass works on computed styles, colours from inline styles,
 * legacy attributes (bgcolor, <font color>) and <style> blocks are all handled
 * the same way, whether or not remote content is loaded.
 */

/** Whether the email ships its own dark styles. */
export function emailHasNativeDarkMode(html: string): boolean {
  return /prefers-color-scheme\s*:\s*dark/i.test(html);
}

/**
 * `color-scheme` for the iframe element and its root. A mail with its own
 * dark styles gets `dark`, so its `prefers-color-scheme: dark` rules apply
 * whenever the app shows it dark - not only when the OS is dark too, which is
 * what `light dark` would mean.
 */
export function emailColorScheme(isDark: boolean, nativeDarkMode: boolean): 'light' | 'dark' {
  return isDark && nativeDarkMode ? 'dark' : 'light';
}

const ALWAYS = '(min-width: 0px)';
const NEVER = '(max-width: 0.001px)';

/**
 * Pins the mail's `prefers-color-scheme` media queries to the theme the app
 * shows it in. Inside the iframe they would follow the OS, not the app: a
 * light app on a dark OS would render the mail's dark variant, and the app's
 * dark mode on a light OS would never trigger it. Only <style> blocks are
 * rewritten.
 */
export function resolveColorSchemeMedia(html: string, isDark: boolean): string {
  if (!/prefers-color-scheme/i.test(html)) return html;
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) =>
    open + css.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (_q, scheme: string) =>
      (scheme.toLowerCase() === 'dark') === isDark ? ALWAYS : NEVER) + close);
}

/** Canvas the converted mail sits on (white maps to this). */
export const EMAIL_DARK_BACKGROUND = '#1b1e20';
const DARK_TEXT = '#e3e5e6';
const DARK_LINK = '#8ab4f8';

/** Class on <html> that keeps the body hidden until the pass has run. */
export const DARK_PENDING_CLASS = 'bulwark-dark-pending';

/**
 * Stylesheet for the srcdoc head in dark mode. Sets the fallback colours for
 * mails that set none, and hides the body until {@link applyEmailDarkMode}
 * ran so the light original never flashes. The canvas is pinned too while
 * pending: a mail that paints <html> itself (`html { background: #fff }`)
 * would otherwise show as a white box until the pass. The reveal animation
 * is a failsafe: the body shows after a moment even if the pass never runs.
 */
export function emailDarkModeCss(): string {
  return `
      html { background: ${EMAIL_DARK_BACKGROUND}; }
      body { color: ${DARK_TEXT}; background: ${EMAIL_DARK_BACKGROUND}; }
      a { color: ${DARK_LINK}; }
      @keyframes bulwark-dark-reveal { to { visibility: visible; } }
      html.${DARK_PENDING_CLASS} { background-color: ${EMAIL_DARK_BACKGROUND} !important; }
      html.${DARK_PENDING_CLASS} body { visibility: hidden; animation: bulwark-dark-reveal 0s 1.5s forwards; }
    `;
}

// ---------------------------------------------------------------------------
// The pass itself: the Stellewart engine (lib/stellewart-dark-engine.ts,
// generated from Stellewart darkmode/engine.js and shared with Bulwark Mobile).
// It lands white exactly on EMAIL_DARK_BACKGROUND, keeps a mail's layers
// apart, dims bright brand fills in their hue, rebuilds text contrast from
// the sender's and flips see-through or white-boxed dark logos instead of
// putting a light plate behind them.

import { createStellewartDarkMode } from './stellewart-dark-engine';

export interface Rgba { r: number; g: number; b: number; a: number }

interface StellewartDarkMode {
  parseComputedColor(value: string): Rgba | null;
  formatColor(color: Rgba): string;
  contrastRatio(x: Rgba, y: Rgba): number;
  darkenBackground(color: Rgba, options?: { canvas?: string }): Rgba;
  ensureContrast(color: Rgba, bg: Rgba, minRatio: number): Rgba;
  apply(doc: Document, options?: Record<string, unknown>): Promise<void>;
}

const engine = createStellewartDarkMode() as StellewartDarkMode;

export const parseComputedColor = (value: string): Rgba | null => engine.parseComputedColor(value);
export const formatColor = (color: Rgba): string => engine.formatColor(color);
export const contrastRatio = (x: Rgba, y: Rgba): number => engine.contrastRatio(x, y);
/** Dark counterpart of a background colour, on the mail canvas. */
export const darkenBackground = (color: Rgba): Rgba => engine.darkenBackground(color, { canvas: EMAIL_DARK_BACKGROUND });
export const ensureContrast = (color: Rgba, bg: Rgba, minRatio: number): Rgba => engine.ensureContrast(color, bg, minRatio);

export interface EmailDarkModeOptions {
  /**
   * The user allowed remote content for this message. Only then may a remote
   * image be fetched a second time (with CORS) to look at its pixels.
   */
  remoteContentAllowed?: boolean;
}

/**
 * Converts a rendered email document to dark colours in place. Call once,
 * after the document has parsed. Colours are written before it returns; the
 * image pass (logo flips) finishes once each image has loaded.
 */
export function applyEmailDarkMode(doc: Document, options: EmailDarkModeOptions = {}): void {
  try {
    void engine.apply(doc, { remoteContentAllowed: !!options.remoteContentAllowed, canvas: EMAIL_DARK_BACKGROUND });
  } finally {
    doc.documentElement?.classList.remove(DARK_PENDING_CLASS);
  }
}
