/* ─────────────────────────────────────────────────────
   PHOTOREALISTIC EARTH TEXTURE
   Uses a CORS-enabled NASA Blue Marble equirectangular
   image from Wikimedia Commons and renders it to a sphere
   via per-pixel inverse projection on an offscreen canvas.
───────────────────────────────────────────────────────── */
const EARTH_TEXTURE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/WorldMap-A_non-Frame.png/2048px-WorldMap-A_non-Frame.png";
const EARTH_NIGHTLIGHTS_FALLBACK =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/512px-The_Earth_seen_from_Apollo_17.jpg";

const EarthTexture = (() => {
  let _img = null, _imgData = null, _texW = 0, _texH = 0, _state = "idle";
  const listeners = [];

  function load() {
    if (_state !== "idle") return;
    _state = "loading";
    const tryLoad = (url, next) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const off = document.createElement("canvas");
          off.width = img.naturalWidth;
          off.height = img.naturalHeight;
          const octx = off.getContext("2d", { willReadFrequently: true });
          octx.drawImage(img, 0, 0);
          _imgData = octx.getImageData(0, 0, off.width, off.height);
          _texW = off.width;
          _texH = off.height;
          _img = img;
          _state = "ready";
          listeners.forEach(fn => fn());
        } catch (e) {
          if (next) tryLoad(next, null);
          else _state = "failed";
        }
      };
      img.onerror = () => {
        if (next) tryLoad(next, null);
        else _state = "failed";
      };
      img.src = url;
    };
    tryLoad(EARTH_TEXTURE_URL, EARTH_NIGHTLIGHTS_FALLBACK);
  }

  // Cache rendered spheres so we don't re-raycast every frame.
  // Key: R (rounded) + tilt * 10 rounded. We regenerate the sphere when rot
  // has drifted by > 0.015 rad (~0.86°) — imperceptible otherwise.
  const sphereCache = new Map();
  function getSphereCanvas(R, tilt) {
    const key = R + ":" + Math.round(tilt * 100);
    let entry = sphereCache.get(key);
    if (!entry) {
      const c = document.createElement("canvas");
      c.width = R * 2; c.height = R * 2;
      entry = { canvas: c, ctx: c.getContext("2d"), lastRot: Infinity };
      sphereCache.set(key, entry);
    }
    return entry;
  }

  function renderSphereTo(targetCtx, R, rot, tilt) {
    if (_state !== "ready") return false;
    const diam = R * 2;
    const out = targetCtx.createImageData(diam, diam);
    const data = out.data;
    const texData = _imgData.data;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    // Light direction (sun). Tweaked to give a nice day/night terminator.
    const lx = -0.42, ly = -0.28, lz = 0.86;
    for (let py = 0; py < diam; py++) {
      const dy = py - R;
      for (let px = 0; px < diam; px++) {
        const dx = px - R;
        const d2 = dx * dx + dy * dy;
        const idx = (py * diam + px) * 4;
        if (d2 > R * R) {
          data[idx + 3] = 0;
          continue;
        }
        const nx = dx / R;
        const ny = dy / R;
        const nz = Math.sqrt(1 - nx * nx - ny * ny);
        const ty = ny * cosT - nz * sinT;
        const tz = ny * sinT + nz * cosT;
        const lon = Math.atan2(nx, tz) + rot;
        const lat = Math.asin(Math.max(-1, Math.min(1, ty)));
        let u = (lon / (2 * Math.PI)) % 1;
        if (u < 0) u += 1;
        const v = 0.5 - lat / Math.PI;
        const tx = Math.min(_texW - 1, (u * _texW) | 0);
        const tyi = Math.min(_texH - 1, Math.max(0, (v * _texH) | 0));
        const tIdx = (tyi * _texW + tx) * 4;
        let lambert = nx * lx + ty * ly + tz * lz;
        lambert = Math.max(0.08, Math.min(1, lambert * 0.9 + 0.35));
        const rim = Math.pow(1 - nz, 3) * 0.25;
        data[idx]     = Math.min(255, texData[tIdx] * lambert + rim * 120);
        data[idx + 1] = Math.min(255, texData[tIdx + 1] * lambert + rim * 150);
        data[idx + 2] = Math.min(255, texData[tIdx + 2] * lambert + rim * 220);
        data[idx + 3] = 255;
      }
    }
    return out;
  }

  return {
    load,
    isReady: () => _state === "ready",
    onReady: (fn) => { if (_state === "ready") fn(); else listeners.push(fn); },
    /**
     * Draw the Earth sphere at (cx,cy) with radius R, with rotation+tilt.
     * Cached: re-raycasts only when rotation drifts more than ~0.015 rad.
     */
    drawSphere(ctx, cx, cy, R, rot, tilt = 0.4) {
      if (_state !== "ready") return false;
      // Cap render size for very large spheres (perf)
      const renderR = Math.min(R, 360);
      const entry = getSphereCanvas(renderR, tilt);
      if (Math.abs(entry.lastRot - rot) > 0.015 || entry.lastRot === Infinity) {
        const img = renderSphereTo(entry.ctx, renderR, rot, tilt);
        entry.ctx.clearRect(0, 0, renderR * 2, renderR * 2);
        entry.ctx.putImageData(img, 0, 0);
        entry.lastRot = rot;
      }
      ctx.drawImage(entry.canvas, cx - R, cy - R, R * 2, R * 2);
      return true;
    }
  };
})();

// Kick off texture load immediately
EarthTexture.load();

