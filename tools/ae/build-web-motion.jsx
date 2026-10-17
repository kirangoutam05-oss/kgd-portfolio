// Rebuilds the site's motion as After Effects compositions.
//
// Two comps, both 1920x1080 at 30fps, laid out the way the pages lay out
// at a 1920-wide window:
//   Home - Hero Intro        index.html: dot field, top bar, then the
//                            portrait, role tag, name and card landing in
//                            turn on the blurPop keyframes.
//   Case Study - Hero Reveal forum-by-rego.html: the hero every case study
//                            shares - eyebrow, the title sliding out from
//                            behind its edge, copy, chips, meta row, and
//                            the slow 24s drift of the light behind it.
//
// Timings and curves are copied from the CSS, not eyeballed: every
// cubic-bezier becomes the keyframe ease that draws the same curve, and
// every layer's comment names the rule it came from. When the CSS
// changes, change the numbers here to match and run it again.
//
// Run with tools/ae/build-web-motion.ps1. The project it saves,
// work/ae/kgd-web-motion.aep, is generated: a rebuild replaces it, so
// save hand edits under another name.
//
// ExtendScript is ES3 - no JSON, no let, no Array.forEach.

(function () {
  var HERE = new File($.fileName).parent;            // tools/ae
  var REPO = HERE.parent.parent;
  var SITE = REPO.fsName + '/outputs';
  var OUT = REPO.fsName + '/work/ae';
  var PROJECT_FILE = new File(OUT + '/kgd-web-motion.aep');
  var LOG_FILE = new File(OUT + '/build-log.json');

  var W = 1920, H = 1080, FPS = 30;
  // Kept out of the source as a literal: ExtendScript can misread UTF-8
  // in a file without a BOM.
  var DASH = String.fromCharCode(0x2014);
  var report = { ok: false, steps: [], missingFonts: [], warnings: [] };

  function step(s) { report.steps.push(s); }
  function warn(s) { report.warnings.push(s); }

  // ---------------------------------------------------------------- values

  function hex(h) {
    return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255,
            parseInt(h.substr(5, 2), 16) / 255];
  }
  var C = {
    paper: hex('#ffffff'), ink: hex('#131316'), inkDim: hex('#63636a'),
    deep: hex('#141414'), heroInk: hex('#f6f3f1'), heroCopy: hex('#d6cfca'),
    eyebrow: hex('#e8a07a'), rego: hex('#e8622a'), white: hex('#ffffff')
  };

  // The CSS curves, as cubic-bezier control points.
  var EASE = {
    blurPop: [0.22, 1, 0.3, 1],
    kgdEase: [0.22, 0.61, 0.36, 1],     // --kgd-ease
    kgdOut: [0.16, 1, 0.3, 1],          // --kgd-out
    ease: [0.25, 0.1, 0.25, 1]          // the CSS keyword
  };

  // ------------------------------------------------------------- keyframes

  function isSpatial(prop) {
    return prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
           prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL;
  }

  function delta(a, b) {
    if (!(a instanceof Array)) return [b - a];
    var d = [];
    for (var i = 0; i < a.length; i++) d.push(b[i] - a[i]);
    return d;
  }

  // One end of one segment, as the KeyframeEase list AE wants for it.
  // A cubic-bezier's first handle leaves at (x1, y1): in AE terms that is
  // an influence of x1 and a speed of y1/x1 times the segment's average
  // rate; the second handle mirrors it from the far end. Position moves
  // along a path, so it takes one speed for the distance; everything else
  // takes one per dimension.
  function segmentEase(k0, k1, bez, end, spatial) {
    var dt = k1[0] - k0[0];
    var d = delta(k0[1], k1[1]);
    var x = end === 'out' ? bez[0] : 1 - bez[2];
    var y = end === 'out' ? bez[1] : 1 - bez[3];
    var slope = x > 0.0005 ? y / x : 0;
    var influence = Math.max(0.1, Math.min(100, x * 100));
    var eases = [], i;
    if (spatial) {
      var len = 0;
      for (i = 0; i < d.length; i++) len += d[i] * d[i];
      eases.push(new KeyframeEase(slope * Math.sqrt(len) / dt, influence));
    } else {
      for (i = 0; i < d.length; i++) eases.push(new KeyframeEase(slope * d[i] / dt, influence));
    }
    return eases;
  }

  function flatEase(prop, spatial) {
    var n = spatial ? 1 : (prop.value instanceof Array ? prop.value.length : 1);
    var e = [];
    for (var i = 0; i < n; i++) e.push(new KeyframeEase(0, 33.33));
    return e;
  }

  // keys: [[time, value], ...]. Like a CSS animation, the curve applies to
  // each interval between keys, not to the whole run.
  function animate(prop, keys, bez) {
    var i, spatial = isSpatial(prop);
    for (i = 0; i < keys.length; i++) prop.setValueAtTime(keys[i][0], keys[i][1]);
    for (i = 0; i < keys.length; i++) {
      var k = prop.nearestKeyIndex(keys[i][0]);
      prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      var inE = i > 0 ? segmentEase(keys[i - 1], keys[i], bez, 'in', spatial) : flatEase(prop, spatial);
      var outE = i < keys.length - 1 ? segmentEase(keys[i], keys[i + 1], bez, 'out', spatial) : flatEase(prop, spatial);
      prop.setTemporalEaseAtKey(k, inE, outE);
      if (spatial) {
        // Straight moves only: no auto-bezier bow in the path.
        var zero = [];
        while (zero.length < prop.value.length) zero.push(0);
        prop.setSpatialTangentsAtKey(k, zero, zero);
      }
    }
  }

  function tr(layer, name) { return layer.property('ADBE Transform Group').property(name); }
  function pos(layer) { return tr(layer, 'ADBE Position'); }

  // @keyframes blurPop - out of focus and a little under size, through a
  // slight overshoot, to crisp:
  //   0% { opacity:0; filter:blur(18px); scale:.94 }
  //   55% { opacity:1 }   72% { filter:blur(0); scale:1.018 }   100% { scale:1 }
  // CSS blur() and AE's Blurriness do not measure the same thing; the
  // factor between them is set by comparing stills with the live page.
  var BLURRINESS_PER_CSS_PX = 1.0;
  function blurPop(layer, t0, dur) {
    animate(tr(layer, 'ADBE Opacity'), [[t0, 0], [t0 + 0.55 * dur, 100]], EASE.blurPop);
    var blur = layer.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');
    animate(blur.property('ADBE Gaussian Blur 2-0001'),
            [[t0, 18 * BLURRINESS_PER_CSS_PX], [t0 + 0.72 * dur, 0]], EASE.blurPop);
    animate(tr(layer, 'ADBE Scale'),
            [[t0, [94, 94, 100]], [t0 + 0.72 * dur, [101.8, 101.8, 100]], [t0 + dur, [100, 100, 100]]],
            EASE.blurPop);
  }

  // The case-study pattern: opacity and a short rise, which the CSS often
  // gives different curves.
  function rise(layer, t0, dy, posDur, posEase, opDur, opEase, opTo) {
    var p = pos(layer).value;
    animate(pos(layer), [[t0, [p[0], p[1] + dy]], [t0 + posDur, [p[0], p[1]]]], posEase);
    animate(tr(layer, 'ADBE Opacity'), [[t0, 0], [t0 + opDur, opTo === undefined ? 100 : opTo]], opEase);
  }

  // ----------------------------------------------------------------- fonts

  // Fallbacks for a machine without the site's fonts, so the build still
  // runs; the log lists what was missing.
  var FALLBACK = {
    'PlusJakartaSans-Regular': 'ArialMT', 'PlusJakartaSans-Medium': 'ArialMT',
    'PlusJakartaSans-SemiBold': 'Arial-BoldMT', 'PlusJakartaSans-Bold': 'Arial-BoldMT',
    'GeistMono-Regular': 'Consolas', 'GeistMono-Medium': 'Consolas'
  };
  var fontCache = {};
  function font(ps) {
    if (fontCache[ps]) return fontCache[ps];
    var have = true;
    try { have = app.fonts.getFontsByPostScriptName(ps).length > 0; } catch (e) {}
    if (!have) report.missingFonts.push(ps);
    fontCache[ps] = have ? ps : (FALLBACK[ps] || 'ArialMT');
    return fontCache[ps];
  }

  // ------------------------------------------------------------------ text

  // o: font, size, color, tracking (CSS em x 1000), just, leading, box
  //    [w, h], ranges [{start, end, font, color}]
  function text(comp, name, str, o) {
    var l = o.box ? comp.layers.addBoxText(o.box, str) : comp.layers.addText(str);
    l.name = name;
    var src = l.property('ADBE Text Properties').property('ADBE Text Document');
    var td = src.value;
    td.resetCharStyle();
    td.resetParagraphStyle();
    td.font = font(o.font);
    td.fontSize = o.size;
    td.applyFill = true;
    td.applyStroke = false;
    td.fillColor = o.color;
    td.tracking = o.tracking || 0;
    if (o.leading) { td.autoLeading = false; td.leading = o.leading; }
    td.justification = o.just || ParagraphJustification.LEFT_JUSTIFY;
    src.setValue(td);
    if (o.ranges) {
      try {
        td = src.value;
        for (var i = 0; i < o.ranges.length; i++) {
          var r = o.ranges[i], cr = td.characterRange(r.start, r.end);
          if (r.font) cr.font = font(r.font);
          if (r.color) cr.fillColor = r.color;
        }
        src.setValue(td);
      } catch (e) {
        warn(name + ': per-word styling needs AE 24.3+ (' + e + ')');
      }
    }
    return l;
  }

  function rect(l) { return l.sourceRectAtTime(0, false); }

  // Baselines of a box text layer, in its own coordinates.
  function baselines(l, size) {
    var out = [];
    try {
      var b = l.property('ADBE Text Properties').property('ADBE Text Document').value.baselineLocs;
      for (var i = 1; i < b.length; i += 4) out.push(b[i]);
    } catch (e) {}
    if (!out.length) {
      warn(l.name + ': no baselineLocs; line count estimated');
      out.push(rect(l).top + size * 0.92);
    }
    return out;
  }

  // Sets the anchor to a point in the layer's own space without moving it.
  function anchorAt(l, ax, ay) {
    var a = tr(l, 'ADBE Anchor Point').value, p = pos(l).value;
    tr(l, 'ADBE Anchor Point').setValue([ax, ay]);
    pos(l).setValue([p[0] + ax - a[0], p[1] + ay - a[1]]);
  }

  // ---------------------------------------------------------------- shapes

  function shapeLayer(comp, name, x, y) {
    var l = comp.layers.addShape();
    l.name = name;
    tr(l, 'ADBE Anchor Point').setValue([0, 0]);
    pos(l).setValue([x, y]);
    return l;
  }

  // Property references go stale once a sibling is added, so the group's
  // contents are looked up again for each addition.
  function contents(group) { return group.property('ADBE Vectors Group'); }

  function addGroup(l) { return l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); }

  function paint(group, o) {
    if (o.stroke) {
      var s = contents(group).addProperty('ADBE Vector Graphic - Stroke');
      s.property('ADBE Vector Stroke Color').setValue(o.stroke);
      s.property('ADBE Vector Stroke Width').setValue(o.strokeWidth || 1);
      s.property('ADBE Vector Stroke Opacity').setValue(o.strokeOpacity === undefined ? 100 : o.strokeOpacity);
      if (o.roundCap) s.property('ADBE Vector Stroke Line Cap').setValue(2);
    }
    if (o.fill) {
      var f = contents(group).addProperty('ADBE Vector Graphic - Fill');
      f.property('ADBE Vector Fill Color').setValue(o.fill);
      f.property('ADBE Vector Fill Opacity').setValue(o.fillOpacity === undefined ? 100 : o.fillOpacity);
    }
  }

  // A rectangle by its top-left corner, the way CSS boxes are measured.
  function box(comp, name, x, y, w, h, o) {
    var l = shapeLayer(comp, name, x + w / 2, y + h / 2);
    var g = addGroup(l);
    var r = contents(g).addProperty('ADBE Vector Shape - Rect');
    r.property('ADBE Vector Rect Size').setValue([w, h]);
    r.property('ADBE Vector Rect Roundness').setValue(o.radius || 0);
    paint(g, o);
    return l;
  }

  function ellipseShape(cx, cy, rx, ry) {
    var k = 0.5522847498, s = new Shape();
    s.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
    s.inTangents = [[-k * rx, 0], [0, -k * ry], [k * rx, 0], [0, k * ry]];
    s.outTangents = [[k * rx, 0], [0, k * ry], [-k * rx, 0], [0, -k * ry]];
    s.closed = true;
    return s;
  }

  // A CSS radial-gradient mask - opaque to one radius, clear by another -
  // as an elliptical mask whose feather spans the two.
  function radialMask(l, cx, cy, rx, ry, solidTo, clearAt) {
    var m = l.property('ADBE Mask Parade').addProperty('ADBE Mask Atom');
    var mid = (solidTo + clearAt) / 2, span = clearAt - solidTo;
    m.property('ADBE Mask Shape').setValue(ellipseShape(cx, cy, rx * mid, ry * mid));
    m.property('ADBE Mask Feather').setValue([rx * span, ry * span]);
    return m;
  }

  function dropShadow(l, color, opacity, distance, softness) {
    var fx = l.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
    fx.property('ADBE Drop Shadow-0001').setValue(color);
    fx.property('ADBE Drop Shadow-0002').setValue(opacity * 255);   // stored 0-255
    fx.property('ADBE Drop Shadow-0003').setValue(180);             // straight down
    fx.property('ADBE Drop Shadow-0004').setValue(distance);
    fx.property('ADBE Drop Shadow-0005').setValue(softness);
  }

  // Uses the layer directly above as the matte.
  function matteFromAbove(l, matte) {
    if (typeof l.setTrackMatte === 'function') l.setTrackMatte(matte, TrackMatteType.ALPHA);
    else l.trackMatteType = TrackMatteType.ALPHA;
  }

  // ---------------------------------------------------------------- project

  var folders = {};
  function comp(name, w, h, dur, folder) {
    var c = app.project.items.addComp(name, w, h, 1, dur, FPS);
    if (folder) c.parentFolder = folder;
    return c;
  }

  function writeLog() {
    var s = serialize(report);
    try {
      LOG_FILE.encoding = 'UTF-8';
      if (!LOG_FILE.open('w')) throw new Error('cannot open');
      LOG_FILE.write(s);
      LOG_FILE.close();
    } catch (e) {
      alert('Web motion build: could not write ' + LOG_FILE.fsName + '.\n\n' +
            'Turn on Edit > Preferences > Scripting & Expressions > ' +
            '"Allow Scripts to Write Files and Access Network", then run it again.\n\n' + s);
    }
  }

  function serialize(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    var parts = [], k;
    if (v instanceof Array) {
      for (k = 0; k < v.length; k++) parts.push(serialize(v[k]));
      return '[' + parts.join(',') + ']';
    }
    for (k in v) if (v.hasOwnProperty(k)) parts.push(serialize(k) + ':' + serialize(v[k]));
    return '{' + parts.join(',') + '}';
  }

  // Only ever builds into an empty project or into its own earlier output,
  // so whatever else is open in After Effects is left alone.
  function readyProject() {
    var p = app.project;
    if (p && p.file && p.file.fsName === PROJECT_FILE.fsName) {
      var dirty = true;
      try { dirty = p.dirty; } catch (e) {}
      if (dirty) return 'kgd-web-motion.aep is open with unsaved changes - save them under another name, or close it, then run again';
      p.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      app.newProject();
      return null;
    }
    if (!p || p.numItems > 0 || p.file) {
      return 'another project is open in After Effects - choose File > New > New Project (or close it), then run again';
    }
    return null;
  }

  // ============================================================ Home intro

  function buildHome() {
    var root = folders.precomps;
    var main = comp('Home - Hero Intro', W, H, 4, folders.root);

    // --- dot field: .hero::before ---
    var dots = comp('home / dot field', W, H, 4, root);
    var dl = shapeLayer(dots, 'dots 24px grid', 0, 0);
    var g = addGroup(dl);
    var e = contents(g).addProperty('ADBE Vector Shape - Ellipse');
    e.property('ADBE Vector Ellipse Size').setValue([2.2, 2.2]);
    e.property('ADBE Vector Ellipse Position').setValue([12, 12]);
    paint(g, { fill: C.ink, fillOpacity: 17 });           // --dot: rgba(19,19,22,.17)
    var r1 = contents(g).addProperty('ADBE Vector Filter - Repeater');
    r1.property('ADBE Vector Repeater Copies').setValue(Math.ceil(W / 24) + 1);
    r1.property('ADBE Vector Repeater Transform').property('ADBE Vector Repeater Position').setValue([24, 0]);
    var r2 = contents(g).addProperty('ADBE Vector Filter - Repeater');
    r2.property('ADBE Vector Repeater Copies').setValue(Math.ceil(H / 24) + 1);
    r2.property('ADBE Vector Repeater Transform').property('ADBE Vector Repeater Position').setValue([0, 24]);

    // --- portrait: .portrait, object-fit:cover at 52% 18% ---
    var pw = 406, ph = 508;
    var portrait = comp('home / portrait', pw, ph, 4, root);
    var img = portrait.layers.add(folders.photo);
    var s = ph / folders.photo.height;
    tr(img, 'ADBE Scale').setValue([s * 100, s * 100, 100]);
    var shownW = folders.photo.width * s;
    pos(img).setValue([(pw - shownW) * 0.52 + shownW / 2, ph / 2]);
    var pm = box(portrait, 'radius 8 (matte)', 0, 0, pw, ph, { fill: C.white, radius: 8 });
    matteFromAbove(img, pm);

    // --- card: .card, resting position (the cursor-follow is live-only) ---
    var cw = 422;
    var card = comp('home / intro card', cw, 260, 4, root);
    var cardBg = null; // added after the copy is measured, then sent behind
    text(card, 'h2 Hey, I\'m Kiran', 'Hey, I\'m Kiran',
         { font: 'PlusJakartaSans-Bold', size: 21, color: C.ink });
    pos(card.layer(1)).setValue([24, 44.6]);
    var copy = 'I design brand, web and product communication ' + DASH + ' currently at Workfabric AI in Bengaluru, ' +
               'working across websites, brand systems, packaging and motion.';
    var cp = text(card, 'p intro', copy, {
      font: 'PlusJakartaSans-Regular', size: 13.5, color: C.inkDim, leading: 21.6, box: [cw - 48, 200],
      ranges: [{ start: 9, end: 45, font: 'PlusJakartaSans-SemiBold', color: C.ink },
               { start: 61, end: 74, font: 'PlusJakartaSans-SemiBold', color: C.ink }]
    });
    var cb = baselines(cp, 13.5);
    pos(cp).setValue([pos(cp).value[0] + 24 - rect(cp).left, pos(cp).value[1] + 80.2 - cb[0]]);
    var rule = 64.5 + cb.length * 21.6 + 18;
    box(card, 'meta rule', 24, rule, cw - 48, 1, { fill: C.ink, fillOpacity: 12 });
    var m1 = text(card, 'meta Based', 'Based ' + DASH + ' BLR, IN',
                  { font: 'GeistMono-Regular', size: 11, color: C.inkDim, tracking: 60 });
    pos(m1).setValue([24, rule + 26]);
    var m2 = text(card, 'meta Workfabric AI', 'Workfabric AI',
                  { font: 'GeistMono-Regular', size: 11, color: C.inkDim, tracking: 60,
                    just: ParagraphJustification.RIGHT_JUSTIFY });
    pos(m2).setValue([cw - 24, rule + 26]);
    var ch = Math.round(rule + 51.3);
    card.height = ch;
    cardBg = box(card, 'glass panel', 0.5, 0.5, cw - 1, ch - 1,
                 { fill: C.white, fillOpacity: 86, stroke: C.ink, strokeOpacity: 12, radius: 4 });
    cardBg.moveToEnd();

    // --- top bar: .topbar ---
    var bar = comp('home / top bar', W, 94, 4, root);
    var cy = 46.8;
    var mark = text(bar, 'mark Kiran Goutam D', 'Kiran Goutam D',
                    { font: 'PlusJakartaSans-Medium', size: 15, color: C.ink, tracking: -12 });
    pos(mark).setValue([48, cy + 5.2]);
    // Right-hand group, laid out from the right edge with its 18px gaps.
    var right = W - 48;
    var cta = text(bar, 'cta Get in touch', 'Get in touch',
                   { font: 'PlusJakartaSans-Regular', size: 14, color: C.ink,
                     just: ParagraphJustification.CENTER_JUSTIFY });
    var ctaW = rect(cta).width + 38;
    pos(cta).setValue([right - ctaW / 2, cy + 4.9]);
    box(bar, 'cta pill', right - ctaW + 0.5, cy - 18.8 + 0.5, ctaW - 1, 36.6,
        { stroke: C.ink, strokeOpacity: 12, radius: 18.3 });
    right -= ctaW + 18;
    var proj = text(bar, 'link Projects', 'Projects', { font: 'PlusJakartaSans-Regular', size: 14, color: C.ink });
    var sup = text(bar, 'link Projects count', '13',
                   { font: 'PlusJakartaSans-Medium', size: 8.68, color: C.ink, tracking: 20 });
    tr(sup, 'ADBE Opacity').setValue(62);
    var projW = rect(proj).width + 1.56 + rect(sup).width;
    pos(proj).setValue([right - projW, cy + 2.9]);
    pos(sup).setValue([right - projW + rect(proj).width + 1.56, cy - 1.8]);
    box(bar, 'link Projects underline', right - projW, cy + 9.8, projW, 1, { fill: C.ink, fillOpacity: 12 });
    right -= projW + 18;
    var jour = text(bar, 'link Journey', 'Journey', { font: 'PlusJakartaSans-Regular', size: 14, color: C.ink });
    var jw = rect(jour).width;
    pos(jour).setValue([right - jw, cy + 2.9]);
    box(bar, 'link Journey underline', right - jw, cy + 9.8, jw, 1, { fill: C.ink, fillOpacity: 12 });
    right -= jw + 18;
    // Theme toggle: a 34px ring with the sun from the page's inline SVG,
    // drawn at 16px (viewBox 24, stroke 1.7).
    box(bar, 'theme toggle ring', right - 33.5, cy - 16.5, 33, 33, { stroke: C.ink, strokeOpacity: 12, radius: 16.5 });
    var sun = shapeLayer(bar, 'theme toggle sun', right - 17, cy);
    var sg = addGroup(sun);
    var disc = contents(sg).addProperty('ADBE Vector Shape - Ellipse');
    disc.property('ADBE Vector Ellipse Size').setValue([5.6, 5.6]);
    paint(sg, { stroke: C.ink, strokeWidth: 1.13 });
    var rg = addGroup(sun);
    var ray = contents(rg).addProperty('ADBE Vector Shape - Group');
    var rs = new Shape();
    rs.vertices = [[0, -4.8], [0, -6.4]]; rs.closed = false;
    ray.property('ADBE Vector Shape').setValue(rs);
    paint(rg, { stroke: C.ink, strokeWidth: 1.13, roundCap: true });
    var rr = contents(rg).addProperty('ADBE Vector Filter - Repeater');
    rr.property('ADBE Vector Repeater Copies').setValue(8);
    rr.property('ADBE Vector Repeater Transform').property('ADBE Vector Repeater Position').setValue([0, 0]);
    rr.property('ADBE Vector Repeater Transform').property('ADBE Vector Repeater Rotation').setValue(45);

    // ---------------- the main timeline, bottom of the stack first ----------------

    var paper = main.layers.addSolid(C.paper, 'paper', W, H, 1, 4);
    paper.locked = true;

    var dotsL = main.layers.add(dots);
    dotsL.name = 'dot field';
    // mask-image: radial-gradient(115% 85% at 50% 42%, #000 30%, transparent 76%)
    radialMask(dotsL, W * 0.5, H * 0.42, W * 1.15, H * 0.85, 0.30, 0.76);
    animate(tr(dotsL, 'ADBE Opacity'), [[0.05, 0], [1.55, 100]], EASE.ease);
    dotsL.comment = '.hero::before - dotsIn 1.5s ease .05s';

    // .portrait: right:var(--edge) 64px, top:13%, height 47svh, 4:5
    var portraitL = main.layers.add(portrait);
    portraitL.name = 'portrait';
    pos(portraitL).setValue([W - 64 - 406.08 / 2, H * 0.13 + 507.6 / 2]);
    portraitL.collapseTransformation = true;     // so the blur can spill past the frame
    dropShadow(portraitL, C.ink, 0.12, 30, 70);  // box-shadow 0 30px 70px rgba(19,19,22,.12)
    blurPop(portraitL, 0.18, 0.95);
    portraitL.comment = '.portrait - blurPop .95s cubic-bezier(.22,1,.3,1) delay .18s';

    // .nameblock: bottom 40px, two 168px lines at line-height .86, each
    // padded 48px in from a left edge 6px off the page.
    var lineH = 168 * 0.86, top = H - 40 - 2 * lineH, nameX = -6 + 48;
    var role = text(main, 'role tag', 'SENIOR GRAPHIC DESIGNER',
                    { font: 'GeistMono-Regular', size: 11.5, color: C.inkDim, tracking: 160 });
    pos(role).setValue([nameX, top - 4 - 14.4 / 2 + 4.0]);
    var rb = rect(role);
    anchorAt(role, rb.left + rb.width / 2, rb.top + rb.height / 2);   // transform-origin: center
    blurPop(role, 0.44, 0.8);
    role.comment = '.role-tag - blurPop .8s cubic-bezier(.22,1,.3,1) delay .44s';

    var names = [['Kiran', 0.54], ['Dhananjayan', 0.68]];
    for (var i = 0; i < names.length; i++) {
      var centre = top + lineH * (i + 0.5);
      var nl = text(main, 'name ' + names[i][0], names[i][0],
                    { font: 'PlusJakartaSans-Medium', size: 168, color: C.ink, tracking: -10 });
      pos(nl).setValue([nameX, centre + 168 * 0.35]);
      // transform-origin: 0% 50% of the line box, which starts at -6px.
      anchorAt(nl, -6 - nameX, centre - (centre + 168 * 0.35));
      blurPop(nl, names[i][1], 0.95);
      nl.comment = '.nameblock .line:nth-of-type(' + (i + 1) + ') - blurPop .95s delay ' + names[i][1] + 's';
    }

    // .card: left clamp(..7vw..) 104px, top clamp(..24vh..) 232px
    var cardL = main.layers.add(card);
    cardL.name = 'intro card';
    pos(cardL).setValue([104 + cw / 2, 232 + ch / 2]);
    cardL.collapseTransformation = true;
    dropShadow(cardL, C.ink, 0.08, 18, 40);      // box-shadow 0 18px 40px rgba(19,19,22,.08)
    blurPop(cardL, 1.02, 0.95);
    cardL.comment = '.card - blurPop .95s cubic-bezier(.22,1,.3,1) delay 1.02s (resting position; it follows the cursor on the live page)';

    var barL = main.layers.add(bar);
    barL.name = 'top bar';
    pos(barL).setValue([W / 2, 47]);
    // @keyframes fadeDown { from { opacity:0; translateY(-8px) } }, .7s ease .15s
    rise(barL, 0.15, -8, 0.7, EASE.ease, 0.7, EASE.ease);
    barL.comment = '.topbar - fadeDown .7s ease delay .15s';

    step('Home - Hero Intro: ' + main.numLayers + ' layers, card ' + ch + 'px tall, ' + cb.length + ' lines of card copy');
    return main;
  }

  // ===================================================== Case study hero

  function buildCaseStudy() {
    var dur = 8;
    var main = comp('Case Study - Hero Reveal', W, H, dur, folders.root);

    // .hero { background: var(--deep) } under a 162deg sheen,
    // white 10% at the top to black 12% at the foot.
    var bg = main.layers.addSolid(C.deep, 'hero background', W, H, 1, dur);
    var ramp = bg.property('ADBE Effect Parade').addProperty('ADBE Ramp');
    ramp.property('ADBE Ramp-0001').setValue([710, -230]);
    ramp.property('ADBE Ramp-0002').setValue(hex('#2c2c2c'));
    ramp.property('ADBE Ramp-0003').setValue([1210, 1310]);
    ramp.property('ADBE Ramp-0004').setValue(hex('#121212'));
    bg.locked = true;

    // .hero::after - inset:-30% -15% auto, height 160%, so 130% x 160% of
    // the hero; radial-gradient(52% 52% at 72% 18%, white .11 -> 0 at 70%).
    var gw = W * 1.3, gh = H * 1.6;
    var glow = main.layers.addSolid(C.white, 'light drift', Math.round(gw), Math.round(gh), 1, dur);
    pos(glow).setValue([W / 2, H / 2]);
    radialMask(glow, gw * 0.72, gh * 0.18, gw * 0.52, gh * 0.52, 0, 0.70);
    animate(tr(glow, 'ADBE Opacity'), [[0.3, 0], [2.1, 11]], EASE.ease);
    // kgdDrift 24s ease-in-out infinite alternate: translate(-5%,-2%) to
    // (5%,3%) of its own box, there and back, forever.
    pos(glow).expression =
      'var T = 24, c = (Math.max(time, 0) % (2 * T)) / T;\n' +
      'if (c > 1) c = 2 - c;\n' +
      'ease(c, 0, 1, [' + (W / 2 - 0.05 * gw) + ', ' + (H / 2 - 0.02 * gh) + '], [' +
      (W / 2 + 0.05 * gw) + ', ' + (H / 2 + 0.03 * gh) + ']);';
    glow.comment = '.hero::after - opacity 1.8s ease .3s, then kgdDrift 24s ease-in-out infinite alternate (expression)';

    // The hero's contents, stacked as the page stacks them inside .wrap
    // (1160px, centred), and centred in the frame.
    var y = 355;

    var eb = text(main, 'eyebrow', 'BRANDING & STRATEGY / SELECTED WORK',
                  { font: 'GeistMono-Medium', size: 11, color: C.eyebrow, tracking: 100,
                    just: ParagraphJustification.CENTER_JUSTIFY });
    pos(eb).setValue([W / 2, y + 14]);
    rise(eb, 0, 14, 0.7, EASE.kgdEase, 0.7, EASE.kgdEase);
    eb.comment = '.hero .eyebrow - opacity + translateY(14px) .7s var(--kgd-ease)';
    y += 20 + 18;

    // h1: each line is an overflow:hidden .ln with the text in an <i>
    // that starts translateY(110%) below it. A precomp the size of the .ln
    // does the clipping.
    var fs = 86, lh = fs * 0.86, lnH = Math.ceil(lh + 0.08 * fs);
    var line = comp('case study / title line', W, lnH, dur, folders.precomps);
    var t = text(line, 'h1 Forum by ReGo', 'Forum by ReGo', {
      font: 'PlusJakartaSans-Medium', size: fs, color: C.heroInk, tracking: -10,
      just: ParagraphJustification.CENTER_JUSTIFY,
      ranges: [{ start: 6, end: 13, color: C.rego }]                 // h1 em
    });
    var base = lh / 2 + fs * 0.35;
    pos(t).setValue([W / 2, base]);
    animate(pos(t), [[0.08, [W / 2, base + 1.1 * lh]], [1.08, [W / 2, base]]], EASE.kgdOut);
    t.comment = '.hero h1 .ln > i - translateY(110%) to none, 1s var(--kgd-out), delay --d*90ms + 80ms';
    var lineL = main.layers.add(line);
    lineL.name = 'title (clipped line)';
    pos(lineL).setValue([W / 2, y + lnH / 2]);
    y += lh + 22;

    var lede = 'Forum by ReGo is a platform that brings multi-disciplinary creatives into a single space, ' +
               'allowing individuals to showcase their work and create an opportunity to interact with the community.';
    var p = text(main, 'p', lede, {
      font: 'PlusJakartaSans-Regular', size: 20, color: C.heroCopy, leading: 30, box: [820, 200],
      just: ParagraphJustification.CENTER_JUSTIFY,
      ranges: [{ start: 0, end: 13, font: 'PlusJakartaSans-SemiBold', color: C.white }]   // p strong
    });
    var pb = baselines(p, 20);
    pos(p).setValue([pos(p).value[0] + (W - 820) / 2 - rect(p).left, pos(p).value[1] + y + 22 - pb[0]]);
    rise(p, 0.34, 18, 0.8, EASE.kgdEase, 0.8, EASE.kgdEase);
    p.comment = '.hero p - opacity + translateY(18px) .8s var(--kgd-ease) .34s';
    y += pb.length * 30 + 24;

    // .tag chips, centred with 8px gaps, each 45ms behind the last.
    var tags = ['MARKETING STRATEGY', 'MOTION GRAPHICS', 'BRANDING', 'SOCIAL MEDIA STRATEGY'];
    var chipH = 27.8, chips = [], total = -8, i;
    for (i = 0; i < tags.length; i++) {
      var tl = text(main, 'tag ' + tags[i].toLowerCase(), tags[i],
                    { font: 'GeistMono-Medium', size: 11, color: C.heroCopy, tracking: 80,
                      just: ParagraphJustification.CENTER_JUSTIFY });
      var w = rect(tl).width + 26;
      chips.push([tl, w]);
      total += w + 8;
    }
    var x = W / 2 - total / 2;
    for (i = 0; i < chips.length; i++) {
      var cl = chips[i][0], cwid = chips[i][1];
      pos(cl).setValue([x + cwid / 2, y + chipH / 2 + 3.9]);
      var pill = box(main, 'tag pill ' + (i + 1), x + 0.5, y + 0.5, cwid - 1, chipH - 1,
                     { stroke: C.heroInk, strokeOpacity: 30, radius: chipH / 2 });
      var d = 0.45 + 0.045 * i;
      rise(cl, d, 10, 0.55, EASE.kgdEase, 0.55, EASE.ease);
      rise(pill, d, 10, 0.55, EASE.kgdEase, 0.55, EASE.ease);
      cl.comment = pill.comment = '.hero .tag (--d:' + i + ') - opacity .55s ease, translateY(10px) .55s var(--kgd-ease), delay ' + d + 's';
      x += cwid + 8;
    }
    y += chipH + 34;

    // .meta-row: a rule, then three centred columns across the 1160 measure.
    box(main, 'meta-row rule', (W - 1160) / 2, y, 1160, 1, { fill: C.heroInk, fillOpacity: 24 });
    var metas = [['CLIENT', 'ReGo'], ['ROLE', 'Brand strategist, in a team of four'], ['FORMAT', '18-page strategy document']];
    var colW = (1160 - 2 * 22) / 3;
    for (i = 0; i < metas.length; i++) {
      var mx = (W - 1160) / 2 + i * (colW + 22) + colW / 2;
      var ml = text(main, 'meta ' + metas[i][0].toLowerCase() + ' label', metas[i][0],
                    { font: 'GeistMono-Medium', size: 11, color: C.heroInk, tracking: 100,
                      just: ParagraphJustification.CENTER_JUSTIFY });
      pos(ml).setValue([mx, y + 34]);
      var mv = text(main, 'meta ' + metas[i][0].toLowerCase() + ' value', metas[i][1],
                    { font: 'PlusJakartaSans-SemiBold', size: 14, color: C.white, tracking: -20,
                      just: ParagraphJustification.CENTER_JUSTIFY });
      pos(mv).setValue([mx, y + 58]);
      var md = 0.56 + 0.07 * i;
      rise(ml, md, 12, 0.6, EASE.kgdEase, 0.6, EASE.ease, 66);   // rgba(246,243,241,.66)
      rise(mv, md, 12, 0.6, EASE.kgdEase, 0.6, EASE.ease);
      ml.comment = mv.comment = '.hero .meta (--d:' + i + ') - opacity .6s ease, translateY(12px) .6s var(--kgd-ease), delay ' + md + 's';
    }

    step('Case Study - Hero Reveal: ' + main.numLayers + ' layers, ' + pb.length + ' lines of copy');
    return main;
  }

  // --------------------------------------------------------------- frames

  // Stills for checking the build against the live page.
  function frames(c, slug, times) {
    var saved = [];
    if (typeof c.saveFrameToPng !== 'function') { warn('saveFrameToPng unavailable; no stills'); return saved; }
    var dir = new Folder(OUT + '/frames');
    if (!dir.exists) dir.create();
    for (var i = 0; i < times.length; i++) {
      var f = new File(dir.fsName + '/' + slug + '-' + Math.round(times[i] * 1000) + 'ms.png');
      try { c.saveFrameToPng(times[i], f); saved.push(f.name); } catch (e) { warn('still ' + f.name + ': ' + e); }
    }
    return saved;
  }

  // ------------------------------------------------------------------ run

  var blocked = null;
  try { blocked = readyProject(); } catch (e) { blocked = 'could not check the open project: ' + e; }
  if (blocked) {
    report.blocked = blocked;
    writeLog();
    return;
  }

  app.beginUndoGroup('Build web motion comps');
  try {
    {
      var outDir = new Folder(OUT);
      if (!outDir.exists) outDir.create();
      folders.root = app.project.items.addFolder('KGD Web Motion');
      folders.precomps = app.project.items.addFolder('precomps');
      folders.precomps.parentFolder = folders.root;
      var footage = app.project.items.addFolder('footage');
      footage.parentFolder = folders.root;
      folders.photo = app.project.importFile(new ImportOptions(new File(SITE + '/assets/portrait-kiran.jpg')));
      folders.photo.parentFolder = footage;

      var home = buildHome();
      var cs = buildCaseStudy();
      app.project.save(PROJECT_FILE);
      step('saved ' + PROJECT_FILE.fsName);
      home.openInViewer();

      report.stills = frames(home, 'home', [0.3, 0.6, 0.9, 1.2, 1.5, 2.2])
        .concat(frames(cs, 'case', [0.15, 0.4, 0.7, 1.2, 2.5]));
      report.ok = true;
    }
  } catch (err) {
    report.error = String(err) + (err.line ? ' (line ' + err.line + ')' : '');
  }
  app.endUndoGroup();
  writeLog();
})();
