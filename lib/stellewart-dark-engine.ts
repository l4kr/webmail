// GENERATED from Stellewart darkmode/engine.js by darkmode/sync.mjs. Edit it there, not here.
/* eslint-disable */
// @ts-nocheck

/** Factory for the Stellewart mail dark-mode engine (see lib/email-dark-mode.ts). */
export const createStellewartDarkMode = (function () {
  'use strict';
  /*
   * Stellewart dark mode for HTML mail: one engine for the Bulwark webmail
   * (runs on the mail iframe's document) and Bulwark Mobile (injected into the
   * WebView). This file is a single expression that evaluates to a factory;
   * darkmode/sync.mjs copies it into both forks. Plain ES5, no template
   * literals: the mobile app embeds it as a raw string.
   *
   * Goal: read like Fastmail. The rendered mail is read back through
   * getComputedStyle and its colours are rewritten in place:
   *  - Light surfaces become dark ones. White lands exactly on the app's card
   *    colour, and light greys land a step lighter, so a mail's own layering
   *    (grey page, white card) stays visible instead of melting together.
   *  - Vivid brand fills (buttons, banners) keep their hue but are dimmed, so
   *    they don't glare on a dark screen.
   *  - Text is rebuilt from the contrast the sender gave it: body text comes
   *    out near white (about 12:1), secondary greys a little dimmer, and
   *    nothing ends below 4.5:1.
   *  - Images keep their pixels and get no light box behind them. A
   *    see-through image whose dark artwork would vanish (a black logo, a grey
   *    wordmark) has its lightness flipped with its colours kept.
   *  - Mails that ship their own dark styles are left to them (the host pins
   *    their prefers-color-scheme rules and doesn't run this pass).
   */

  var DEFAULTS = {
    /** The app surface the mail sits on; white maps to exactly this. */
    canvas: '#1b1e20',
    /** Contrast plain body text (black on white) is rebuilt to. */
    textMax: 12.5,
    /** No text ends below this. */
    textMin: 4.5,
    /** Shapes how the sender's text greys spread between textMin and textMax (1 = linear). */
    textCurve: 0.6,
    /** Lightness factor for vivid fills (OKLCH L). 1 keeps them as sent. */
    vividDim: 0.7,
    /** Flip the lightness of see-through images whose artwork would vanish. */
    flipImages: true,
    /** The user allowed remote content: a remote image may be fetched again with CORS to read its pixels. */
    remoteContentAllowed: false
  };

  // ---------------------------------------------------------------------------
  // Colour maths: sRGB <-> OKLab/OKLCH, WCAG contrast

  function parseRgb(value) {
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/i.exec(value || '');
    if (!m) return null;
    var a = 1;
    if (m[4] !== undefined && m[4] !== '') {
      a = m[4].charAt(m[4].length - 1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  // Computed styles report modern syntaxes (oklch(), lab(), color(...)) as
  // written. Painting them once on a 1x1 canvas turns any of them into sRGB.
  var probe = null;
  var probeCache = {};
  function parseAny(value, doc) {
    if (!value || value === 'transparent') return value === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : null;
    var rgb = parseRgb(value);
    if (rgb) return rgb;
    if (/^(none|auto|currentcolor|inherit|initial)$/i.test(value)) return null;
    if (Object.prototype.hasOwnProperty.call(probeCache, value)) return probeCache[value];
    var out = null;
    try {
      if (!probe) {
        var c = (doc || document).createElement('canvas');
        c.width = 1; c.height = 1;
        probe = c.getContext('2d', { willReadFrequently: true });
      }
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = 'rgba(0,0,0,0)';
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        var d = probe.getImageData(0, 0, 1, 1).data;
        out = d[3] === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
    } catch (e) { out = null; }
    probeCache[value] = out;
    return out;
  }

  function formatColor(c) {
    var R = Math.round(c.r), G = Math.round(c.g), B = Math.round(c.b);
    return c.a >= 1
      ? 'rgb(' + R + ', ' + G + ', ' + B + ')'
      : 'rgba(' + R + ', ' + G + ', ' + B + ', ' + (+c.a.toFixed(3)) + ')';
  }

  function toLinear(v) {
    var c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function fromLinear(v) {
    var c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return c * 255;
  }

  function toLch(c) {
    var lr = toLinear(c.r), lg = toLinear(c.g), lb = toLinear(c.b);
    var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { l: L, c: Math.sqrt(A * A + B * B), h: Math.atan2(B, A) };
  }

  function lchToLinear(L, C, H) {
    var A = C * Math.cos(H), B = C * Math.sin(H);
    var l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    var m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    var s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
  }

  function outOfGamut(lin) {
    for (var i = 0; i < 3; i++) if (lin[i] < -1e-4 || lin[i] > 1 + 1e-4) return true;
    return false;
  }

  /** OKLCH back to sRGB, pulling chroma in until the colour fits the gamut. */
  function fromLch(L, C, H, a) {
    L = Math.max(0, Math.min(1, L));
    var lin = lchToLinear(L, C, H);
    for (var i = 0; i < 30 && outOfGamut(lin); i++) {
      C *= 0.88;
      lin = lchToLinear(L, C, H);
    }
    var ch = lin.map(function (v) { return Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))); });
    return { r: ch[0], g: ch[1], b: ch[2], a: a === undefined ? 1 : a };
  }

  function luminance(c) {
    return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
  }

  function contrastRatio(x, y) {
    var lx = luminance(x), ly = luminance(y);
    return (Math.max(lx, ly) + 0.05) / (Math.min(lx, ly) + 0.05);
  }

  function sameColor(x, y) {
    return Math.round(x.r) === Math.round(y.r) && Math.round(x.g) === Math.round(y.g) &&
      Math.round(x.b) === Math.round(y.b) && Math.abs(x.a - y.a) < 0.01;
  }

  /** Paints a translucent colour over an opaque one. */
  function composite(top, under) {
    var a = top.a;
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
  }

  // ---------------------------------------------------------------------------
  // The colour mapping

  var WHITE = { r: 255, g: 255, b: 255, a: 1 };
  /** Chroma from which a fill counts as a deliberate brand colour. */
  var VIVID_CHROMA = 0.09;
  /** Fills at or below this lightness are already dark and stay as sent. */
  var DARK_L = 0.45;

  function createMapper(opts) {
    var canvas = parseRgb(opts.canvasRgb) || { r: 27, g: 30, b: 32, a: 1 };
    var cv = toLch(canvas);

    /**
     * Lightness a light neutral surface lands on. White → the canvas; the
     * near-white greys mails use for page backgrounds and cards spread out
     * quickly (#f2f2f2 lands about 0.06 lighter), so layers stay visible.
     * Mid greys fold down to meet the already-dark range.
     */
    var CURVE = [[1, 0], [0.955, 0.065], [0.9, 0.1], [0.8, 0.14], [0.68, 0.17]];
    function surfaceL(l) {
      if (l >= 1) return cv.l;
      for (var i = 1; i < CURVE.length; i++) {
        if (l >= CURVE[i][0]) {
          var p = CURVE[i - 1], q = CURVE[i];
          var t = (p[0] - l) / (p[0] - q[0]);
          return cv.l + p[1] + (q[1] - p[1]) * t;
        }
      }
      // 0.68 … 0.45: fold towards DARK_L so it joins the kept dark fills.
      var top = cv.l + CURVE[CURVE.length - 1][1];
      var t2 = (CURVE[CURVE.length - 1][0] - l) / (CURVE[CURVE.length - 1][0] - DARK_L);
      return top + (DARK_L - top) * t2;
    }

    /** Dark counterpart of a background colour. */
    function mapBackground(color) {
      if (!color || color.a === 0) return color;
      var lch = toLch(color);
      if (lch.c >= VIVID_CHROMA) {
        // Brand colour: same hue, dimmed so it doesn't glare. Dark ones stay.
        if (lch.l <= 0.6 || opts.vividDim >= 1) return color;
        var l = Math.max(0.42, lch.l * opts.vividDim);
        return fromLch(l, lch.c, lch.h, color.a);
      }
      if (lch.l <= DARK_L) return color;
      // Neutral and pastel surfaces. Near-neutral ones take the canvas tint so
      // a mail's white and the app's card are one colour; pastels keep a hint
      // of their own hue.
      var neutral = lch.c < 0.02;
      var c = neutral ? cv.c : Math.max(cv.c, lch.c * 0.55);
      var h = neutral ? cv.h : lch.h;
      return fromLch(surfaceL(lch.l), c, h, color.a);
    }

    /** Text contrast to aim for, from the contrast the sender gave it. */
    function textTarget(originalRatio) {
      if (!(originalRatio >= 3)) return opts.textMin;
      var t = Math.min(1, (originalRatio - 3) / 18);
      return opts.textMin + (opts.textMax - opts.textMin) * Math.pow(t, opts.textCurve);
    }

    /**
     * Same hue at the lightness (moving away from bg) where contrast against
     * bg first reaches target. Binary search: contrast is monotonic in L
     * on either side of the background.
     */
    function solveLightness(lch, bg, target, lighten, a) {
      var lo = lighten ? toLch(bg).l : 0, hi = lighten ? 1 : toLch(bg).l;
      var best = fromLch(lighten ? 1 : 0, lch.c, lch.h, a);
      for (var i = 0; i < 22; i++) {
        var mid = (lo + hi) / 2;
        var cand = fromLch(mid, lch.c, lch.h, a);
        var ok = contrastRatio(cand, bg) >= target;
        if (ok) { best = cand; if (lighten) hi = mid; else lo = mid; }
        else if (lighten) lo = mid; else hi = mid;
      }
      return best;
    }

    /**
     * Text colour on the converted background. bg/bgOriginal are the
     * opaque surfaces behind it after and before conversion.
     */
    function mapText(color, bg, bgOriginal) {
      if (!color || color.a === 0) return color;
      var before = composite(color, bgOriginal);
      var now = composite(color, bg);
      var target = textTarget(contrastRatio(before, bgOriginal));
      var bgL = toLch(bg).l;
      var lighten = bgL < 0.6;
      var lch = toLch(now);
      var current = contrastRatio(now, bg);
      // Already on the right side of the background and readable: leave it
      // (white text on a dark banner, a light link on a kept dark block).
      if ((lighten ? lch.l > bgL : lch.l < bgL) && current >= target) return color;
      // Very saturated text keeps a little less chroma when lifted, so a
      // brand-blue link turns sky blue rather than neon.
      var c = lch.c > 0.15 ? lch.c * 0.85 : lch.c;
      return solveLightness({ l: lch.l, c: c, h: lch.h }, bg, target, lighten, 1);
    }

    /** A border between an element and its parent surface. */
    function mapBorder(color, parentBg) {
      if (!color || color.a === 0) return color;
      // Light rules (grey or tinted) darken like the surfaces they divide.
      var next = toLch(color).l > DARK_L ? mapBackground(color) : color;
      var opaque = composite(next, parentBg);
      if (contrastRatio(opaque, parentBg) >= 1.25) return next;
      var l2 = toLch(opaque);
      return solveLightness({ l: l2.l, c: l2.c, h: l2.h }, parentBg, 1.35, toLch(parentBg).l < 0.6, 1);
    }

    return { canvas: canvas, mapBackground: mapBackground, mapText: mapText, mapBorder: mapBorder, textTarget: textTarget };
  }

  // ---------------------------------------------------------------------------
  // The DOM pass

  var BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
  var SKIP_TAGS = { IMG: 1, VIDEO: 1, CANVAS: 1, PICTURE: 1, SOURCE: 1, svg: 1, SVG: 1, STYLE: 1, SCRIPT: 1, BR: 1, WBR: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1 };

  /** True for a background-image that actually paints a picture. */
  function hasImage(backgroundImage) {
    if (!backgroundImage || backgroundImage === 'none') return false;
    // The external-content blocker rewrites remote urls to url(""), which paints nothing.
    return /url\(/i.test(backgroundImage.replace(/url\(\s*(?:""|''|)\s*\)/gi, ''));
  }

  function mapGradientColors(value, map, doc) {
    return value.replace(/(rgba?|oklch|oklab|lab|lch|hsla?|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, function (m) {
      var c = parseAny(m, doc);
      return c ? formatColor(map(c)) : m;
    });
  }

  // --- Images ---------------------------------------------------------------

  var FLIP_FILTER_ID = 'stellewart-flip-lightness';

  /**
   * An SVG filter that flips luminance and keeps colour differences, landing
   * white exactly on the canvas: per channel, in sRGB,
   *   out = in - (2 - k)·Y + 1      (k = the canvas channel)
   * so white → canvas, black → white, a grey wordmark → light grey, and an
   * orange symbol stays orange.
   */
  function ensureFlipFilter(doc, canvas) {
    if (doc.getElementById(FLIP_FILTER_ID)) return;
    var kr = canvas.r / 255, kg = canvas.g / 255, kb = canvas.b / 255;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    var filter = doc.createElementNS(NS, 'filter');
    filter.setAttribute('id', FLIP_FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    var m = doc.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    var Y = [0.2126, 0.7152, 0.0722];
    function row(k, own) {
      var f = 2 - k;
      return [(own === 0 ? 1 : 0) - f * Y[0], (own === 1 ? 1 : 0) - f * Y[1], (own === 2 ? 1 : 0) - f * Y[2], 0, 1];
    }
    m.setAttribute('values', row(kr, 0).concat(row(kg, 1), row(kb, 2), [0, 0, 0, 1, 0]).join(' '));
    filter.appendChild(m);
    svg.appendChild(filter);
    (doc.body || doc.documentElement).appendChild(svg);
  }

  /**
   * Reads an image's pixels: is it see-through, and would most of what it
   * draws vanish against bg? 'unknown' when the pixels can't be read (a
   * cross-origin image without CORS).
   */
  function judgeImage(source, doc, bg) {
    var w = source.naturalWidth, h = source.naturalHeight;
    if (!w || !h) return 'fine';
    var scale = Math.min(1, 128 / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), chh = Math.max(1, Math.round(h * scale));
    var cnv = doc.createElement('canvas');
    cnv.width = cw; cnv.height = chh;
    var ctx = cnv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'unknown';
    var data;
    try {
      ctx.drawImage(source, 0, 0, cw, chh);
      data = ctx.getImageData(0, 0, cw, chh).data;
    } catch (e) {
      return 'unknown';
    }
    var clear = 0, drawn = 0, hidden = 0, white = 0, dark = 0, colourful = 0;
    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3] / 255;
      if (a < 0.5) { clear++; continue; }
      drawn++;
      var R = data[i], G = data[i + 1], B = data[i + 2];
      var px = composite({ r: R, g: G, b: B, a: a }, bg);
      if (contrastRatio(px, bg) < 2) hidden++;
      var Y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
      var spread = Math.max(R, G, B) - Math.min(R, G, B);
      if (spread > 30) colourful++;
      if (Y > 0.92 && spread < 12) white++;
      else if (Y < 0.3) dark++;
    }
    var total = data.length / 4;
    if (drawn === 0) return 'fine';
    if (clear / total < 0.02) {
      // Opaque. Photos and banners keep their pixels. A colourless logo or
      // wordmark saved on a white box (flat: white and dark, few mid-tones
      // outside its edges) would show as a white slab: flip it onto the
      // canvas. Product shots on white have soft shading (many mid-tones)
      // and stay as they are.
      var ink = drawn - white;
      var midOfInk = ink ? (ink - dark) / ink : 0;
      var flat = (white + dark) / drawn > 0.85 && midOfInk < 0.3;
      var logoLike = flat && white / drawn > 0.1 && colourful / drawn < 0.05;
      return logoLike ? 'flip' : 'fine';
    }
    // A wordmark next to a coloured symbol is a small share of the pixels,
    // so a sizeable minority that would vanish is enough.
    return hidden / drawn > 0.15 ? 'flip' : 'fine';
  }

  function whenLoaded(img) {
    if (img.complete) return Promise.resolve(img.naturalWidth > 0);
    return new Promise(function (resolve) {
      img.addEventListener('load', function () { resolve(true); }, { once: true });
      img.addEventListener('error', function () { resolve(false); }, { once: true });
    });
  }

  function loadCorsCopy(img, doc) {
    var src = img.currentSrc || img.src;
    if (!/^https?:/i.test(src)) return Promise.resolve(null);
    var copy = doc.createElement('img');
    copy.crossOrigin = 'anonymous';
    copy.referrerPolicy = 'no-referrer';
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, 8000);
      copy.onload = function () { clearTimeout(timer); resolve(copy); };
      copy.onerror = function () { clearTimeout(timer); resolve(null); };
      copy.src = src;
    });
  }

  function flipIfNeeded(img, bg, options) {
    return whenLoaded(img).then(function (ok) {
      if (!ok || !img.isConnected) return;
      var doc = img.ownerDocument;
      if (img.naturalWidth <= 2 && img.naturalHeight <= 2) return; // spacers, tracking pixels
      var verdict = judgeImage(img, doc, bg);
      if (verdict !== 'unknown' || !options.remoteContentAllowed) return verdict;
      return loadCorsCopy(img, doc).then(function (copy) { return copy ? judgeImage(copy, doc, bg) : 'unknown'; });
    }).then(function (verdict) {
      // Pixels we can't read are left as they are, the way Fastmail does.
      if (verdict !== 'flip' || !img.isConnected) return;
      ensureFlipFilter(img.ownerDocument, options.canvasRgbValue);
      img.style.setProperty('filter', 'url(#' + FLIP_FILTER_ID + ')', 'important');
      img.setAttribute('data-stellewart-flipped', '');
    });
  }

  // --- The pass -------------------------------------------------------------

  function readOptions(options) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (options) for (var k2 in options) if (options[k2] !== undefined) o[k2] = options[k2];
    return o;
  }

  /**
   * Converts a rendered mail document to dark colours in place. Call once,
   * after the document has parsed. Returns a promise that settles when the
   * image pass is done (the colours are written before it returns).
   */
  function apply(doc, options) {
    var opts = readOptions(options);
    var win = doc.defaultView;
    var body = doc.body;
    var html = doc.documentElement;
    var imagePass = Promise.resolve();
    try {
      if (!win || !body) return imagePass;
      opts.canvasRgbValue = parseAny(opts.canvas, doc) || { r: 27, g: 30, b: 32, a: 1 };
      opts.canvasRgb = formatColor(opts.canvasRgbValue);
      var map = createMapper(opts);
      var canvas = map.canvas;

      // Un-pin the host's pending canvas to read the mail's own.
      html.classList.remove('bulwark-dark-pending');
      var htmlBg = parseAny(win.getComputedStyle(html).backgroundColor, doc);
      var mailCanvas = htmlBg && htmlBg.a === 1 && !sameColor(htmlBg, canvas) ? htmlBg : null;
      var base = mailCanvas ? map.mapBackground(mailCanvas) : canvas;

      var elements = [body];
      var all = body.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el0 = all[i];
        if (!SKIP_TAGS[el0.tagName] && !(el0.closest && el0.closest('svg'))) elements.push(el0);
      }

      // Read everything first, then write: interleaving forces a style recalc per element.
      var snaps = elements.map(function (el) {
        var cs = win.getComputedStyle(el);
        return {
          el: el,
          color: parseAny(cs.color, doc),
          bg: parseAny(cs.backgroundColor, doc),
          bgImage: cs.backgroundImage,
          borders: BORDER_SIDES.map(function (side) {
            return cs.getPropertyValue('border-' + side + '-style') !== 'none' && parseFloat(cs.getPropertyValue('border-' + side + '-width')) > 0
              ? parseAny(cs.getPropertyValue('border-' + side + '-color'), doc)
              : null;
          })
        };
      });

      var root = { bg: base, original: mailCanvas || WHITE, onImage: false };
      var surfaces = new Map();
      function surfaceOf(el) {
        for (var n = el; n; n = n.parentElement) {
          var s = surfaces.get(n);
          if (s) return s;
        }
        return root;
      }

      var writes = [];
      function set(el, prop, value) { writes.push(function () { el.style.setProperty(prop, value, 'important'); }); }

      if (mailCanvas && !sameColor(base, mailCanvas)) set(html, 'background-color', formatColor(base));

      snaps.forEach(function (snap) {
        var el = snap.el;
        var parent = el === body ? root : surfaceOf(el.parentElement);
        var surface = parent;

        if (hasImage(snap.bgImage)) {
          // Picture background: keep the element's fill and its text as sent;
          // the sender designed the two to be read together.
          var fill = snap.bg && snap.bg.a > 0 ? composite(snap.bg, parent.bg) : parent.bg;
          surface = { bg: fill, original: fill, onImage: true };
        } else {
          if (snap.bgImage && snap.bgImage !== 'none' && !parent.onImage) {
            var gradient = mapGradientColors(snap.bgImage, map.mapBackground, doc);
            if (gradient !== snap.bgImage) set(el, 'background-image', gradient);
          }
          if (el === body && snap.bg && sameColor(snap.bg, canvas)) {
            // The host's own dark canvas, not a fill the sender chose.
          } else if (snap.bg && snap.bg.a > 0 && !(parent.onImage && snap.bg.a < 0.9)) {
            var original = snap.bg;
            var next = map.mapBackground(original);
            surface = {
              bg: composite(next, parent.bg),
              original: composite(original, parent.original),
              onImage: false
            };
            if (!sameColor(next, original)) set(el, 'background-color', formatColor(next));
          }
        }
        surfaces.set(el, surface);
        if (surface.onImage) return;

        if (snap.color) {
          var text = map.mapText(snap.color, surface.bg, surface.original);
          if (text !== snap.color && !sameColor(text, snap.color)) {
            set(el, 'color', formatColor(text));
            // Underlines and other decorations drawn in the old colour follow it.
            set(el, 'text-decoration-color', formatColor(text));
          }
        }
        snap.borders.forEach(function (border, side) {
          if (!border || border.a === 0) return;
          var nb = map.mapBorder(border, parent.bg);
          if (!sameColor(nb, border)) set(el, 'border-' + BORDER_SIDES[side] + '-color', formatColor(nb));
        });
      });

      // See-through images on a surface that went from light to dark.
      var flips = [];
      if (opts.flipImages) {
        var imgs = body.querySelectorAll('img');
        for (var j = 0; j < imgs.length; j++) {
          var s = surfaceOf(imgs[j].parentElement);
          if (s.onImage || s.bg === s.original) continue;
          if (toLch(s.original).l < 0.7 || contrastRatio(s.original, s.bg) < 3) continue;
          flips.push({ img: imgs[j], bg: s.bg });
        }
      }

      writes.forEach(function (w) { w(); });
      imagePass = Promise.all(flips.map(function (f) { return flipIfNeeded(f.img, f.bg, opts).catch(function () {}); }));
    } finally {
      html.classList.remove('bulwark-dark-pending');
    }
    return imagePass;
  }

  /** Back-compat names of the stock Bulwark engine (used by the hosts' tests). */
  function darkenBackground(color, options) {
    var opts = readOptions(options);
    opts.canvasRgb = formatColor(parseRgb(opts.canvas) || parseAny(opts.canvas) || { r: 27, g: 30, b: 32, a: 1 });
    return createMapper(opts).mapBackground(color);
  }
  function ensureContrast(color, bg, minRatio) {
    if (!color || color.a === 0) return color;
    var now = composite(color, bg);
    if (contrastRatio(now, bg) >= minRatio) return color;
    var lch = toLch(now);
    var bgL = toLch(bg).l;
    var lo = bgL < 0.6 ? bgL : 0, hi = bgL < 0.6 ? 1 : bgL, best = null;
    for (var i = 0; i < 22; i++) {
      var mid = (lo + hi) / 2, cand = fromLch(mid, lch.c, lch.h, 1);
      if (contrastRatio(cand, bg) >= minRatio) { best = cand; if (bgL < 0.6) hi = mid; else lo = mid; }
      else if (bgL < 0.6) lo = mid; else hi = mid;
    }
    return best || fromLch(bgL < 0.6 ? 1 : 0, lch.c, lch.h, 1);
  }

  return {
    DEFAULTS: DEFAULTS,
    parseComputedColor: parseRgb,
    parseColor: parseAny,
    formatColor: formatColor,
    contrastRatio: contrastRatio,
    darkenBackground: darkenBackground,
    ensureContrast: ensureContrast,
    hasImage: hasImage,
    createMapper: createMapper,
    apply: apply
  };
});