/* ─────────────────────────────────────────────────────
   LUNE PROCÉDURALE — rendu par raycasting sans texture
   Cratères + mares + ombrage Lambert + rim argenté
───────────────────────────────────────────────────── */
const MoonRenderer = (() => {
  // Générateur pseudo-aléatoire seeded (reproductible)
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0xffffffff; };
  }
  const r = rng(137);

  // Mares lunaires (zones sombres)
  const MARE = Array.from({length: 7}, () => [
    (r() - 0.5) * Math.PI * 1.8,   // lon
    (r() - 0.5) * Math.PI * 0.6,   // lat (sin)
    0.14 + r() * 0.18,              // rayon angulaire
  ]);

  // Cratères : [lon, lat_sin, rayon, profondeur]
  const CRATERS = Array.from({length: 38}, () => [
    (r() - 0.5) * Math.PI * 2,
    (r() - 0.5) * 0.9,
    0.015 + r() * 0.085,
    0.45 + r() * 0.45,
  ]);

  const cache = new Map();

  function renderR(R, rot) {
    const diam = R * 2;
    const buf  = new Uint8ClampedArray(diam * diam * 4);
    const lx = -0.28, ly = -0.18, lz = 0.94;  // lumière frontale + haut-gauche

    for (let py = 0; py < diam; py++) {
      const dy = (py - R) / R;
      for (let px = 0; px < diam; px++) {
        const dx = (px - R) / R;
        const d2 = dx * dx + dy * dy;
        const base = (py * diam + px) * 4;
        if (d2 > 1) { buf[base + 3] = 0; continue; }

        const nz = Math.sqrt(1 - d2);
        const lon = Math.atan2(dx, nz) + rot;

        // Lambert
        let lam = dx * lx + dy * ly + nz * lz;
        lam = Math.max(0.04, Math.min(1, lam * 0.86 + 0.26));

        // Terrain de base
        let lum = 0.68
          + Math.sin(lon * 19 + dy * 13) * 0.04
          + Math.cos(lon * 7  - dy * 9 ) * 0.03
          + Math.sin(lon * 41 + dy * 37) * 0.012;

        // Mares
        for (const [mLon, mLat, mR] of MARE) {
          const dLon = Math.sin(lon - mLon);
          const dLat = dy - mLat;
          const dist = Math.sqrt(dLon * dLon + dLat * dLat);
          if (dist < mR) {
            const blend = Math.pow(1 - dist / mR, 1.4);
            lum *= (1 - blend * 0.44);
          }
        }

        // Cratères
        for (const [cLon, cLat, cR, depth] of CRATERS) {
          const dLon = Math.sin(lon - cLon);
          const dLat = dy - cLat;
          const dist = Math.sqrt(dLon * dLon + dLat * dLat);
          if (dist < cR * 1.35) {
            const t0 = dist / cR;
            if (t0 < 0.65) {
              lum *= 0.48 + t0 * depth;          // fond sombre
            } else if (t0 < 1.0) {
              const rimT = (t0 - 0.65) / 0.35;
              lum += (1 - lum) * (1 - rimT) * 0.32; // rebord clair
            }
          }
        }

        // Rim subtle (exosphère quasi nulle)
        const rim = Math.pow(1 - nz, 5) * 0.07;
        const v = Math.min(1, lum * lam + rim);

        buf[base]     = v * 245;          // légèrement chaud
        buf[base + 1] = v * 245;
        buf[base + 2] = v * 255;          // légèrement froid/bleu
        buf[base + 3] = 255;
      }
    }
    return buf;
  }

  return {
    drawSphere(ctx, cx, cy, R, rot) {
      const rR = Math.min(R, 320);
      const key = `${rR}:${Math.round(rot * 10)}`;  // recalcule tous les ~6°
      let entry = cache.get(key);
      if (!entry) {
        const buf = renderR(rR, rot);
        const id  = new ImageData(new Uint8ClampedArray(buf), rR * 2, rR * 2);
        const off = document.createElement("canvas");
        off.width = rR * 2; off.height = rR * 2;
        off.getContext("2d").putImageData(id, 0, 0);
        entry = off;
        if (cache.size > 64) cache.delete(cache.keys().next().value);
        cache.set(key, entry);
      }
      ctx.drawImage(entry, cx - R, cy - R, R * 2, R * 2);
    }
  };
})();

const TOTAL_STEPS = 11;

// Named mission phases — one per step
const MISSION_PHASES = [
  { code: "PRE-FLT",  name: "Pre-flight check",    station: "Diagnostic objectif" },
  { code: "T-10",     name: "Lecture systèmes",    station: "Analyse existant" },
  { code: "T-5",      name: "Configuration",       station: "Type de mission" },
  { code: "T-0",      name: "Ignition",            station: "Architecture" },
  { code: "MECO",     name: "Stage 1 cutoff",      station: "Direction visuelle" },
  { code: "BOOST",    name: "Boost phase",         station: "Palette couleurs" },
  { code: "SEP",      name: "Stage separation",    station: "Priorités" },
  { code: "COAST",    name: "Coast phase",         station: "Ressources" },
  { code: "ORB INJ",  name: "Orbit injection",     station: "Attentes" },
  { code: "DEPLOY",   name: "Satellite deploy",    station: "Calendrier" },
  { code: "COMM",     name: "Uplink established",  station: "Contact" },
];

const LS_KEY = "astr_proto_state";
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "progressStyle": "timeline",
  "transition": "wipe",
  "cardStyle": "hud",
  "metaphorIntensity": "balanced"
}/*EDITMODE-END*/;

const state = {
  screen: "intro",       // intro | form | confirm
  step: 1,
  answers: {},
  files: [],
  tweaks: { ...TWEAK_DEFAULTS },
};

/* ── Persistence ──────────────────────────────────── */
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      screen: state.screen, step: state.step, answers: state.answers, tweaks: state.tweaks,
    }));
  } catch (e) {}
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.screen) state.screen = s.screen;
    if (s.step) state.step = s.step;
    if (s.answers) state.answers = s.answers;
    if (s.tweaks) state.tweaks = { ...TWEAK_DEFAULTS, ...s.tweaks };
  } catch (e) {}
}

