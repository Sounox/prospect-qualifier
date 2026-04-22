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

/* ── Canvas: intro console Earth ──────────────────── */
function initConsoleEarth() {
  const canvas = $("#console-earth-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H, cx, cy, R;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    R = Math.floor(Math.min(W, H) * 0.48);
  }
  resize();
  window.addEventListener("resize", resize);

  let t = 0;
  const stars = Array.from({length: 60}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.2 + 0.3,
    tw: Math.random() * Math.PI * 2,
  }));

  function frame() {
    ctx.clearRect(0, 0, W, H);

    // stars
    stars.forEach(s => {
      ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.03 + s.tw));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Atmosphere halo (blue glow)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.55);
    halo.addColorStop(0, "rgba(92,170,255,0.42)");
    halo.addColorStop(0.5, "rgba(79,157,255,0.18)");
    halo.addColorStop(1, "rgba(79,157,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.55, 0, Math.PI * 2); ctx.fill();

    // Earth sphere (photoreal texture)
    const drawn = EarthTexture.drawSphere(ctx, cx, cy, R, t * 0.0015, 0.41);
    if (!drawn) {
      // Fallback: simple blue gradient until texture loads
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      g.addColorStop(0, "#5ea6ff");
      g.addColorStop(0.55, "#2e7af8");
      g.addColorStop(1, "#0a1e4a");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    // Cloud layer — subtle moving clouds
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 6; i++) {
      const a = t * 0.002 + i * 1.1;
      const cx2 = cx + Math.cos(a) * R * 0.6;
      const cy2 = cy + Math.sin(a * 1.3) * R * 0.4;
      const rad = R * (0.18 + 0.12 * Math.sin(a * 2));
      const cg = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, rad);
      cg.addColorStop(0, "rgba(255,255,255,0.9)");
      cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx2, cy2, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Rim atmosphere glow (bright edge)
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rim = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.04);
    rim.addColorStop(0, "rgba(140,200,255,0)");
    rim.addColorStop(0.6, "rgba(140,200,255,0.35)");
    rim.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Canvas: LEFT journey panel (rocket ascent) ──── */
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

  const stars = Array.from({length: 120}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.4 + 0.3,
    sp: Math.random() * 0.3 + 0.1,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--progress-ratio")) || 0;

    // Gradient sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, "rgba(3,7,20,1)");
    skyGrad.addColorStop(0.6, "rgba(5,11,35,0.7)");
    skyGrad.addColorStop(1, "rgba(15,30,80,0.4)");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // Stars (scrolling)
    stars.forEach(s => {
      const y = ((s.y * H) + t * s.sp) % H;
      ctx.globalAlpha = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.04 + s.tw));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath();
      ctx.arc(s.x * W, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Earth at bottom — photoréaliste avec EarthTexture
    const earthR = Math.floor(W * 1.2);
    const earthCy = H + earthR * 0.72;

    // Atmospheric halo AVANT la Terre (derrière)
    const atmHalo = ctx.createRadialGradient(W * 0.5, earthCy, earthR * 0.92, W * 0.5, earthCy, earthR * 1.15);
    atmHalo.addColorStop(0, "rgba(92,170,255,0.55)");
    atmHalo.addColorStop(0.5, "rgba(79,157,255,0.2)");
    atmHalo.addColorStop(1, "rgba(79,157,255,0)");
    ctx.fillStyle = atmHalo;
    ctx.beginPath(); ctx.arc(W / 2, earthCy, earthR * 1.15, 0, Math.PI * 2); ctx.fill();

    // Terre photoréaliste (texture NASA raycasting)
    const drewEarth = EarthTexture.drawSphere(ctx, W / 2, earthCy, earthR, t * 0.0003, 0.32);
    if (!drewEarth) {
      // Fallback gradient si texture pas encore chargée
      const eGrad = ctx.createRadialGradient(W * 0.35, H - 40, earthR * 0.05, W * 0.5, earthCy, earthR);
      eGrad.addColorStop(0, "#5ea6ff");
      eGrad.addColorStop(0.5, "#2e7af8");
      eGrad.addColorStop(1, "#0a1e4a");
      ctx.fillStyle = eGrad;
      ctx.beginPath(); ctx.arc(W / 2, earthCy, earthR, 0, Math.PI * 2); ctx.fill();
    }

    // Rim lumineux (atmosphère)
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rimGrad = ctx.createRadialGradient(W/2, earthCy, earthR * 0.96, W/2, earthCy, earthR * 1.04);
    rimGrad.addColorStop(0, "rgba(140,200,255,0)");
    rimGrad.addColorStop(0.5, "rgba(140,200,255,0.3)");
    rimGrad.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = rimGrad;
    ctx.beginPath(); ctx.arc(W / 2, earthCy, earthR * 1.04, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Rocket — ascends as ratio increases
    // start near bottom (y ~ H - 80), end near top (y ~ 60)
    const rocketY = H - 60 - ratio * (H - 120);
    const rocketX = W / 2 + Math.sin(t * 0.03) * 4;

    // exhaust
    const flameLen = 30 + Math.sin(t * 0.4) * 6 + (1 - ratio) * 20;
    const fg = ctx.createLinearGradient(0, rocketY + 30, 0, rocketY + 30 + flameLen);
    fg.addColorStop(0, "rgba(255,200,100,0.95)");
    fg.addColorStop(0.4, "rgba(255,120,60,0.7)");
    fg.addColorStop(1, "rgba(255,60,30,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(rocketX - 8, rocketY + 30);
    ctx.quadraticCurveTo(rocketX, rocketY + 30 + flameLen, rocketX + 8, rocketY + 30);
    ctx.closePath();
    ctx.fill();

    // inner flame
    const fgi = ctx.createLinearGradient(0, rocketY + 30, 0, rocketY + 30 + flameLen * 0.6);
    fgi.addColorStop(0, "rgba(255,255,255,1)");
    fgi.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = fgi;
    ctx.beginPath();
    ctx.moveTo(rocketX - 4, rocketY + 30);
    ctx.quadraticCurveTo(rocketX, rocketY + 30 + flameLen * 0.6, rocketX + 4, rocketY + 30);
    ctx.closePath();
    ctx.fill();

    // rocket body
    ctx.save();
    ctx.translate(rocketX, rocketY);
    // body
    const bgrad = ctx.createLinearGradient(-8, 0, 8, 0);
    bgrad.addColorStop(0, "#e4eeff");
    bgrad.addColorStop(0.5, "#ffffff");
    bgrad.addColorStop(1, "#9ac3f5");
    ctx.fillStyle = bgrad;
    ctx.beginPath();
    ctx.moveTo(-8, 20);
    ctx.lineTo(-8, -10);
    ctx.quadraticCurveTo(-8, -26, 0, -26);
    ctx.quadraticCurveTo(8, -26, 8, -10);
    ctx.lineTo(8, 20);
    ctx.closePath();
    ctx.fill();
    // window
    ctx.fillStyle = "#2574F0";
    ctx.beginPath(); ctx.arc(0, -5, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cde4ff";
    ctx.beginPath(); ctx.arc(0, -5, 2, 0, Math.PI * 2); ctx.fill();
    // fins
    ctx.fillStyle = "#8cc0ff";
    ctx.beginPath(); ctx.moveTo(-8, 20); ctx.lineTo(-14, 28); ctx.lineTo(-8, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(14, 28); ctx.lineTo(8, 12); ctx.closePath(); ctx.fill();
    ctx.restore();

    // altitude readout overlay
    const altKm = Math.round(ratio * 408);
    ctx.fillStyle = "rgba(205,225,255,0.5)";
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`ALT  ${String(altKm).padStart(3, "0")} KM`, W - 18, 38);

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

/* ── Canvas: RIGHT journey panel (orbit) ─────────── */
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

  const stars = Array.from({length: 140}, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.4 + 0.3,
    tw: Math.random() * Math.PI * 2,
  }));
  let t = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--progress-ratio")) || 0;

    // bg
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(3,7,20,1)");
    g.addColorStop(1, "rgba(8,16,40,0.8)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    stars.forEach(s => {
      ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.03 + s.tw));
      ctx.fillStyle = "#cde4ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Earth at bottom-left (photoreal)
    const earthCx = W * 0.2;
    const earthCy = H + 40;
    const earthR = Math.floor(W * 0.8);

    // Atmosphere halo behind Earth
    const halo = ctx.createRadialGradient(earthCx, earthCy, earthR * 0.95, earthCx, earthCy, earthR * 1.12);
    halo.addColorStop(0, "rgba(92,170,255,0.45)");
    halo.addColorStop(1, "rgba(79,157,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR * 1.12, 0, Math.PI * 2); ctx.fill();

    // Photoreal sphere (only draws if texture ready — costly so sample density limited)
    // For very large radii we render at half-res into an offscreen and upscale
    const drewEarth = EarthTexture.drawSphere(ctx, earthCx, earthCy, earthR, t * 0.0008, 0.38);
    if (!drewEarth) {
      const eGrad = ctx.createRadialGradient(earthCx - earthR * 0.3, earthCy - earthR * 0.3, earthR * 0.05, earthCx, earthCy, earthR);
      eGrad.addColorStop(0, "#5ea6ff");
      eGrad.addColorStop(0.5, "#2e7af8");
      eGrad.addColorStop(1, "#0a1e4a");
      ctx.fillStyle = eGrad;
      ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR, 0, Math.PI * 2); ctx.fill();
    }

    // Bright rim
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rim = ctx.createRadialGradient(earthCx, earthCy, earthR * 0.96, earthCx, earthCy, earthR * 1.02);
    rim.addColorStop(0, "rgba(140,200,255,0)");
    rim.addColorStop(0.5, "rgba(140,200,255,0.25)");
    rim.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(earthCx, earthCy, earthR * 1.02, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Orbit ring
    const orbitR = earthR + 60;
    ctx.strokeStyle = "rgba(120,190,255,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(earthCx, earthCy, orbitR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Satellite position animates along arc with ratio
    const satAngle = -Math.PI * 0.5 - ratio * Math.PI * 0.7; // from top to right
    const satX = earthCx + Math.cos(satAngle) * orbitR;
    const satY = earthCy + Math.sin(satAngle) * orbitR;

    // deploy stage: panels open as ratio > 0.3
    const deploy = Math.min(1, Math.max(0, (ratio - 0.3) / 0.7));

    // Satellite
    ctx.save();
    ctx.translate(satX, satY);
    ctx.rotate(satAngle + Math.PI / 2);

    // Solar panels (grow with deploy)
    const panelW = 22 * deploy;
    if (panelW > 0.5) {
      ctx.fillStyle = "#2574F0";
      ctx.fillRect(-panelW - 10, -6, panelW, 12);
      ctx.fillRect(10, -6, panelW, 12);
      // grid lines
      ctx.strokeStyle = "rgba(200,220,255,0.4)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 4; i++) {
        const x1 = -panelW - 10 + i * (panelW / 4);
        ctx.beginPath(); ctx.moveTo(x1, -6); ctx.lineTo(x1, 6); ctx.stroke();
        const x2 = 10 + i * (panelW / 4);
        ctx.beginPath(); ctx.moveTo(x2, -6); ctx.lineTo(x2, 6); ctx.stroke();
      }
    }
    // Satellite body
    ctx.fillStyle = "#e8f4ff";
    ctx.fillRect(-10, -7, 20, 14);
    ctx.strokeStyle = "#8fc0ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(-10, -7, 20, 14);
    // dish
    ctx.fillStyle = "#2574F0";
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cde4ff";
    ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Signal pulse from satellite as deploy progresses
    if (deploy > 0.5) {
      const pulseR = ((t * 0.8) % 80);
      ctx.strokeStyle = `rgba(92,227,255,${Math.max(0, 1 - pulseR / 80) * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(satX, satY, pulseR, 0, Math.PI * 2); ctx.stroke();
    }

    // Readout
    ctx.fillStyle = "rgba(205,225,255,0.55)";
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    const phase = deploy > 0.95 ? "DEPLOYED" : deploy > 0.1 ? "DEPLOYING" : "ASCENT";
    ctx.fillText(`SAT · ${phase}`, 18, 38);

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
