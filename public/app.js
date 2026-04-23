/* -----------------------------------------------------
   PHOTOREALISTIC EARTH TEXTURE
   Uses a CORS-enabled NASA Blue Marble equirectangular
   image from Wikimedia Commons and renders it to a sphere
   via per-pixel inverse projection on an offscreen canvas.
--------------------------------------------------------- */
const EARTH_DAY_TEXTURE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg";
const EARTH_CLOUDS_TEXTURE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/e/ea/Solarsystemscope_texture_2k_earth_clouds.jpg";
const EARTH_NIGHT_TEXTURE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/2/2f/Solarsystemscope_texture_2k_earth_nightmap.jpg";
const EARTH_FALLBACK_TEXTURE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/WorldMap-A_non-Frame.png/2048px-WorldMap-A_non-Frame.png";
const DECOR_ROCKET_IMAGE_URL = "/assets/rocket-real.jpg";
const DECOR_SATELLITE_IMAGE_URL = "/assets/satellite-real.jpg";

const EarthTexture = (() => {
  let _day = null, _night = null, _clouds = null, _state = "idle";
  const listeners = [];

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const off = document.createElement("canvas");
          off.width = img.naturalWidth;
          off.height = img.naturalHeight;
          const octx = off.getContext("2d", { willReadFrequently: true });
          octx.drawImage(img, 0, 0);
          resolve({
            data: octx.getImageData(0, 0, off.width, off.height).data,
            w: off.width,
            h: off.height,
          });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function sample(tex, u, v) {
    if (!tex) return [0, 0, 0];
    const x = Math.min(tex.w - 1, Math.max(0, (u * tex.w) | 0));
    const y = Math.min(tex.h - 1, Math.max(0, (v * tex.h) | 0));
    const i = (y * tex.w + x) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  }

  function load() {
    if (_state !== "idle") return;
    _state = "loading";
    Promise.all([
      loadTexture(EARTH_DAY_TEXTURE_URL),
      loadTexture(EARTH_NIGHT_TEXTURE_URL).catch(() => null),
      loadTexture(EARTH_CLOUDS_TEXTURE_URL).catch(() => null),
    ]).then(([day, night, clouds]) => {
      _day = day;
      _night = night;
      _clouds = clouds;
      _state = "ready";
      listeners.forEach(fn => fn());
    }).catch(() => {
      loadTexture(EARTH_FALLBACK_TEXTURE_URL).then((fallback) => {
        _day = fallback;
        _night = null;
        _clouds = null;
        _state = "ready";
        listeners.forEach(fn => fn());
      }).catch(() => {
        _state = "failed";
      });
    });
  }

  // Cache rendered spheres so we don't re-raycast every frame.
  // Key: R (rounded) + tilt * 10 rounded. Re-render when rotation drifts
  // by more than this threshold (smaller = smoother continents, more CPU).
  const EARTH_REGEN_THRESHOLD = 0.0008;
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
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
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
        // Inverse les pôles pour corriger l'orientation N/S.
        const v = 0.5 + lat / Math.PI;
        const day = sample(_day, u, v);
        const night = _night ? sample(_night, u, v) : day;
        let cloudU = u;
        if (_clouds) {
          // Atmosphere drifts slightly faster than the ground.
          const cloudDrift = (rot * 0.035) / (2 * Math.PI);
          cloudU = (u + cloudDrift) % 1;
          if (cloudU < 0) cloudU += 1;
        }
        const clouds = _clouds ? sample(_clouds, cloudU, v) : null;

        let lambert = nx * lx + ty * ly + tz * lz;
        lambert = Math.max(0, Math.min(1, lambert * 0.95 + 0.05));
        const daylight = Math.max(0.08, lambert);
        const nightFactor = Math.pow(Math.max(0, 1 - daylight), 1.35);

        let r = day[0] * daylight + night[0] * nightFactor * 1.2;
        let g = day[1] * daylight + night[1] * nightFactor * 1.2;
        let b = day[2] * daylight + night[2] * nightFactor * 1.35;

        if (clouds) {
          const cloudLuma = (clouds[0] + clouds[1] + clouds[2]) / (255 * 3);
          const cloudAlpha = cloudLuma * (0.12 + daylight * 0.5);
          r = r * (1 - cloudAlpha) + 255 * cloudAlpha;
          g = g * (1 - cloudAlpha) + 255 * cloudAlpha;
          b = b * (1 - cloudAlpha) + 255 * cloudAlpha;
        }

        const rim = Math.pow(1 - nz, 3) * 0.22;
        data[idx]     = Math.min(255, r + rim * 120);
        data[idx + 1] = Math.min(255, g + rim * 155);
        data[idx + 2] = Math.min(255, b + rim * 230);
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
     * Cached: re-raycasts only when rotation drifts more than threshold.
     */
    drawSphere(ctx, cx, cy, R, rot, tilt = 0.4) {
      if (_state !== "ready") return false;
      // Cap render size for very large spheres (perf)
      const renderR = Math.min(R, 320);
      const entry = getSphereCanvas(renderR, tilt);
      if (Math.abs(entry.lastRot - rot) > EARTH_REGEN_THRESHOLD || entry.lastRot === Infinity) {
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

/* Ancien moteur lune neutralise pour garder une charge minimale. */
const MoonRenderer = {
  prerender() {},
  isReady() { return false; },
  progress() { return 0; },
  drawSphere() { return false; },
};

const TOTAL_STEPS = 11;
const EARTH_ROT_BASE = 1.05;
const EARTH_ROT_SPEED_INTRO = 0; // static globe
const EARTH_ROT_SPEED_SIDE = 0;  // static globe

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

function loadDecorImage(src) {
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = src;
  return img;
}

const decorSprites = {
  rocket: loadDecorImage(DECOR_ROCKET_IMAGE_URL),
  satellite: loadDecorImage(DECOR_SATELLITE_IMAGE_URL),
};

function hasImageLoaded(img) {
  return Boolean(img && img.complete && img.naturalWidth > 0);
}

function drawImageCover(ctx, img, x, y, w, h, alpha = 1) {
  if (!hasImageLoaded(img)) return false;
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const srcRatio = srcW / srcH;
  const dstRatio = w / h;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcRatio > dstRatio) {
    sw = srcH * dstRatio;
    sx = (srcW - sw) * 0.5;
  } else {
    sh = srcW / dstRatio;
    sy = (srcH - sh) * 0.5;
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  return true;
}

let journeyVideosInitialized = false;
function initJourneyVideos() {
  if (journeyVideosInitialized) return;
  const videos = [$("#journey-video-left"), $("#journey-video-right")].filter(Boolean);
  if (!videos.length) return;
  journeyVideosInitialized = true;

  const tryPlayAll = () => {
    videos.forEach((video) => {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    });
  };

  tryPlayAll();
  ["pointerdown", "touchstart", "keydown"].forEach((evt) => {
    document.addEventListener(evt, tryPlayAll, { passive: true, once: true });
  });
}

/* ── Screen navigation ────────────────────────────── */
function showScreen(name) {
  state.screen = name;
  $$(".screen").forEach(s => s.classList.toggle("is-active", s.dataset.screen === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "form") updateJourneyTelemetry();
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
    const rgpd = $("#rgpd");
    if (!rgpd || !rgpd.checked) { if (err) { err.hidden = false; err.textContent = "⚠ Merci d'accepter la clause RGPD."; } return false; }
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
  a.rgpd = Boolean($("#rgpd")?.checked);
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
  fd.append("rgpd", a.rgpd ? "accepted" : "");

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

  const qrEl = $("#boarding-qr");
  if (qrEl && typeof QRCode !== "undefined") {
    qrEl.innerHTML = "";
    new QRCode(qrEl, {
      text: "https://astr.studio/",
      width: 148,
      height: 148,
      colorDark: "#020510",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }
}

/* ── Canvas: intro — TERRE photoréaliste (statique) ── */
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

    // Étoiles
    stars.forEach(s => {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.025 + s.tw));
      ctx.fillStyle = "#cde8ff";
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Halo atmosphérique bleu
    const halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.48);
    halo.addColorStop(0,   "rgba(92,170,255,0.52)");
    halo.addColorStop(0.28,"rgba(79,157,255,0.22)");
    halo.addColorStop(1,   "rgba(60,120,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.48, 0, Math.PI * 2); ctx.fill();

    // Terre en rotation fluide (continents qui défilent).
    const earthRot = EARTH_ROT_BASE + performance.now() * EARTH_ROT_SPEED_INTRO;
    const drew = EarthTexture.drawSphere(ctx, cx, cy, R, earthRot, 0.35);
    if (!drew) {
      // Fallback pendant le chargement de la texture (~quelques secondes)
      const g = ctx.createRadialGradient(cx - R*0.3, cy - R*0.25, R*0.05, cx, cy, R);
      g.addColorStop(0,   "#5ea6ff");
      g.addColorStop(0.5, "#2e7af8");
      g.addColorStop(1,   "#0a1e4a");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    // Rim atmosphérique (screen blend)
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rim = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.06);
    rim.addColorStop(0,   "rgba(100,180,255,0)");
    rim.addColorStop(0.5, "rgba(100,180,255,0.42)");
    rim.addColorStop(1,   "rgba(100,180,255,0)");
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Satellite intro : suit le curseur souris ─────── */
function initIntroSat() {
  const satEl  = $(".intro-orbit-sat");
  const bgEl   = $(".intro-earth-bg");
  if (!satEl || !bgEl) return;

  // Coupe l'animation CSS — le JS prend le relais
  satEl.style.animation = "none";

  let targetAngle  = -Math.PI / 2;   // 12h par défaut
  let currentAngle = -Math.PI / 2;
  let hasMouse     = false;
  let driftT       = 0;

  function setTargetAngle(clientX, clientY) {
    const rect = bgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    targetAngle = Math.atan2(clientY - cy, clientX - cx);
  }

  document.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    setTargetAngle(e.clientX, e.clientY);
    hasMouse = true;
  }, { passive: true });

  // Quitte le suivi si la souris sort de la fenêtre
  window.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) hasMouse = false;
  });

  function animate() {
    driftT += 0.006;
    if (!hasMouse) {
      // Orbite automatique en attendant la souris
      targetAngle = -Math.PI / 2 + driftT;
    }

    // Lerp angulaire chemin court
    let diff = targetAngle - currentAngle;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    currentAngle += diff * 0.07;

    // Le span est à top:-6px (position 12h quand rotation=0)
    // Pour placer le dot à l'angle currentAngle → rotation = currentAngle + π/2
    satEl.style.transform = `translate(-50%,-50%) rotate(${currentAngle + Math.PI / 2}rad)`;
    requestAnimationFrame(animate);
  }
  animate();
}

/* ── Canvas: LEFT — Fusée 3 phases premium ─────────── */
let leftCanvasState = null;
function initJourneyLeftCanvas() {
  const canvas = $("#journey-left-canvas");
  if (!canvas) return;
  const panelVideo = $("#journey-video-left");
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
    const videoReady = Boolean(panelVideo && panelVideo.readyState >= 2);
    if (videoReady) {
      const overlay = ctx.createLinearGradient(0, 0, 0, H);
      overlay.addColorStop(0, "rgba(2,8,22,0.16)");
      overlay.addColorStop(0.58, "rgba(3,10,28,0.22)");
      overlay.addColorStop(1, "rgba(1,6,18,0.34)");
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);
    } else {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      const bTop = Math.round(3 + ratio * 2);
      skyGrad.addColorStop(0, `rgb(${bTop},${bTop+4},${bTop+17})`);
      skyGrad.addColorStop(0.6, `rgba(5,11,${Math.round(35 + (1-ratio)*45)},0.8)`);
      skyGrad.addColorStop(1,   `rgba(10,${Math.round(20+(1-ratio)*30)},${Math.round(60+(1-ratio)*80)},0.5)`);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Étoiles (apparaissent à mesure qu'on monte)
    stars.forEach(s => {
      const y = ((s.y * H) + t * s.sp) % H;
      ctx.globalAlpha = ratio * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.035 + s.tw)));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath(); ctx.arc(s.x * W, y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ── Terre photoréaliste (bas du panneau)
    if (!videoReady) {
      const earthR  = Math.floor(W * 1.2);
      const earthCy = H + earthR * 0.72;
      const atmA = Math.max(0.1, 0.55 - ratio * 0.28);
      const atmHalo = ctx.createRadialGradient(W/2, earthCy, earthR*0.92, W/2, earthCy, earthR*1.16);
      atmHalo.addColorStop(0,   `rgba(92,170,255,${atmA})`);
      atmHalo.addColorStop(0.5, `rgba(79,157,255,${atmA*0.35})`);
      atmHalo.addColorStop(1,   "rgba(79,157,255,0)");
      ctx.fillStyle = atmHalo;
      ctx.beginPath(); ctx.arc(W/2, earthCy, earthR*1.16, 0, Math.PI*2); ctx.fill();

      const earthRot = EARTH_ROT_BASE + performance.now() * EARTH_ROT_SPEED_SIDE;
      const drewEarth = EarthTexture.drawSphere(ctx, W/2, earthCy, earthR, earthRot, 0.32);
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
    }

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

    // Panache externe
    const plume = ctx.createRadialGradient(0, 34, 2, 0, 34 + flameL * 0.7, 22 + flameL);
    plume.addColorStop(0, `rgba(255,240,170,${0.42 * flameI})`);
    plume.addColorStop(0.35, `rgba(255,150,80,${0.3 * flameI})`);
    plume.addColorStop(1, "rgba(255,80,32,0)");
    ctx.fillStyle = plume;
    ctx.beginPath(); ctx.arc(0, 33 + flameL * 0.45, 18 + flameL * 0.3, 0, Math.PI * 2); ctx.fill();

    // Flamme principale
    const fg = ctx.createLinearGradient(0, 30, 0, 30 + flameL);
    fg.addColorStop(0,   `rgba(255,226,144,${0.98 * flameI})`);
    fg.addColorStop(0.45,`rgba(255,126,62,${0.76 * flameI})`);
    fg.addColorStop(1,   "rgba(255,52,24,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-10, 30);
    ctx.quadraticCurveTo(0, 30 + flameL, 10, 30);
    ctx.closePath(); ctx.fill();

    // Noyau de combustion
    const fc = ctx.createLinearGradient(0, 30, 0, 30 + flameL * 0.55);
    fc.addColorStop(0, `rgba(255,255,255,${flameI})`);
    fc.addColorStop(1, "rgba(255,215,120,0)");
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.moveTo(-4.2, 30); ctx.quadraticCurveTo(0, 30 + flameL * 0.55, 4.2, 30);
    ctx.closePath(); ctx.fill();

    // Buse
    const nozzle = ctx.createLinearGradient(-4, 24, 4, 34);
    nozzle.addColorStop(0, "#596579");
    nozzle.addColorStop(0.5, "#7f8da3");
    nozzle.addColorStop(1, "#3a4456");
    ctx.fillStyle = nozzle;
    ctx.beginPath();
    ctx.moveTo(-5, 24); ctx.lineTo(5, 24); ctx.lineTo(4, 31); ctx.lineTo(-4, 31); ctx.closePath(); ctx.fill();

    // Corps fusée
    const bg = ctx.createLinearGradient(-12, -30, 12, 28);
    bg.addColorStop(0,   "#b7c6d8");
    bg.addColorStop(0.38,"#f2f7ff");
    bg.addColorStop(0.68,"#dce8f7");
    bg.addColorStop(1,   "#7d97b2");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-12, 24); ctx.lineTo(-12, -10);
    ctx.quadraticCurveTo(-12, -40, 0, -40);
    ctx.quadraticCurveTo(12, -40, 12, -10);
    ctx.lineTo(12, 24); ctx.closePath(); ctx.fill();

    if (hasImageLoaded(decorSprites.rocket)) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-11.6, 22); ctx.lineTo(-11.6, -9.5);
      ctx.quadraticCurveTo(-11.6, -37.8, 0, -37.8);
      ctx.quadraticCurveTo(11.6, -37.8, 11.6, -9.5);
      ctx.lineTo(11.6, 22); ctx.closePath();
      ctx.clip();
      drawImageCover(ctx, decorSprites.rocket, -12, -40, 24, 64, 0.92);
      ctx.restore();
    }

    // Ombre latérale pour casser l'effet cartoon
    const bodyShadow = ctx.createLinearGradient(-12, 0, 12, 0);
    bodyShadow.addColorStop(0, "rgba(10,24,48,0.32)");
    bodyShadow.addColorStop(0.5, "rgba(10,24,48,0)");
    bodyShadow.addColorStop(1, "rgba(10,24,48,0.26)");
    ctx.fillStyle = bodyShadow;
    ctx.beginPath();
    ctx.moveTo(-12, 24); ctx.lineTo(-12, -10);
    ctx.quadraticCurveTo(-12, -40, 0, -40);
    ctx.quadraticCurveTo(12, -40, 12, -10);
    ctx.lineTo(12, 24); ctx.closePath(); ctx.fill();

    // Reflet longitudinal
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    ctx.beginPath();
    ctx.moveTo(-2.6, -8); ctx.quadraticCurveTo(-4.6, -31, 0, -39);
    ctx.quadraticCurveTo(-0.6, -24, -2.6, -8); ctx.closePath(); ctx.fill();

    // Hublot
    const wg = ctx.createRadialGradient(-1.2, -10, 0.5, 0, -10, 5.6);
    wg.addColorStop(0, "#d8edff"); wg.addColorStop(0.45, "#2d72db"); wg.addColorStop(1, "#081a3f");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.arc(0, -10, 5.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(190,224,255,0.58)"; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0, -10, 5.6, 0, Math.PI * 2); ctx.stroke();

    // Ailettes
    const finG = ctx.createLinearGradient(-24, 16, -10, 36);
    finG.addColorStop(0, "#5a7ea9"); finG.addColorStop(1, "#394f70");
    ctx.fillStyle = finG;
    ctx.beginPath(); ctx.moveTo(-12,24); ctx.lineTo(-24,42); ctx.lineTo(-12,14); ctx.closePath(); ctx.fill();
    const finD = ctx.createLinearGradient(10, 16, 24, 36);
    finD.addColorStop(0, "#6f94be"); finD.addColorStop(1, "#425b7f");
    ctx.fillStyle = finD;
    ctx.beginPath(); ctx.moveTo(12,24); ctx.lineTo(24,42); ctx.lineTo(12,14); ctx.closePath(); ctx.fill();

    // Cerclages structurels
    ctx.strokeStyle = "rgba(126,166,210,0.56)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-11, 4); ctx.lineTo(11, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-11, 14); ctx.lineTo(11, 14); ctx.stroke();

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
  const panelVideo = $("#journey-video-right");
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
    const videoReady = Boolean(panelVideo && panelVideo.readyState >= 2);
    if (videoReady) {
      const overlay = ctx.createLinearGradient(0, 0, 0, H);
      overlay.addColorStop(0, "rgba(2,8,22,0.16)");
      overlay.addColorStop(0.58, "rgba(3,10,28,0.22)");
      overlay.addColorStop(1, "rgba(1,6,18,0.34)");
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);
    } else {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      const bTop = Math.round(3 + ratio * 2);
      skyGrad.addColorStop(0,   `rgb(${bTop},${bTop+4},${bTop+17})`);
      skyGrad.addColorStop(0.6, `rgba(5,11,${Math.round(35+(1-ratio)*45)},0.8)`);
      skyGrad.addColorStop(1,   `rgba(10,${Math.round(20+(1-ratio)*30)},${Math.round(60+(1-ratio)*80)},0.5)`);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);
    }

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

    if (!videoReady) {
      const atmA = Math.max(0.1, 0.55 - ratio * 0.28);
      const atmHalo = ctx.createRadialGradient(earthCx, earthCy, earthR*0.92, earthCx, earthCy, earthR*1.16);
      atmHalo.addColorStop(0,   `rgba(92,170,255,${atmA})`);
      atmHalo.addColorStop(0.5, `rgba(79,157,255,${atmA*0.35})`);
      atmHalo.addColorStop(1,   "rgba(79,157,255,0)");
      ctx.fillStyle = atmHalo;
      ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR*1.16, 0, Math.PI*2); ctx.fill();

      const earthRot = EARTH_ROT_BASE + performance.now() * EARTH_ROT_SPEED_SIDE;
      const drewEarth = EarthTexture.drawSphere(ctx, earthCx, earthCy, earthR, earthRot, 0.32);
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
    }

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
      const pg = ctx.createLinearGradient(-panelSpan - 14, -panelH/2, -14, panelH/2);
      pg.addColorStop(0, "#133d78"); pg.addColorStop(0.45, "#2a6dc2"); pg.addColorStop(1, "#5497e8");
      ctx.fillStyle = pg;
      ctx.fillRect(-panelSpan - 14, -panelH/2, panelSpan, panelH);
      ctx.strokeStyle = "rgba(150,200,255,0.32)"; ctx.lineWidth = 0.55;
      for (let i = 0; i <= 5; i++) {
        const px2 = -panelSpan - 14 + i * (panelSpan / 5);
        ctx.beginPath(); ctx.moveTo(px2, -panelH/2); ctx.lineTo(px2, panelH/2); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-panelSpan-14, 0); ctx.lineTo(-14, 0); ctx.stroke();
      ctx.fillStyle = `rgba(190,224,255,${0.18 * p2})`;
      ctx.fillRect(-panelSpan-14, -panelH/2, panelSpan, panelH*0.28);
    }

    // Panneaux solaires droite
    if (panelSpan > 1) {
      const pg2 = ctx.createLinearGradient(14, -panelH/2, 14 + panelSpan, panelH/2);
      pg2.addColorStop(0, "#5497e8"); pg2.addColorStop(0.55, "#2a6dc2"); pg2.addColorStop(1, "#133d78");
      ctx.fillStyle = pg2;
      ctx.fillRect(14, -panelH/2, panelSpan, panelH);
      ctx.strokeStyle = "rgba(150,200,255,0.32)"; ctx.lineWidth = 0.55;
      for (let i = 0; i <= 5; i++) {
        const px2 = 14 + i * (panelSpan / 5);
        ctx.beginPath(); ctx.moveTo(px2, -panelH/2); ctx.lineTo(px2, panelH/2); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(14 + panelSpan, 0); ctx.stroke();
      ctx.fillStyle = `rgba(190,224,255,${0.18 * p2})`;
      ctx.fillRect(14, -panelH/2, panelSpan, panelH*0.28);
    }

    // Corps satellite
    const bodyW = 20, bodyH = 28;
    const bodG = ctx.createLinearGradient(-bodyW/2, -bodyH/2, bodyW/2, bodyH/2);
    bodG.addColorStop(0,   "#f5faff");
    bodG.addColorStop(0.35,"#dce9f6");
    bodG.addColorStop(0.7, "#b8cde2");
    bodG.addColorStop(1,   "#7088a1");
    ctx.fillStyle = bodG;
    ctx.beginPath(); ctx.roundRect(-bodyW/2, -bodyH/2, bodyW, bodyH, 3); ctx.fill();

    if (hasImageLoaded(decorSprites.satellite)) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(-bodyW/2 + 0.6, -bodyH/2 + 0.6, bodyW - 1.2, bodyH - 1.2, 2.5);
      ctx.clip();
      drawImageCover(ctx, decorSprites.satellite, -bodyW/2, -bodyH/2, bodyW, bodyH, 0.9);
      ctx.restore();
    }

    // Ombre et reflet pour un volume plus crédible
    const satShadow = ctx.createLinearGradient(-bodyW/2, 0, bodyW/2, 0);
    satShadow.addColorStop(0, "rgba(12,28,52,0.3)");
    satShadow.addColorStop(0.45, "rgba(12,28,52,0)");
    satShadow.addColorStop(1, "rgba(12,28,52,0.24)");
    ctx.fillStyle = satShadow;
    ctx.beginPath(); ctx.roundRect(-bodyW/2, -bodyH/2, bodyW, bodyH, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.fillRect(-bodyW/2 + 2, -bodyH/2 + 2, 3.5, bodyH - 10);

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

    // ── HUD droit: abaissé pour éviter toute superposition avec "Déploiement"
    const mono = "'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = phaseColor;
    ctx.font = `700 9px ${mono}`;
    ctx.fillText(phaseName, 11, 20);

    ctx.fillStyle = "rgba(205,225,255,0.62)";
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
  initJourneyVideos();
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

let shootingStarsTimer = null;
function initShootingStars() {
  const stars = $$(".shooting-star");
  if (!stars.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const randomFrom = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const spawn = () => {
    const idle = stars.filter((s) => !s.classList.contains("is-active"));
    const star = idle.length ? pick(idle) : pick(stars);
    if (!star) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const sx = randomFrom(0, W * 0.82);
    const sy = randomFrom(0, H * 0.56);
    const dx = randomFrom(150, 380);
    const dy = randomFrom(95, 245);
    const dur = randomFrom(700, 1600);
    const trail = randomFrom(64, 138);
    const opacity = randomFrom(0.56, 0.9);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    star.style.setProperty("--sx", `${sx.toFixed(1)}px`);
    star.style.setProperty("--sy", `${sy.toFixed(1)}px`);
    star.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    star.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    star.style.setProperty("--ang", `${angle.toFixed(1)}deg`);
    star.style.setProperty("--trail", `${trail.toFixed(1)}px`);
    star.style.setProperty("--star-opacity", opacity.toFixed(2));
    star.style.setProperty("--star-dur", `${dur.toFixed(0)}ms`);

    star.classList.remove("is-active");
    void star.offsetWidth;
    star.classList.add("is-active");

    const nextDelay = randomFrom(1100, 3600);
    shootingStarsTimer = window.setTimeout(spawn, nextDelay);
  };

  stars.forEach((star) => {
    star.addEventListener("animationend", () => {
      star.classList.remove("is-active");
    });
  });

  spawn();
}

let earthIconCounter = 0;
function progressEarthIcon() {
  earthIconCounter += 1;
  const id = `earth-icon-${earthIconCounter}`;
  return `
    <svg class="progress-icon progress-icon-earth" viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <radialGradient id="${id}-ocean" cx="34%" cy="28%" r="74%">
          <stop offset="0%" stop-color="#56bcff"></stop>
          <stop offset="52%" stop-color="#2574f0"></stop>
          <stop offset="100%" stop-color="#0a1f4f"></stop>
        </radialGradient>
        <linearGradient id="${id}-land" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6fdc7b"></stop>
          <stop offset="100%" stop-color="#319a54"></stop>
        </linearGradient>
        <radialGradient id="${id}-shade" cx="70%" cy="72%" r="68%">
          <stop offset="0%" stop-color="rgba(5,14,36,0)"></stop>
          <stop offset="100%" stop-color="rgba(3,10,25,0.62)"></stop>
        </radialGradient>
        <clipPath id="${id}-clip"><circle cx="18" cy="18" r="13.5"></circle></clipPath>
      </defs>
      <circle cx="18" cy="18" r="13.8" fill="url(#${id}-ocean)"></circle>
      <g clip-path="url(#${id}-clip)">
        <path d="M8.6 12.8c1.3-2.1 3.6-3.5 6.3-3.8 1.4-.1 2.5.6 3.2 1.5.5.6 1.2 1 2 1.1 1.9.3 3.6 1.5 4.3 3.3.4 1.2.1 2.2-.8 3.1-1 1-2.4 1.2-3.8 1-1.1-.1-2.2.1-3.1.8-1.6 1.3-4 1.5-5.8.4-1.3-.8-2.4-2-3.1-3.5-.7-1.3-.5-2.7.8-3.9z" fill="url(#${id}-land)" opacity="0.92"></path>
        <path d="M20.8 20.4c.8-.8 1.8-1.3 2.9-1.3 1.8 0 3.4 1.1 4.1 2.8.6 1.5.2 2.8-.9 3.9-1.4 1.3-3.7 1.5-5.3.4-1.3-.9-2.2-2.2-2.6-3.8-.2-.8.1-1.5.8-2z" fill="#3ca765" opacity="0.85"></path>
        <path d="M8.8 16.1c2 .1 4 .2 5.9.4 1 .1 2 .5 2.8 1.2" stroke="rgba(234,251,255,0.56)" stroke-width="0.8" stroke-linecap="round"></path>
        <path d="M14.7 10.5c1.6-.4 3.2-.3 4.8.2" stroke="rgba(234,251,255,0.52)" stroke-width="0.7" stroke-linecap="round"></path>
        <ellipse cx="15.5" cy="13.4" rx="5.2" ry="1.5" fill="rgba(241,249,255,0.28)"></ellipse>
        <ellipse cx="22.4" cy="16.8" rx="4.7" ry="1.3" fill="rgba(241,249,255,0.2)"></ellipse>
        <rect x="4" y="4" width="28" height="28" fill="url(#${id}-shade)"></rect>
      </g>
      <circle cx="18" cy="18" r="13.8" fill="none" stroke="rgba(156,215,255,0.88)" stroke-width="1"></circle>
      <circle cx="18" cy="18" r="15.1" fill="none" stroke="rgba(102,188,255,0.34)" stroke-width="0.8"></circle>
    </svg>
  `;
}

let satelliteIconCounter = 0;
function progressSatelliteIcon() {
  satelliteIconCounter += 1;
  const id = `sat-icon-${satelliteIconCounter}`;
  return `
    <svg class="progress-icon progress-icon-sat" viewBox="0 0 42 42" aria-hidden="true">
      <defs>
        <linearGradient id="${id}-panel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#7fd3ff"></stop>
          <stop offset="100%" stop-color="#2568c8"></stop>
        </linearGradient>
        <linearGradient id="${id}-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#eef6ff"></stop>
          <stop offset="100%" stop-color="#9bbad7"></stop>
        </linearGradient>
      </defs>
      <circle cx="21" cy="21" r="20" fill="rgba(7,18,44,0.82)"></circle>
      <g transform="rotate(-13 21 21)">
        <rect x="5.2" y="16.1" width="11.2" height="9.8" rx="1.5" fill="url(#${id}-panel)"></rect>
        <rect x="25.6" y="16.1" width="11.2" height="9.8" rx="1.5" fill="url(#${id}-panel)"></rect>
        <path d="M10.8 16.5v9m3.2-9v9m14.2-9v9m3.2-9v9" stroke="rgba(224,245,255,0.32)" stroke-width="0.7"></path>
        <rect x="16.4" y="14.9" width="9.4" height="12.2" rx="2.3" fill="url(#${id}-body)"></rect>
        <circle cx="21.1" cy="20.7" r="2.15" fill="#1f6dde" stroke="rgba(233,247,255,0.88)" stroke-width="0.7"></circle>
        <path d="M20.8 27.4l-4.1 3.1" stroke="#b8d9f8" stroke-width="1" stroke-linecap="round"></path>
        <circle cx="16.2" cy="30.8" r="2.5" fill="none" stroke="rgba(179,226,255,0.68)" stroke-width="1"></circle>
      </g>
      <circle cx="21" cy="21" r="16.2" fill="none" stroke="rgba(162,216,255,0.66)" stroke-width="0.7"></circle>
      <circle cx="21" cy="21" r="18.5" fill="none" stroke="rgba(112,188,255,0.42)" stroke-width="0.85"></circle>
      <circle cx="21" cy="21" r="20" fill="none" stroke="rgba(165,214,255,0.5)" stroke-width="1"></circle>
    </svg>
  `;
}

let rocketIconCounter = 0;
function progressRocketIcon() {
  rocketIconCounter += 1;
  const id = `rocket-icon-${rocketIconCounter}`;
  return `
    <svg class="progress-icon progress-icon-rocket" viewBox="0 0 52 24" aria-hidden="true">
      <defs>
        <linearGradient id="${id}-shell" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f8fcff"></stop>
          <stop offset="100%" stop-color="#b9d3ec"></stop>
        </linearGradient>
        <linearGradient id="${id}-accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#4ca8ff"></stop>
          <stop offset="100%" stop-color="#2672f0"></stop>
        </linearGradient>
      </defs>
      <g transform="translate(1 1)">
        <path d="M3.5 12l9.3-7.4h19.4c6.2 0 11.5 3.2 14.3 7.4-2.8 4.3-8.1 7.4-14.3 7.4H12.8z" fill="url(#${id}-shell)" stroke="rgba(169,213,248,0.82)" stroke-width="0.9"></path>
        <path d="M33.8 6.2c3.4.6 6.4 2.6 8 5.8-1.6 3.2-4.6 5.2-8 5.8 2-.9 3.8-2.8 4.6-5.8-.8-2.9-2.5-4.9-4.6-5.8z" fill="#9ab9d8" opacity="0.72"></path>
        <path d="M14.8 5.8h14.2v2.9H14.8zm0 9.5h12.6v2.9H14.8z" fill="url(#${id}-accent)" opacity="0.92"></path>
        <circle cx="24.2" cy="12" r="3" fill="#1f73f0" stroke="rgba(229,247,255,0.94)" stroke-width="0.8"></circle>
        <path d="M9.2 9.2L5.7 6.7 7.2 11.1z" fill="#5f90d0"></path>
        <path d="M9.2 14.8L5.7 17.3 7.2 12.9z" fill="#5f90d0"></path>
        <rect x="2.1" y="10.5" width="3.2" height="3" rx="1" fill="#5f8dc7"></rect>
      </g>
      <rect x="0.5" y="0.5" width="51" height="23" rx="11.5" fill="none" stroke="rgba(129,196,255,0.28)" stroke-width="0.7"></rect>
    </svg>
  `;
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
      <div class="progress-mobile-decor" aria-hidden="true">
        <div class="progress-mobile-earth">${progressEarthIcon()}</div>
        <div class="progress-mobile-rocket">
          <span class="progress-mobile-rocket-icon">${progressRocketIcon()}</span>
          <span class="progress-mobile-flame"></span>
        </div>
        <div class="progress-mobile-target">${progressSatelliteIcon()}</div>
      </div>
    `;
  } else if (style === "altitude") {
    wrap.innerHTML = `
      <div class="progress-earth">${progressEarthIcon()}</div>
      <div class="progress-trail">
        <div class="progress-rail"></div>
        <div class="progress-fill"></div>
        <div class="progress-rocket">${progressRocketIcon()}</div>
      </div>
      <div class="progress-orbit">${progressSatelliteIcon()}</div>
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
  initShootingStars();
  initConsoleEarth();
  initIntroSat();

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