/* ── DOM helpers ──────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── Screen navigation ────────────────────────────── */
function showScreen(name) {
  state.screen = name;
  $$(".screen").forEach(s => s.classList.toggle("is-active", s.dataset.screen === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "form") setTimeout(() => initJourneyCanvases(), 50);
  if (name === "confirm") setTimeout(() => initConfirmOrbit(), 50);
  saveState();
}

/* ── Step navigation ──────────────────────────────── */
function showStep(n, direction = "forward") {
  if (n < 1) n = 1;
  if (n > TOTAL_STEPS) { submitForm(); return; }
  state.step = n;
  const ratio = (n - 1) / (TOTAL_STEPS - 1);
  document.documentElement.style.setProperty("--progress-ratio", ratio);
  document.documentElement.style.setProperty("--step-index", n);

  // Show the correct step
  $$(".step").forEach(el => {
    const isActive = +el.dataset.step === n;
    el.hidden = !isActive;
    if (isActive) {
      el.classList.remove("is-entering-fade", "is-entering-wipe", "is-entering-warp");
      void el.offsetWidth;
      el.classList.add(`is-entering-${state.tweaks.transition}`);
    }
  });

  // Update progress numbers
  $("#step-num").textContent = String(n).padStart(2, "0");
  $("#progress-pct").textContent = Math.round(ratio * 100) + "%";
  const phase = MISSION_PHASES[n - 1];
  const phaseEl = $("#phase-label");
  if (phaseEl) phaseEl.innerHTML = `<strong>${phase.code}</strong> · ${phase.name}`;

  // Update progress nodes
  $$(".progress-node").forEach((node, i) => {
    node.classList.remove("done", "current");
    if (i + 1 < n) node.classList.add("done");
    else if (i + 1 === n) node.classList.add("current");
  });

  // Nav buttons
  const isLast = n === TOTAL_STEPS;
  const isFirst = n === 1;
  $("#btn-back").hidden = isFirst;
  $("#btn-next").hidden = isLast;
  $("#btn-submit").hidden = !isLast;

  // Telemetry in left panel
  updateJourneyTelemetry();
  saveState();
}

/* ── Validation ───────────────────────────────────── */
function validateStep(n) {
  const stepEl = $(`[data-step="${n}"]`);
  const err = stepEl.querySelector(".step-error");
  if (err) err.hidden = true;

  // Radio groups (steps 1,2,3,5,6,10)
  const radioGroups = [1,2,3,5,6,10];
  if (radioGroups.includes(n)) {
    const name = `q${n}`;
    const picked = stepEl.querySelector(`input[type="radio"]:checked`);
    if (!picked) { if (err) { err.hidden = false; err.textContent = "⚠ Veuillez sélectionner une réponse."; } return false; }
  }
  // Multi-checkbox (4, 7)
  if (n === 4 || n === 7) {
    const picked = stepEl.querySelectorAll(`input[type="checkbox"]:checked`);
    if (!picked.length) { if (err) { err.hidden = false; err.textContent = "⚠ Sélectionnez au moins une option."; } return false; }
  }
  // Step 9 — textarea
  if (n === 9) {
    const val = ($("#q9_expectations").value || "").trim();
    if (val.length < 6) { if (err) { err.hidden = false; err.textContent = "⚠ Merci de détailler vos attentes (min 6 caractères)."; } return false; }
  }
  // Step 11 — coords
  if (n === 11) {
    const required = ["company_name", "contact_name", "contact_email"];
    for (const id of required) {
      const v = ($("#" + id).value || "").trim();
      if (!v) { if (err) { err.hidden = false; err.textContent = "⚠ Nom entreprise, nom contact et email obligatoires."; } return false; }
    }
    const email = $("#contact_email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (err) { err.hidden = false; err.textContent = "⚠ Email invalide."; } return false; }
    if (!$("#rgpd").checked) { if (err) { err.hidden = false; err.textContent = "⚠ Merci d'accepter la clause RGPD."; } return false; }
  }
  return true;
}

function collectAnswers() {
  const a = {};
  // Radios
  for (const n of [1,2,3,5,6,10]) {
    const picked = document.querySelector(`[data-step="${n}"] input[type="radio"]:checked`);
    if (picked) a[`q${n}`] = picked.value;
  }
  // Multi
  for (const n of [4,7]) {
    const picked = document.querySelectorAll(`[data-step="${n}"] input[type="checkbox"]:checked`);
    a[`q${n}`] = [...picked].map(p => p.value);
  }
  a.q8 = [...document.querySelectorAll(`[data-step="8"] input[name="q8_assets"]:checked`)].map(p => p.value);
  a.q9 = $("#q9_expectations").value.trim();
  a.company_name = $("#company_name").value.trim();
  a.contact_name = $("#contact_name").value.trim();
  a.contact_email = $("#contact_email").value.trim();
  a.contact_phone = $("#contact_phone").value.trim();
  a.current_website = $("#current_website").value.trim();
  state.answers = a;
  return a;
}

/* ── Submission ───────────────────────────────────── */
async function submitForm() {
  if (!validateStep(TOTAL_STEPS)) return;
  const a = collectAnswers();

  const btn = $("#btn-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Transmission en cours…"; }

  const fd = new FormData();

  // Map short field names to backend-expected long names
  fd.append("q1_objective",      a.q1  || "");
  fd.append("q2_existing_site",  a.q2  || "");
  fd.append("q3_site_type",      a.q3  || "");
  fd.append("q5_style",          a.q5  || "");
  fd.append("q6_colors",         a.q6  || "");
  fd.append("q9_expectations",   a.q9  || "");
  fd.append("q10_readiness",     a.q10 || "");

  // Multi-value fields
  (a.q4 || []).forEach(v => fd.append("q4_pages", v));
  (a.q7 || []).forEach(v => fd.append("q7_priorities", v));
  (a.q8 || []).forEach(v => fd.append("q8_assets", v));

  // Optional conditional extras from DOM
  const q1Other  = ($("#q1_other")?.value   || "").trim();
  const q2Url    = ($("#q2_url")?.value     || "").trim();
  const q3Cmt    = ($("#q3_comment")?.value || "").trim();
  const q5Desc   = ($("#q5_desc")?.value    || "").trim();
  const q6Det    = ($("#q6_details")?.value || "").trim();
  if (q1Other) fd.append("q1_objective_other", q1Other);
  if (q2Url)   fd.append("q2_existing_url",    q2Url);
  if (q3Cmt)   fd.append("q3_site_type_comment", q3Cmt);
  if (q5Desc)  fd.append("q5_style_description", q5Desc);
  if (q6Det)   fd.append("q6_colors_details",  q6Det);

  // Contact fields (same names as backend)
  fd.append("company_name",   a.company_name   || "");
  fd.append("contact_name",   a.contact_name   || "");
  fd.append("contact_email",  a.contact_email  || "");
  fd.append("contact_phone",  a.contact_phone  || "");
  fd.append("current_website", a.current_website || "");

  // Anti-spam
  fd.append("website_url", $("#website_url")?.value || "");
  fd.append("_load_time",  $("#_load_time")?.value  || "");

  // Files
  state.files.forEach(f => fd.append("files", f, f.name));

  try {
    const res = await fetch("/api/submit", { method: "POST", body: fd });
    const result = await res.json();
    if (result.success) {
      renderBoardingPass(a);
      showScreen("confirm");
      saveState();
    } else {
      const err = document.querySelector(`[data-step="${TOTAL_STEPS}"] .step-error`);
      if (err) { err.hidden = false; err.textContent = "⚠ " + (result.error || "Une erreur est survenue."); }
      if (btn) { btn.disabled = false; btn.innerHTML = 'Transmettre la mission <span class="btn-arrow">→</span>'; }
    }
  } catch (e) {
    const err = document.querySelector(`[data-step="${TOTAL_STEPS}"] .step-error`);
    if (err) { err.hidden = false; err.textContent = "⚠ Impossible d'envoyer. Vérifiez votre connexion."; }
    if (btn) { btn.disabled = false; btn.innerHTML = 'Transmettre la mission <span class="btn-arrow">→</span>'; }
  }
}

/* ── Boarding pass render ─────────────────────────── */
function renderBoardingPass(a) {
  const ref = "ASTR-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  $("#boarding-ref").textContent = ref;
  $("#boarding-passenger").textContent = (a.contact_name || "—").toUpperCase();
  $("#boarding-company").textContent = a.company_name || "—";
  $("#boarding-date").textContent = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  $("#boarding-class").textContent = (a.q5 || "Premium").toUpperCase().split(" ")[0];

  const summary = $("#boarding-summary-list");
  summary.innerHTML = "";
  const items = [
    ["Objectif",  a.q1],
    ["Type",      a.q3],
    ["Style",     a.q5],
    ["Couleurs",  a.q6],
    ["Calendrier", a.q10],
  ];
  items.forEach(([k, v]) => {
    if (!v) return;
    const li = document.createElement("li");
    li.className = "boarding-summary-item";
    li.innerHTML = `<span><strong>${k}</strong> — ${v}</span>`;
    summary.appendChild(li);
  });
}

/* ── Canvas: intro — LUNE procédurale ─────────────── */
function initConsoleEarth() {
  const canvas = $("#console-earth-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H, cx, cy, R;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    R  = Math.floor(Math.min(W, H) * 0.48);
  }
  resize();
  window.addEventListener("resize", resize);

  const stars = Array.from({length: 80}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.3 + 0.3,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);

    // Étoiles scintillantes
    stars.forEach(s => {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.025 + s.tw));
      ctx.fillStyle = "#dde8ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Halo argenté (pas d'atmosphère sur la Lune — très subtil)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.45);
    halo.addColorStop(0,   "rgba(210,220,255,0.28)");
    halo.addColorStop(0.4, "rgba(180,195,255,0.10)");
    halo.addColorStop(1,   "rgba(150,170,240,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2); ctx.fill();

    // Lune procédurale (MoonRenderer)
    MoonRenderer.drawSphere(ctx, cx, cy, R, t * 0.003);

    // Rim argenté
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rim = ctx.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.05);
    rim.addColorStop(0,   "rgba(220,230,255,0)");
    rim.addColorStop(0.55,"rgba(220,230,255,0.32)");
    rim.addColorStop(1,   "rgba(220,230,255,0)");
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Canvas: LEFT — Fusée 3 phases premium ─────────── */
let leftCanvasState = null;
function initJourneyLeftCanvas() {
  const canvas = $("#journey-left-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  leftCanvasState = { resize };
  window.addEventListener("resize", resize);

  const stars = Array.from({length: 130}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.4 + 0.3,
    sp: Math.random() * 0.25 + 0.08,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--progress-ratio")) || 0;

    // ── Phases (0→0.30 LANCEMENT · 0.30→0.72 ASCENSION · 0.72→1 ORBITE)
    const p1 = Math.min(1, ratio / 0.30);
    const p2 = Math.min(1, Math.max(0, (ratio - 0.30) / 0.42));
    const p3 = Math.min(1, Math.max(0, (ratio - 0.72) / 0.28));
    const phaseName  = p3 > 0 ? "MISE EN ORBITE" : p2 > 0 ? "ASCENSION" : "LANCEMENT";
    const phaseColor = p3 > 0 ? "#a6ff6b"  : p2 > 0 ? "#5ce3ff" : "#ffb547";

    // ── Ciel — s'assombrit vers l'espace avec ratio
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    const bTop = Math.round(3 + ratio * 2);
    skyGrad.addColorStop(0, `rgb(${bTop},${bTop+4},${bTop+17})`);
    skyGrad.addColorStop(0.6, `rgba(5,11,${Math.round(35 + (1-ratio)*45)},0.8)`);
    skyGrad.addColorStop(1,   `rgba(10,${Math.round(20+(1-ratio)*30)},${Math.round(60+(1-ratio)*80)},0.5)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Étoiles (apparaissent à mesure qu'on monte)
    stars.forEach(s => {
      const y = ((s.y * H) + t * s.sp) % H;
      ctx.globalAlpha = ratio * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.035 + s.tw)));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath(); ctx.arc(s.x * W, y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ── Terre photoréaliste (bas du panneau)
    const earthR  = Math.floor(W * 1.2);
    const earthCy = H + earthR * 0.72;

    const atmA = Math.max(0.1, 0.55 - ratio * 0.28);
    const atmHalo = ctx.createRadialGradient(W/2, earthCy, earthR*0.92, W/2, earthCy, earthR*1.16);
    atmHalo.addColorStop(0,   `rgba(92,170,255,${atmA})`);
    atmHalo.addColorStop(0.5, `rgba(79,157,255,${atmA*0.35})`);
    atmHalo.addColorStop(1,   "rgba(79,157,255,0)");
    ctx.fillStyle = atmHalo;
    ctx.beginPath(); ctx.arc(W/2, earthCy, earthR*1.16, 0, Math.PI*2); ctx.fill();

    const drewEarth = EarthTexture.drawSphere(ctx, W/2, earthCy, earthR, t*0.0003, 0.32);
    if (!drewEarth) {
      const eg = ctx.createRadialGradient(W*0.35, H-40, earthR*0.05, W/2, earthCy, earthR);
      eg.addColorStop(0, "#5ea6ff"); eg.addColorStop(0.5, "#2e7af8"); eg.addColorStop(1, "#0a1e4a");
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(W/2, earthCy, earthR, 0, Math.PI*2); ctx.fill();
    }
    ctx.save(); ctx.globalCompositeOperation = "screen";
    const rimE = ctx.createRadialGradient(W/2, earthCy, earthR*0.96, W/2, earthCy, earthR*1.04);
    rimE.addColorStop(0, "rgba(140,200,255,0)");
    rimE.addColorStop(0.5, `rgba(140,200,255,${0.28-ratio*0.12})`);
    rimE.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = rimE;
    ctx.beginPath(); ctx.arc(W/2, earthCy, earthR*1.04, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // ── Plateforme de lancement (phase 1 seulement)
    if (p2 < 0.15) {
      const padA = Math.max(0, 1 - p2 * 7);
      const padY = H - 50;
      ctx.globalAlpha = padA;
      ctx.fillStyle = "#506080";
      ctx.fillRect(W/2 - 22, padY, 44, 5);
      ctx.fillRect(W/2 - 3, padY - 28, 6, 28);
      ctx.fillStyle = "#384060";
      ctx.fillRect(W/2 - 18, padY + 5, 36, 8);
      ctx.globalAlpha = 1;
    }

    // ── Nuage de fumée (lancement)
    if (p1 > 0 && p2 < 0.4) {
      const smokeA = Math.min(p1, 1 - p2/0.4) * 0.28;
      for (let i = 0; i < 6; i++) {
        const sr = 14 + i * 9 + p1 * 8;
        const sx = W/2 + Math.sin(i * 2.3 + t * 0.02) * 9;
        const sy = H - 56 + i * 5 + Math.cos(i * 1.8) * 5;
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        sg.addColorStop(0, `rgba(190,210,240,${smokeA})`);
        sg.addColorStop(1, "rgba(100,130,200,0)");
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
      }
    }

    // ── Trajet de vapeur (trail pointillé)
    if (ratio > 0.06) {
      const trailTop = H - 58 - ratio * (H - 140);
      ctx.save();
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const tr = i / 22;
        const ty = H - 58 - tr * ratio * (H - 140);
        if (ty < trailTop - 2) break;
        ctx.strokeStyle = `rgba(160,210,255,${(1-i/22)*ratio*0.35})`;
        ctx.beginPath(); ctx.moveTo(W/2, ty); ctx.lineTo(W/2, ty - 3); ctx.stroke();
      }
      ctx.restore();
    }

    // ── Fusée — position + inclinaison gravity turn
    const rocketY = H - 58 - ratio * (H - 140);
    const rocketX = W/2 + Math.sin(t * 0.022) * 2.5;
    const tilt    = p3 * 0.28;   // bascule vers horizontal en phase 3
    const flameI  = Math.max(0.1, 1 - p3 * 0.75);
    const flameL  = (22 + Math.sin(t * 0.38) * 5) * flameI + (1-ratio) * 14;

    ctx.save();
    ctx.translate(rocketX, rocketY);
    ctx.rotate(tilt);

    // Flamme extérieure
    const fg = ctx.createLinearGradient(0, 32, 0, 32 + flameL);
    fg.addColorStop(0,   `rgba(255,195,90,${0.96*flameI})`);
    fg.addColorStop(0.35,`rgba(255,110,50,${0.72*flameI})`);
    fg.addColorStop(1,   "rgba(255,50,20,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-11, 32);
    ctx.quadraticCurveTo(0, 32 + flameL, 11, 32);
    ctx.closePath(); ctx.fill();

    // Flamme centrale (noyau blanc)
    const fc = ctx.createLinearGradient(0, 32, 0, 32 + flameL * 0.52);
    fc.addColorStop(0, `rgba(255,255,255,${flameI})`);
    fc.addColorStop(1, "rgba(255,210,120,0)");
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.moveTo(-5, 32); ctx.quadraticCurveTo(0, 32 + flameL*0.52, 5, 32);
    ctx.closePath(); ctx.fill();

    // Corps fusée (12px large, 46px haut)
    const bg = ctx.createLinearGradient(-12, 0, 12, 0);
    bg.addColorStop(0,   "#c8d8f4");
    bg.addColorStop(0.35,"#f4f8ff");
    bg.addColorStop(0.65,"#e4eeff");
    bg.addColorStop(1,   "#86aedc");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-12, 32); ctx.lineTo(-12, -10);
    ctx.quadraticCurveTo(-12, -40, 0, -40);
    ctx.quadraticCurveTo( 12, -40, 12, -10);
    ctx.lineTo(12, 32); ctx.closePath(); ctx.fill();

    // Reflet cone
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.beginPath();
    ctx.moveTo(-3, -10); ctx.quadraticCurveTo(-5, -34, 0, -40);
    ctx.quadraticCurveTo(-1, -28, -3, -10); ctx.closePath(); ctx.fill();

    // Hublot
    const wg = ctx.createRadialGradient(-1.5, -9, 0.5, 0, -9, 5.5);
    wg.addColorStop(0, "#cce4ff"); wg.addColorStop(0.5, "#2574F0"); wg.addColorStop(1, "#081840");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.arc(0, -9, 5.5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(180,220,255,0.55)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(0, -9, 5.5, 0, Math.PI*2); ctx.stroke();

    // Ailettes
    const fg2 = ctx.createLinearGradient(-22, 18, 0, 12);
    fg2.addColorStop(0, "#5882c0"); fg2.addColorStop(1, "#82aad8");
    ctx.fillStyle = fg2;
    ctx.beginPath(); ctx.moveTo(-12,32); ctx.lineTo(-24,46); ctx.lineTo(-12,18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo( 12,32); ctx.lineTo( 24,46); ctx.lineTo( 12,18); ctx.closePath(); ctx.fill();

    // Bandes structurelles
    ctx.strokeStyle = "rgba(140,180,240,0.55)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-11, 8); ctx.lineTo(11, 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11,18); ctx.lineTo(11,18); ctx.stroke();

    ctx.restore();

    // ── HUD — coin supérieur droit
    const mono = "'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = phaseColor;
    ctx.font = `700 9px ${mono}`;
    ctx.fillText(phaseName, W - 11, 20);

    ctx.fillStyle = "rgba(205,225,255,0.55)";
    ctx.font = `500 9px ${mono}`;
    ctx.fillText(`ALT  ${String(Math.round(ratio*408)).padStart(3,"0")} KM`, W - 11, 33);
    ctx.fillText(`VEL  ${(7.66 + ratio*0.84).toFixed(2)} KM/S`, W - 11, 46);

    // ── Barre de phase (bas)
    const bX = 11, bW = W - 22, bY = H - 18;
    ctx.strokeStyle = "rgba(100,160,255,0.18)";
    ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(bX + bW, bY); ctx.stroke();

    const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
    barG.addColorStop(0,    "#ffb547");
    barG.addColorStop(0.295,"#ffb547");
    barG.addColorStop(0.305,"#5ce3ff");
    barG.addColorStop(0.715,"#5ce3ff");
    barG.addColorStop(0.725,"#a6ff6b");
    barG.addColorStop(1,    "#a6ff6b");
    ctx.strokeStyle = barG;
    ctx.lineWidth = 2;
    ctx.shadowColor = phaseColor; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(bX + bW * ratio, bY); ctx.stroke();
    ctx.shadowBlur = 0;

    [0.30, 0.72].forEach(m => {
      const mx = bX + bW * m;
      ctx.strokeStyle = `rgba(160,200,255,${ratio >= m ? 0.9 : 0.28})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, bY-5); ctx.lineTo(mx, bY+5); ctx.stroke();
    });

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Canvas: RIGHT — Satellite 3 phases premium ─────────── */
function initJourneyRightCanvas() {
  const canvas = $("#journey-right-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const stars = Array.from({length: 130}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.4 + 0.3,
    sp: Math.random() * 0.25 + 0.08,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--progress-ratio")) || 0;

    // ── Phases (0→0.30 TRANSIT · 0.30→0.72 DÉPLOIEMENT · 0.72→1 OPÉRATIONNEL)
    const p1 = Math.min(1, ratio / 0.30);
    const p2 = Math.min(1, Math.max(0, (ratio - 0.30) / 0.42));
    const p3 = Math.min(1, Math.max(0, (ratio - 0.72) / 0.28));
    const phaseName  = p3 > 0 ? "OPÉRATIONNEL" : p2 > 0 ? "DÉPLOIEMENT" : "TRANSIT";
    const phaseColor = p3 > 0 ? "#a6ff6b"       : p2 > 0 ? "#5ce3ff"     : "#ffb547";

    // ── Ciel (identique au panneau gauche)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    const bTop = Math.round(3 + ratio * 2);
    skyGrad.addColorStop(0,   `rgb(${bTop},${bTop+4},${bTop+17})`);
    skyGrad.addColorStop(0.6, `rgba(5,11,${Math.round(35+(1-ratio)*45)},0.8)`);
    skyGrad.addColorStop(1,   `rgba(10,${Math.round(20+(1-ratio)*30)},${Math.round(60+(1-ratio)*80)},0.5)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Étoiles (apparaissent avec ratio)
    stars.forEach(s => {
      const y = ((s.y * H) + t * s.sp) % H;
      ctx.globalAlpha = ratio * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.035 + s.tw)));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath(); ctx.arc(s.x * W, y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ── Terre photoréaliste (bas-gauche)
    const earthR  = Math.floor(W * 0.8);
    const earthCx = W * 0.2;
    const earthCy = H + 40;

    const atmA = Math.max(0.1, 0.55 - ratio * 0.28);
    const atmHalo = ctx.createRadialGradient(earthCx, earthCy, earthR*0.92, earthCx, earthCy, earthR*1.16);
    atmHalo.addColorStop(0,   `rgba(92,170,255,${atmA})`);
    atmHalo.addColorStop(0.5, `rgba(79,157,255,${atmA*0.35})`);
    atmHalo.addColorStop(1,   "rgba(79,157,255,0)");
    ctx.fillStyle = atmHalo;
    ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR*1.16, 0, Math.PI*2); ctx.fill();

    const drewEarth = EarthTexture.drawSphere(ctx, earthCx, earthCy, earthR, t*0.0003, 0.32);
    if (!drewEarth) {
      const eg = ctx.createRadialGradient(earthCx-earthR*0.3, earthCy-earthR*0.3, earthR*0.05, earthCx, earthCy, earthR);
      eg.addColorStop(0, "#5ea6ff"); eg.addColorStop(0.5, "#2e7af8"); eg.addColorStop(1, "#0a1e4a");
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR, 0, Math.PI*2); ctx.fill();
    }
    ctx.save(); ctx.globalCompositeOperation = "screen";
    const rimE = ctx.createRadialGradient(earthCx, earthCy, earthR*0.96, earthCx, earthCy, earthR*1.04);
    rimE.addColorStop(0, "rgba(140,200,255,0)");
    rimE.addColorStop(0.5, `rgba(140,200,255,${0.28-ratio*0.12})`);
    rimE.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = rimE;
    ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR*1.04, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // ── Anneau orbital (apparaît avec p1)
    const orbitR = earthR + 55;
    ctx.strokeStyle = `rgba(120,190,255,${0.12 + p1 * 0.28})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    ctx.beginPath(); ctx.arc(earthCx, earthCy, orbitR, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);

    // ── Position satellite
    const parkAngle = -Math.PI * 0.42;
    const orbitParkX = earthCx + Math.cos(parkAngle) * orbitR;
    const orbitParkY = earthCy + Math.sin(parkAngle) * orbitR;

    let satX, satY, satBodyAngle;
    if (ratio < 0.30) {
      // Phase 1 TRANSIT: approche depuis haut-droit vers orbite (ease-out)
      const ease = 1 - Math.pow(1 - p1, 2);
      satX = W + 32 + (orbitParkX - W - 32) * ease;
      satY = -38 + (orbitParkY + 38) * ease;
      satBodyAngle = parkAngle + Math.PI * 0.5;
    } else {
      // Phases 2+3: dérive lente le long de l'anneau
      const drift = (ratio - 0.30) * 0.12;
      const curAngle = parkAngle + drift;
      satX = earthCx + Math.cos(curAngle) * orbitR;
      satY = earthCy + Math.sin(curAngle) * orbitR;
      satBodyAngle = curAngle + Math.PI * 0.5;
    }

    // ── Traînée de transit (phase 1)
    if (p1 > 0.05 && p1 < 0.97) {
      for (let i = 1; i <= 10; i++) {
        const frac = i * 0.09;
        const ep = Math.max(0, p1 - frac);
        const ease2 = 1 - Math.pow(1 - ep, 2);
        const tx2 = W + 32 + (orbitParkX - W - 32) * ease2;
        const ty2 = -38 + (orbitParkY + 38) * ease2;
        ctx.globalAlpha = (1 - frac) * 0.45 * p1 * (1 - p1) * 3.2;
        ctx.fillStyle = "#ffb547";
        ctx.beginPath(); ctx.arc(tx2, ty2, 1.8 * (1 - frac * 0.5), 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ── Satellite
    ctx.save();
    ctx.translate(satX, satY);
    ctx.rotate(satBodyAngle);

    const panelSpan = 44 * p2;
    const panelH = 13;

    // Aura phase 3
    if (p3 > 0) {
      const glowR = 52 + p3 * 22;
      const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, glowR);
      glow.addColorStop(0, `rgba(166,255,107,${p3*0.22})`);
      glow.addColorStop(1, "rgba(166,255,107,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI*2); ctx.fill();
    }

    // Panneaux solaires gauche
    if (panelSpan > 1) {
      const pg = ctx.createLinearGradient(-panelSpan - 14, 0, -14, 0);
      pg.addColorStop(0, "#1a4fa0"); pg.addColorStop(0.5, "#2574F0"); pg.addColorStop(1, "#3a80e0");
      ctx.fillStyle = pg;
      ctx.fillRect(-panelSpan - 14, -panelH/2, panelSpan, panelH);
      ctx.strokeStyle = "rgba(150,200,255,0.35)"; ctx.lineWidth = 0.6;
      for (let i = 0; i <= 5; i++) {
        const px2 = -panelSpan - 14 + i * (panelSpan / 5);
        ctx.beginPath(); ctx.moveTo(px2, -panelH/2); ctx.lineTo(px2, panelH/2); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-panelSpan-14, 0); ctx.lineTo(-14, 0); ctx.stroke();
      ctx.fillStyle = `rgba(180,220,255,${0.14*p2})`;
      ctx.fillRect(-panelSpan-14, -panelH/2, panelSpan, panelH*0.35);
    }

    // Panneaux solaires droite
    if (panelSpan > 1) {
      const pg2 = ctx.createLinearGradient(14, 0, 14 + panelSpan, 0);
      pg2.addColorStop(0, "#3a80e0"); pg2.addColorStop(0.5, "#2574F0"); pg2.addColorStop(1, "#1a4fa0");
      ctx.fillStyle = pg2;
      ctx.fillRect(14, -panelH/2, panelSpan, panelH);
      ctx.strokeStyle = "rgba(150,200,255,0.35)"; ctx.lineWidth = 0.6;
      for (let i = 0; i <= 5; i++) {
        const px2 = 14 + i * (panelSpan / 5);
        ctx.beginPath(); ctx.moveTo(px2, -panelH/2); ctx.lineTo(px2, panelH/2); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(14 + panelSpan, 0); ctx.stroke();
      ctx.fillStyle = `rgba(180,220,255,${0.14*p2})`;
      ctx.fillRect(14, -panelH/2, panelSpan, panelH*0.35);
    }

    // Corps satellite
    const bodyW = 20, bodyH = 28;
    const bodG = ctx.createLinearGradient(-bodyW/2, 0, bodyW/2, 0);
    bodG.addColorStop(0,   "#8aaecc"); bodG.addColorStop(0.3,  "#dceeff");
    bodG.addColorStop(0.65,"#c8e0f4"); bodG.addColorStop(1,   "#6890b0");
    ctx.fillStyle = bodG;
    ctx.beginPath(); ctx.roundRect(-bodyW/2, -bodyH/2, bodyW, bodyH, 3); ctx.fill();

    // Bord lumineux de phase (pulse doux)
    ctx.strokeStyle = phaseColor; ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.55 + Math.sin(t * 0.08) * 0.22;
    ctx.beginPath(); ctx.roundRect(-bodyW/2, -bodyH/2, bodyW, bodyH, 3); ctx.stroke();
    ctx.globalAlpha = 1;

    // Détails structuraux corps
    ctx.strokeStyle = "rgba(140,180,220,0.4)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-bodyW/2+2, -bodyH/2+7); ctx.lineTo(bodyW/2-2, -bodyH/2+7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-bodyW/2+2,  bodyH/2-9); ctx.lineTo(bodyW/2-2,  bodyH/2-9); ctx.stroke();

    // Antenne parabolique (se déploie avec p2)
    if (p2 > 0.05) {
      const dishY = -bodyH/2 - 8;
      const dishW = 10 * p2;
      ctx.strokeStyle = "#cde4ff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -bodyH/2); ctx.lineTo(0, dishY); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-dishW, dishY);
      ctx.quadraticCurveTo(0, dishY + 7 * p2, dishW, dishY);
      ctx.strokeStyle = "#8fc8ff"; ctx.lineWidth = 1.3;
      ctx.stroke();
      if (p2 > 0.7) {
        ctx.fillStyle = phaseColor;
        ctx.globalAlpha = p2 * 0.85;
        ctx.beginPath(); ctx.arc(0, dishY + 2.5 * p2, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();

    // ── Impulsions signal (phase 3)
    if (p3 > 0) {
      for (let i = 0; i < 3; i++) {
        const tOff = (t * 1.1 + i * 28) % 80;
        const pulseA = Math.max(0, 1 - tOff / 80) * p3 * 0.75;
        if (pulseA < 0.01) continue;
        ctx.strokeStyle = `rgba(166,255,107,${pulseA})`;
        ctx.lineWidth = 1.5 * (1 - tOff / 80);
        ctx.beginPath(); ctx.arc(satX, satY, tOff, 0, Math.PI*2); ctx.stroke();
      }
    }

    // ── HUD — coin supérieur GAUCHE (miroir du panneau gauche)
    const mono = "'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = phaseColor;
    ctx.font = `700 9px ${mono}`;
    ctx.fillText(phaseName, 11, 20);

    ctx.fillStyle = "rgba(205,225,255,0.55)";
    ctx.font = `500 9px ${mono}`;
    ctx.fillText(`ORB  ${String(Math.round(ratio*408)).padStart(3,"0")} KM`, 11, 33);
    ctx.fillText(`SIG  ${String(Math.round(ratio*100)).padStart(3," ")} %`,  11, 46);

    // ── Barre de phase (bas) — identique panneau gauche
    const bX = 11, bW = W - 22, bY = H - 18;
    ctx.strokeStyle = "rgba(100,160,255,0.18)";
    ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(bX + bW, bY); ctx.stroke();

    const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
    barG.addColorStop(0,     "#ffb547");
    barG.addColorStop(0.295, "#ffb547");
    barG.addColorStop(0.305, "#5ce3ff");
    barG.addColorStop(0.715, "#5ce3ff");
    barG.addColorStop(0.725, "#a6ff6b");
    barG.addColorStop(1,     "#a6ff6b");
    ctx.strokeStyle = barG;
    ctx.lineWidth = 2;
    ctx.shadowColor = phaseColor; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(bX + bW * ratio, bY); ctx.stroke();
    ctx.shadowBlur = 0;

    [0.30, 0.72].forEach(m => {
      const mx = bX + bW * m;
      ctx.strokeStyle = `rgba(160,200,255,${ratio >= m ? 0.9 : 0.28})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, bY-5); ctx.lineTo(mx, bY+5); ctx.stroke();
    });

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

let journeyCanvasesInitialized = false;
function initJourneyCanvases() {
  if (journeyCanvasesInitialized) return;
  journeyCanvasesInitialized = true;
  initJourneyLeftCanvas();
  initJourneyRightCanvas();
}

function updateJourneyTelemetry() {
  const r = (state.step - 1) / (TOTAL_STEPS - 1);
  const altEl = $("#telemetry-alt");
  const velEl = $("#telemetry-vel");
  const phsEl = $("#telemetry-phase");
  const txEl  = $("#telemetry-tx");
  if (altEl) altEl.textContent = String(Math.round(r * 408)).padStart(3, "0") + " KM";
  if (velEl) velEl.textContent = (7.66 + r * 0.1).toFixed(2) + " KM/S";
  const phase = MISSION_PHASES[state.step - 1];
  if (phsEl) phsEl.textContent = phase.code;
  if (txEl) txEl.textContent = Math.round(r * 100) + "%";
}

/* ── Confirm orbit canvas ─────────────────────────── */
function initConfirmOrbit() {
  const canvas = $("#confirm-orbit-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const stars = Array.from({length: 120}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.3 + 0.3,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    // bg
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(3,7,20,0)");
    g.addColorStop(1, "rgba(8,16,40,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    stars.forEach(s => {
      ctx.globalAlpha = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.03 + s.tw));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Earth bottom-center
    const ex = W / 2;
    const ey = H + 60;
    const er = W * 0.55;
    const eGrad = ctx.createRadialGradient(ex - er * 0.25, ey - er * 0.25, er * 0.1, ex, ey, er);
    eGrad.addColorStop(0, "#7ab4ff");
    eGrad.addColorStop(0.5, "#2e7af8");
    eGrad.addColorStop(1, "#0a1e4a");
    ctx.fillStyle = eGrad;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();

    // Orbit ring
    const or = er + 40;
    ctx.strokeStyle = "rgba(92,227,255,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(ex, ey, or, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Multiple satellites orbiting
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI * 0.4 + i * 0.6 + t * 0.005;
      const sx = ex + Math.cos(ang) * or;
      const sy = ey + Math.sin(ang) * or;
      const isMain = i === 1;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang + Math.PI / 2);
      // panels
      ctx.fillStyle = "#2574F0";
      ctx.fillRect(-24, -4, 12, 8);
      ctx.fillRect(12, -4, 12, 8);
      // body
      ctx.fillStyle = isMain ? "#a6ff6b" : "#e8f4ff";
      ctx.fillRect(-7, -5, 14, 10);
      ctx.fillStyle = "#02061a";
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();

      // signal
      if (isMain) {
        const pr = ((t * 0.6) % 60);
        ctx.strokeStyle = `rgba(166,255,107,${Math.max(0, 1 - pr / 60) * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, pr, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle = "rgba(166,255,107,0.9)";
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("MISSION DEPLOYED · ORBIT STABLE", W / 2, 24);

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Space background canvas ──────────────────────── */
function initSpaceCanvas() {
  const canvas = $("#space-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const stars = Array.from({length: 160}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.2 + 0.2,
    tw: Math.random() * Math.PI * 2,
    sp: Math.random() * 0.05 + 0.01,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    stars.forEach(s => {
      ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Progress rendering (builds the nodes based on style) ─── */
function renderProgress() {
  const wrap = $("#progress-track");
  if (!wrap) return;
  wrap.innerHTML = "";
  const style = state.tweaks.progressStyle;
  document.querySelector(".progress-wrap").setAttribute("data-progress", style);

  if (style === "timeline") {
    wrap.innerHTML = `
      <div class="progress-rail"></div>
      <div class="progress-fill"></div>
      <div class="progress-nodes">
        ${MISSION_PHASES.map((p, i) => `<div class="progress-node" data-idx="${i + 1}" title="${p.name}">${String(i + 1).padStart(2,'0')}</div>`).join("")}
      </div>
    `;
  } else if (style === "altitude") {
    wrap.innerHTML = `
      <div class="progress-earth">🌍</div>
      <div class="progress-trail">
        <div class="progress-rail"></div>
        <div class="progress-fill"></div>
        <div class="progress-rocket">🚀</div>
      </div>
      <div class="progress-orbit">🛰</div>
    `;
  } else if (style === "phases") {
    wrap.innerHTML = `
      <div class="progress-rail"></div>
      <div class="progress-fill"></div>
      <div class="progress-nodes">
        ${MISSION_PHASES.map((p, i) => `<div class="progress-node" data-idx="${i + 1}" title="${p.name}"></div>`).join("")}
      </div>
      <div class="progress-phase-label" id="phase-label"></div>
    `;
  }
  // Refresh current/done state + phase label
  showStep(state.step);
}

/* ── Tweaks panel ─────────────────────────────────── */
function renderTweaks() {
  const panel = $("#tweaks-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="tweaks-head">
      <span class="tweaks-title">Tweaks</span>
      <button class="tweaks-close" id="tweaks-close">×</button>
    </div>

    <div class="tweak">
      <span class="tweak-label">Progress bar</span>
      <div class="tweak-options" data-tweak="progressStyle">
        <button class="tweak-btn" data-v="timeline">Timeline 11 nodes</button>
        <button class="tweak-btn" data-v="altitude">Altitude HUD</button>
        <button class="tweak-btn" data-v="phases">Mission phases</button>
      </div>
    </div>

    <div class="tweak">
      <span class="tweak-label">Step transition</span>
      <div class="tweak-options" data-tweak="transition">
        <button class="tweak-btn" data-v="fade">Fade up</button>
        <button class="tweak-btn" data-v="wipe">Wipe</button>
        <button class="tweak-btn" data-v="warp">Warp zoom</button>
      </div>
    </div>

    <div class="tweak">
      <span class="tweak-label">Choice card style</span>
      <div class="tweak-options" data-tweak="cardStyle">
        <button class="tweak-btn" data-v="hud">HUD (default)</button>
        <button class="tweak-btn" data-v="minimal">Minimal</button>
      </div>
    </div>

    <div class="tweak">
      <span class="tweak-label">Métaphore</span>
      <div class="tweak-options" data-tweak="metaphorIntensity">
        <button class="tweak-btn" data-v="subtle">Subtile</button>
        <button class="tweak-btn" data-v="balanced">Équilibrée</button>
        <button class="tweak-btn" data-v="full">Full mission</button>
      </div>
    </div>
  `;

  // Mark actives
  $$("#tweaks-panel .tweak-btn").forEach(btn => {
    const key = btn.closest(".tweak-options").dataset.tweak;
    btn.classList.toggle("active", state.tweaks[key] === btn.dataset.v);
    btn.addEventListener("click", () => {
      state.tweaks[key] = btn.dataset.v;
      applyTweaks();
      renderTweaks();
      postTweaksToHost();
    });
  });
  $("#tweaks-close").addEventListener("click", () => panel.classList.remove("open"));
}

function applyTweaks() {
  document.body.setAttribute("data-card-style", state.tweaks.cardStyle);
  document.body.setAttribute("data-metaphor", state.tweaks.metaphorIntensity);
  renderProgress();
  saveState();
}

function postTweaksToHost() {
  try {
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: state.tweaks }, "*");
  } catch (e) {}
}

/* ── Conditional field logic ──────────────────────── */
function wireConditionalFields() {
  // Triggers (data-triggers on inputs)
  $$('input[data-triggers]').forEach(input => {
    input.addEventListener("change", () => {
      const target = document.getElementById(input.dataset.triggers);
      if (!target) return;
      // uncheck siblings may need to close — for radio in same step
      const stepEl = input.closest(".step");
      if (input.type === "radio" && input.checked) {
        target.classList.add("open");
        stepEl.querySelectorAll("[data-triggers]").forEach(sib => {
          if (sib !== input) {
            const sibTarget = document.getElementById(sib.dataset.triggers);
            if (sibTarget && sibTarget !== target) sibTarget.classList.remove("open");
          }
        });
      }
      if (input.type === "checkbox") {
        target.classList.toggle("open", input.checked);
      }
    });
  });
  // Close conditionals when other non-triggering radios in same step are picked
  $$('.choice input[type="radio"]').forEach(r => {
    r.addEventListener("change", () => {
      const stepEl = r.closest(".step");
      if (!stepEl) return;
      stepEl.querySelectorAll(".conditional").forEach(c => {
        const triggers = stepEl.querySelectorAll(`input[data-triggers="${c.id}"]`);
        const anyChecked = [...triggers].some(t => t.checked);
        c.classList.toggle("open", anyChecked);
      });
    });
  });
}

/* ── Choice click feedback ────────────────────────── */
function wireChoiceClicks() {
  $$(".choice").forEach(choice => {
    choice.addEventListener("click", (e) => {
      const input = choice.querySelector("input");
      if (!input) return;
      // Burst particle
      choice.classList.remove("burst");
      void choice.offsetWidth;
      choice.classList.add("burst");
      setTimeout(() => choice.classList.remove("burst"), 700);
      // Toggle selected class
      if (input.type === "radio") {
        const name = input.name;
        $$(`input[name="${name}"]`).forEach(i => {
          const c = i.closest(".choice");
          if (c) c.classList.remove("is-selected");
        });
        choice.classList.add("is-selected");
      } else {
        setTimeout(() => {
          choice.classList.toggle("is-selected", input.checked);
        }, 0);
      }
    });
    // Initial sync
    const input = choice.querySelector("input");
    if (input && input.checked) choice.classList.add("is-selected");
  });
}

/* ── Keyboard nav ─────────────────────────────────── */
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (state.screen !== "form") return;
    if (e.target.matches("input, textarea")) return;
    if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (validateStep(state.step)) showStep(state.step + 1);
    } else if (e.key === "ArrowLeft" || e.key === "Backspace") {
      e.preventDefault();
      showStep(state.step - 1);
    } else if (/^[1-9]$/.test(e.key)) {
      // quick-pick first N options
      const idx = +e.key - 1;
      const choices = $$(`[data-step="${state.step}"] .choice`);
      if (choices[idx]) choices[idx].click();
    }
  });
}

/* ── File upload ──────────────────────────────────── */
function wireUpload() {
  const input = $("#file-input");
  const zone = $("#upload-zone");
  const list = $("#file-list");
  if (!input || !zone) return;

  function render() {
    list.innerHTML = "";
    state.files.forEach((f, i) => {
      const el = document.createElement("div");
      el.className = "file-item";
      el.innerHTML = `<span class="file-item-name">📄 ${f.name}</span>
                      <span class="file-item-size">${(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" data-i="${i}" aria-label="Retirer">×</button>`;
      list.appendChild(el);
    });
    list.hidden = state.files.length === 0;
    list.querySelectorAll("button").forEach(b => {
      b.addEventListener("click", () => {
        state.files.splice(+b.dataset.i, 1);
        render();
      });
    });
  }

  input.addEventListener("change", () => {
    state.files.push(...[...input.files]);
    input.value = "";
    render();
  });
  ["dragover", "dragenter"].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files) {
      state.files.push(...[...e.dataTransfer.files]);
      render();
    }
  });
  $("#upload-trigger")?.addEventListener("click", () => input.click());
}

/* ── Boot ─────────────────────────────────────────── */
function boot() {
  const ltEl = document.getElementById("_load_time");
  if (ltEl) ltEl.value = Date.now();
  loadState();
  applyTweaks();
  renderProgress();
  renderTweaks();
  wireConditionalFields();
  wireChoiceClicks();
  wireKeyboard();
  wireUpload();
  initSpaceCanvas();
  initConsoleEarth();

  $("#btn-home")?.addEventListener("click", () => showScreen("intro"));
  $("#btn-start")?.addEventListener("click", () => { showScreen("form"); showStep(1); });
  $("#btn-next")?.addEventListener("click", () => { if (validateStep(state.step)) showStep(state.step + 1); });
  $("#btn-back")?.addEventListener("click", () => showStep(state.step - 1));
  $("#btn-submit")?.addEventListener("click", (e) => { e.preventDefault(); submitForm(); });
  $("#btn-restart")?.addEventListener("click", () => {
    localStorage.removeItem(LS_KEY);
    location.reload();
  });

  // Restore
  if (state.screen === "form") { showScreen("form"); showStep(state.step); }
  else if (state.screen === "confirm") { renderBoardingPass(state.answers); showScreen("confirm"); }
  else showScreen("intro");

  // Tweaks integration with host
  window.addEventListener("message", (e) => {
    if (!e.data?.type) return;
    if (e.data.type === "__activate_edit_mode") {
      $("#tweaks-panel").classList.add("open");
    } else if (e.data.type === "__deactivate_edit_mode") {
      $("#tweaks-panel").classList.remove("open");
    }
  });
  try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch (e) {}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
