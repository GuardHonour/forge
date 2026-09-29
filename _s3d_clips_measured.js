/* _s3d_clips_measured.js — the measured clip set, assembled.

   Each clip lives in its own file (_s3d_clip_<name>.js) and registers itself onto S3D.CLIPS, so one
   failing clip cannot take the others down. This module only collects them.

   TWO SHAPES, AND WHY THEY DIFFER
   Each clip file records what it knows in the natural place for it:
       S3D.MEASURED[name] = { targets: {...}, source: '...', licence: '...' }
   The app, however, asks for provenance through S3D_MEASURED.TARGETS[name].source (see provenance()
   in _s3d_app.js) — it reads TARGETS as the per-clip record rather than as a bag of numbers. Rather
   than force one of the two writers to adopt the other's shape, this module flattens them: the clip's
   own measured numbers stay available, and `source`/`licence` are lifted to the top of the record so
   the app finds them. A missing or malformed clip is skipped and REPORTED, never silently dropped —
   S3D_MEASURED.skip says exactly which ones did not arrive, and the app can print that instead of
   quietly showing a 3D view with no attribution.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    /* Load each clip defensively: a partial set is still a working set. */
    var core = require('./_s3d_core.js');
    var names = ['squat', 'press', 'legext', 'machinepress'];
    var loaded = [], missing = [];
    names.forEach(function (n) {
      try { require('./_s3d_clip_' + n + '.js'); loaded.push(n); }
      catch (e) { missing.push(n + ': ' + (e && e.message || e)); }
    });
    var api = factory(core);
    api.loaded = loaded; api.missing = missing;
    module.exports = api;
  } else {
    root.S3D_MEASURED = factory(root.S3D);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';

  var NAMES = ['squat', 'press', 'legext', 'machinepress'];
  var TARGETS = {}, present = [], skip = [];

  NAMES.forEach(function (n) {
    var clip = S3D.CLIPS && S3D.CLIPS[n];
    var rec = (S3D.MEASURED && S3D.MEASURED[n]) || null;
    if (!clip) { skip.push(n + ' (no clip registered)'); return; }
    if (!rec) { skip.push(n + ' (a clip of this name exists but records no measured targets)'); return; }
    present.push(n);
    /* Flatten: keep the measured numbers, lift source/licence to the top where the app reads them. */
    var flat = { source: rec.source || rec.title || '', licence: rec.licence || '' };
    var src = rec.targets || rec;
    Object.keys(src).forEach(function (k) {
      if (k === 'source' || k === 'licence' || k === 'title') return;
      if (flat[k] === undefined) flat[k] = src[k];
    });
    TARGETS[n] = flat;
  });

  /* The clips the app may show, in a stable order. */
  return {
    TARGETS: TARGETS,
    CLIPS: present,
    /* Anything expected but absent, with the reason. Read this rather than assuming a full set. */
    skip: skip,
    /* The app's phase HUD is derived from its own 3140 ms clock, so every measured clip must carry
       exactly that duration or the label would name the wrong phase. Re-checked here because it is
       the one defect that is invisible in a numeric angle table. `present.length` is part of the
       condition on purpose: Array.prototype.every returns true for an empty array, so without it an
       empty set would report itself phase-aligned. */
    phaseAligned: present.length > 0 && present.every(function (n) { return Math.abs(S3D.CLIPS[n].duration - 3.14) < 1e-6; })
  };
});
