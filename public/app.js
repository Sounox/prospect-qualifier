'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   PROSPECT QUALIFIER — Frontend SPA
   Gestion des étapes, validations, upload, envoi
───────────────────────────────────────────────────────────────────────────── */

// ── Constantes ──────────────────────────────────────────────────────────────

const TOTAL_STEPS = 11;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;

const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'svg', 'pdf', 'doc', 'docx',
]);

// ── État de l'application ────────────────────────────────────────────────────

const state = {
  currentStep: 1,
  selectedFiles: [],
  orbitalAnimationFrame: null,
  journeyAnimFrame: null,
};

// ── Références DOM ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const screens = {
  intro:   $('screen-intro'),
  form:    $('screen-form'),
  confirm: $('screen-confirm'),
};

const els = {
  stepNum:      $('step-num'),
  stepTotal:    $('step-total'),
  progressFill: $('progress-fill'),
  progressPct:  $('progress-pct'),
  progressTrack: $('progress-track'),
  progressRocket: $('progress-rocket'),
  btnStart:     $('btn-start'),
  btnBack:      $('btn-back'),
  btnNext:      $('btn-next'),
  btnSubmit:    $('btn-submit'),
  form:         $('prospect-form'),
  loadTime:     $('_load_time'),
  uploadZoneInner: $('upload-drop-area'),
  uploadTrigger:   $('upload-trigger'),
  fileInput:       $('file-input'),
  fileList:        $('file-list'),
  confirmIdBlock:  $('confirm-id-block'),
  confirmIdValue:  $('confirm-id-value'),
  spaceCanvas:     $('space-canvas'),
  introVisual:     document.querySelector('.intro-visual'),
  missionCards:    document.querySelectorAll('.mission-card'),
};

// ── Initialisation ───────────────────────────────────────────────────────────

function init() {
  // Timestamp de chargement de la page (anti-spam)
  els.loadTime.value = Date.now().toString();
  document.body.dataset.screen = 'intro';

  // Afficher le total d'étapes
  els.stepTotal.textContent = TOTAL_STEPS;

  // Événements de navigation
  els.btnStart.addEventListener('click', startQuestionnaire);
  els.btnBack.addEventListener('click', goBack);
  els.btnNext.addEventListener('click', goNext);
  els.form.addEventListener('submit', handleSubmit);

  // Événements upload
  els.uploadTrigger.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', onFileInputChange);
  setupDragAndDrop();

  // Champs conditionnels radio (déclenchés par data-triggers)
  document.querySelectorAll('.choices-grid input[type="radio"][data-triggers]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const targetId = radio.getAttribute('data-triggers');
      handleConditionalRadio(radio.name, targetId, radio.value);
    });
  });

  // Champs conditionnels radio sur tout le groupe (pour masquer quand on change de réponse)
  document.querySelectorAll('.choices-grid').forEach((grid) => {
    grid.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        // Masquer tous les wraps conditionnels du groupe, puis ré-afficher le bon
        const wrapsInStep = radio.closest('.form-step').querySelectorAll('.conditional-wrap');
        wrapsInStep.forEach((wrap) => {
          // Ne masquer que les wraps liés au même groupe radio
          const triggeredBy = [...radio.closest('.choices-grid').querySelectorAll('input[data-triggers]')]
            .map((r) => r.getAttribute('data-triggers'));
          if (triggeredBy.includes(wrap.id)) {
            wrap.hidden = true;
          }
        });
        // Ré-afficher si nécessaire
        if (radio.dataset.triggers) {
          const wrap = $(radio.dataset.triggers);
          if (wrap) wrap.hidden = false;
        }
      });
    });
  });

  // Champs conditionnels checkbox
  document.querySelectorAll('[data-triggers-checkbox]').forEach((label) => {
    const checkbox = label.querySelector('input[type="checkbox"]');
    const targetId = label.getAttribute('data-triggers-checkbox');
    if (checkbox && targetId) {
      checkbox.addEventListener('change', () => {
        const wrap = $(targetId);
        if (wrap) wrap.hidden = !checkbox.checked;
      });
    }
  });

  initOrbitalExperience();
}

// ── Navigation ───────────────────────────────────────────────────────────────

function startQuestionnaire() {
  showScreen('form');
  updateProgressBar();
}

function goNext() {
  if (!validateStep(state.currentStep)) return;

  if (state.currentStep < TOTAL_STEPS) {
    state.currentStep++;
    showStep(state.currentStep);
    updateProgressBar();
    scrollToTop();
  }
}

function goBack() {
  if (state.currentStep > 1) {
    state.currentStep--;
    showStep(state.currentStep);
    updateProgressBar();
    scrollToTop();
  }
}

function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
  document.body.dataset.screen = name;
}

function showStep(stepNumber) {
  document.querySelectorAll('.form-step').forEach((step) => {
    step.hidden = true;
  });

  const target = document.querySelector(`.form-step[data-step="${stepNumber}"]`);
  if (target) {
    target.hidden = false;
    // Re-trigger animation
    target.style.animation = 'none';
    requestAnimationFrame(() => {
      target.style.animation = '';
    });
  }

  // Bouton Retour
  els.btnBack.hidden = stepNumber === 1;

  // Dernier step : afficher Envoyer, masquer Suivant
  if (stepNumber === TOTAL_STEPS) {
    els.btnNext.hidden = true;
    els.btnSubmit.hidden = false;
  } else {
    els.btnNext.hidden = false;
    els.btnSubmit.hidden = true;
  }
}

function updateProgressBar() {
  const ratio = state.currentStep / TOTAL_STEPS;
  const pct = Math.round(ratio * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressPct.textContent = `${pct}%`;
  els.stepNum.textContent = state.currentStep;
  els.progressTrack.setAttribute('aria-valuenow', pct);
  document.documentElement.style.setProperty('--progress-ratio', ratio.toFixed(4));

  if (els.progressRocket) {
    els.progressRocket.style.left = `${pct}%`;
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Validations ──────────────────────────────────────────────────────────────

/**
 * Valide l'étape courante et retourne true si valide.
 * Affiche les messages d'erreur appropriés.
 */
function validateStep(step) {
  const errEl = $(`err-${step}`);

  // Masquer toute erreur précédente
  if (errEl) errEl.hidden = true;

  switch (step) {
    case 1:
      return validateRequired(step, 'q1_objective', 'radio');
    case 2:
      return validateRequired(step, 'q2_existing_site', 'radio');
    case 3:
      return validateRequired(step, 'q3_site_type', 'radio');
    case 4:
      return validateCheckboxGroup(step, 'q4_pages');
    case 5:
      return validateRequired(step, 'q5_style', 'radio');
    case 6:
      return validateRequired(step, 'q6_colors', 'radio');
    case 7:
      return validateCheckboxGroup(step, 'q7_priorities');
    case 8:
      return validateUpload(step);
    case 9:
      return validateTextarea(step, 'q9_expectations');
    case 10:
      return validateRequired(step, 'q10_readiness', 'radio');
    case 11:
      return validateContactStep(step);
    default:
      return true;
  }
}

function validateRequired(step, name, type) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  if (!checked) {
    showStepError(step);
    return false;
  }
  return true;
}

function validateCheckboxGroup(step, name) {
  const checked = document.querySelectorAll(`input[name="${name}"]:checked`);
  if (checked.length === 0) {
    showStepError(step);
    return false;
  }
  return true;
}

function validateTextarea(step, id) {
  const textarea = $(id);
  const val = textarea ? textarea.value.trim() : '';
  if (!val) {
    showStepError(step);
    textarea && textarea.focus();
    return false;
  }
  return true;
}

function validateUpload(step) {
  // Step 8 : upload est optionnel, mais on vérifie les erreurs de fichiers
  const errEl = $(`err-${step}`);
  // Valide toujours (upload facultatif)
  return true;
}

function validateContactStep(step) {
  let valid = true;

  // Nettoyer les erreurs existantes
  ['company_name', 'contact_name', 'contact_email', 'rgpd'].forEach((field) => {
    const errEl = $(`err-${field}`);
    if (errEl) errEl.hidden = true;
    const input = $(field);
    if (input) input.classList.remove('has-error');
  });

  // Nom entreprise
  const companyName = $('company_name');
  if (!companyName || !companyName.value.trim()) {
    showFieldError('company_name', "Le nom de l'entreprise est requis.");
    valid = false;
  }

  // Nom contact
  const contactName = $('contact_name');
  if (!contactName || !contactName.value.trim()) {
    showFieldError('contact_name', 'Votre nom est requis.');
    valid = false;
  }

  // Email
  const email = $('contact_email');
  if (!email || !email.value.trim()) {
    showFieldError('contact_email', "L'adresse email est requise.");
    valid = false;
  } else if (!isValidEmail(email.value.trim())) {
    showFieldError('contact_email', 'Veuillez saisir une adresse email valide.');
    valid = false;
  }

  // RGPD
  const rgpd = $('rgpd');
  if (!rgpd || !rgpd.checked) {
    const errEl = $('err-rgpd');
    if (errEl) {
      errEl.textContent = "Vous devez accepter les conditions pour continuer.";
      errEl.hidden = false;
    }
    valid = false;
  }

  return valid;
}

function showStepError(step) {
  const errEl = $(`err-${step}`);
  if (errEl) errEl.hidden = false;
}

function showFieldError(fieldId, message) {
  const input = $(fieldId);
  const errEl = $(`err-${fieldId}`);
  if (input) input.classList.add('has-error');
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = false;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Champs conditionnels ──────────────────────────────────────────────────────

function handleConditionalRadio(groupName, targetWrapId, selectedValue) {
  const wrap = $(targetWrapId);
  if (wrap) wrap.hidden = false;
}

// ── Upload de fichiers ───────────────────────────────────────────────────────

function setupDragAndDrop() {
  const dropArea = els.uploadZoneInner;

  dropArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropArea.classList.add('is-drag-over');
  });

  dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('is-drag-over');
  });

  dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('is-drag-over');
  });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('is-drag-over');
    addFiles(Array.from(e.dataTransfer.files));
  });
}

function onFileInputChange(e) {
  addFiles(Array.from(e.target.files));
  // Réinitialiser l'input pour permettre de re-sélectionner le même fichier
  els.fileInput.value = '';
}

function addFiles(newFiles) {
  const errEl = $('err-8');
  if (errEl) errEl.hidden = true;

  for (const file of newFiles) {
    if (state.selectedFiles.length >= MAX_FILES) {
      showUploadError(`Maximum ${MAX_FILES} fichiers autorisés.`);
      break;
    }

    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      showUploadError(`Type de fichier non autorisé : ${file.name} (.${ext} non accepté)`);
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      showUploadError(`Fichier trop volumineux : ${file.name} (max ${MAX_FILE_SIZE_MB} Mo)`);
      continue;
    }

    // Éviter les doublons par nom + taille
    const isDuplicate = state.selectedFiles.some(
      (f) => f.name === file.name && f.size === file.size
    );
    if (!isDuplicate) {
      state.selectedFiles.push(file);
    }
  }

  renderFileList();
}

function removeFile(index) {
  state.selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  const list = els.fileList;
  list.innerHTML = '';

  if (state.selectedFiles.length === 0) {
    list.hidden = true;
    return;
  }

  list.hidden = false;

  state.selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-icon" aria-hidden="true">${getFileIcon(file.name)}</span>
      <span class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <span class="file-item-size">${formatFileSize(file.size)}</span>
      <button
        type="button"
        class="file-item-remove"
        aria-label="Supprimer ${escapeHtml(file.name)}"
        data-index="${index}"
      >×</button>
    `;
    item.querySelector('.file-item-remove').addEventListener('click', () => removeFile(index));
    list.appendChild(item);
  });
}

function showUploadError(message) {
  const errEl = $('err-8');
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = false;
  }
}

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function getFileIcon(filename) {
  const ext = getExtension(filename);
  if (['jpg', 'jpeg', 'png', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  return '📎';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Soumission ───────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  if (!validateStep(TOTAL_STEPS)) return;

  setSubmitLoading(true);

  try {
    const formData = buildFormData();

    const response = await fetch('/api/submit', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (result.success) {
      showConfirmation(result.submissionId);
    } else {
      setSubmitLoading(false);
      showGlobalError(result.error || "Une erreur est survenue. Veuillez réessayer.");
    }
  } catch (err) {
    setSubmitLoading(false);
    showGlobalError("Impossible d'envoyer le formulaire. Vérifiez votre connexion et réessayez.");
  }
}

function buildFormData() {
  const formData = new FormData();

  // Données du formulaire HTML (champs texte, radio, checkbox)
  const form = els.form;

  // Champs texte / textarea / url / email / tel / hidden
  form.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea').forEach((input) => {
    if (input.name && !input.classList.contains('hp-field')) {
      formData.append(input.name, input.value);
    }
  });

  // Radio sélectionnés
  form.querySelectorAll('input[type="radio"]:checked').forEach((radio) => {
    formData.append(radio.name, radio.value);
  });

  // Checkboxes sélectionnés
  const checkboxGroups = {};
  form.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
    if (!checkboxGroups[cb.name]) checkboxGroups[cb.name] = [];
    checkboxGroups[cb.name].push(cb.value);
  });
  Object.entries(checkboxGroups).forEach(([name, values]) => {
    values.forEach((v) => formData.append(name, v));
  });

  // Fichiers
  state.selectedFiles.forEach((file) => {
    formData.append('files', file, file.name);
  });

  return formData;
}

function setSubmitLoading(loading) {
  const btn = els.btnSubmit;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');

  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (loader) loader.hidden = !loading;
}

function showConfirmation(submissionId) {
  if (submissionId) {
    els.confirmIdValue.textContent = submissionId.slice(0, 8).toUpperCase();
    els.confirmIdBlock.hidden = false;
  }
  showScreen('confirm');
  scrollToTop();
}

function showGlobalError(message) {
  const errEl = $('err-11');
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = false;
  }
  scrollToTop();
}

// ── Lancement ────────────────────────────────────────────────────────────────

function initOrbitalExperience() {
  initMissionCards();
  initIntroParallax();
  initSpaceCanvas();
  initJourneyPanels();
}

function initMissionCards() {
  if (!els.missionCards || els.missionCards.length === 0) return;

  els.missionCards.forEach((card, idx) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(10px)';
    card.style.transition = `opacity 450ms ease ${idx * 70}ms, transform 450ms ease ${idx * 70}ms`;
  });

  requestAnimationFrame(() => {
    els.missionCards.forEach((card) => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  });
}

function initIntroParallax() {
  if (!els.introVisual || window.matchMedia('(max-width: 800px)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // CSS animations override inline transforms — we must kill the animation
  // first, then hand control to JS.
  function enable() {
    els.introVisual.style.animation = 'none';
    els.introVisual.style.opacity   = '1';
    els.introVisual.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';

    const maxTilt = 6;
    document.addEventListener('pointermove', (e) => {
      const x = (e.clientX / window.innerWidth)  - 0.5;
      const y = (e.clientY / window.innerHeight) - 0.5;
      els.introVisual.style.transform =
        `perspective(1000px) rotateX(${(-y * maxTilt).toFixed(2)}deg) rotateY(${(x * maxTilt).toFixed(2)}deg)`;
    });

    document.addEventListener('pointerleave', () => {
      els.introVisual.style.transform =
        'perspective(1000px) rotateX(0deg) rotateY(0deg)';
    });
  }

  // Fire after reveal animation ends (or after a safe timeout as fallback)
  els.introVisual.addEventListener('animationend', enable, { once: true });
  setTimeout(enable, 1100);
}

function initSpaceCanvas() {
  const canvas = els.spaceCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia('(max-width: 540px)').matches;
  const maxStars = isMobile ? 55 : 120;
  const stars = [];
  const shootingStars = [];
  let shootingStarTimer = 0;

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function buildStars() {
    stars.length = 0;
    for (let i = 0; i < maxStars; i += 1) {
      const size = Math.random();
      stars.push({
        x:      Math.random() * window.innerWidth,
        y:      Math.random() * window.innerHeight,
        radius: size < 0.7 ? Math.random() * 0.8 + 0.15
               : size < 0.92 ? Math.random() * 0.6 + 0.8
               : Math.random() * 0.5 + 1.3,
        alpha:  Math.random() * 0.55 + 0.2,
        speed:  Math.random() * 0.12 + 0.02,
        twinkleSpeed: Math.random() * 0.018 + 0.006,
        twinklePhase: Math.random() * Math.PI * 2,
        hue:    Math.random() > 0.8 ? 200 + Math.random() * 40 : 220,
      });
    }
  }

  function spawnShootingStar() {
    const startX = Math.random() * window.innerWidth * 0.7 + window.innerWidth * 0.1;
    const startY = Math.random() * window.innerHeight * 0.4;
    shootingStars.push({
      x:       startX,
      y:       startY,
      vx:      (Math.random() * 6 + 5) * (Math.random() > 0.5 ? 1 : -1),
      vy:      Math.random() * 4 + 2,
      length:  Math.random() * 80 + 60,
      alpha:   0,
      maxAlpha: Math.random() * 0.55 + 0.35,
      phase:   'in',
      life:    0,
      maxLife: Math.random() * 40 + 30,
    });
  }

  function draw(timestamp) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Draw static + twinkling stars
    stars.forEach((star) => {
      if (!prefersReducedMotion) {
        star.twinklePhase += star.twinkleSpeed;
        star.y += star.speed;
        if (star.y > window.innerHeight + 4) {
          star.y = -4;
          star.x = Math.random() * window.innerWidth;
        }
      }

      const twinkle = prefersReducedMotion ? 1 : 0.65 + 0.35 * Math.sin(star.twinklePhase);
      const a = star.alpha * twinkle;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${star.hue}, 70%, 90%, ${a})`;
      ctx.fill();

      // Add a subtle glow for larger stars
      if (star.radius > 1.1 && !prefersReducedMotion) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius * 2.5, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(
          star.x, star.y, 0,
          star.x, star.y, star.radius * 2.5
        );
        grad.addColorStop(0, `hsla(${star.hue}, 80%, 90%, ${a * 0.3})`);
        grad.addColorStop(1, `hsla(${star.hue}, 80%, 90%, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    });

    // Draw shooting stars
    if (!prefersReducedMotion) {
      shootingStarTimer++;
      if (shootingStarTimer > 180 && shootingStars.length < 3) {
        spawnShootingStar();
        shootingStarTimer = 0;
      }

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.life++;
        s.x += s.vx;
        s.y += s.vy;

        if (s.phase === 'in') {
          s.alpha = Math.min(s.alpha + 0.04, s.maxAlpha);
          if (s.alpha >= s.maxAlpha) s.phase = 'hold';
        } else if (s.phase === 'hold' && s.life > s.maxLife * 0.6) {
          s.phase = 'out';
        } else if (s.phase === 'out') {
          s.alpha -= 0.025;
        }

        if (s.alpha <= 0 || s.x < -100 || s.x > window.innerWidth + 100 || s.y > window.innerHeight + 50) {
          shootingStars.splice(i, 1);
          continue;
        }

        const angle = Math.atan2(s.vy, s.vx);
        const tailX = s.x - Math.cos(angle) * s.length;
        const tailY = s.y - Math.sin(angle) * s.length;

        const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
        grad.addColorStop(0, `rgba(180, 220, 255, 0)`);
        grad.addColorStop(0.7, `rgba(200, 230, 255, ${s.alpha * 0.5})`);
        grad.addColorStop(1, `rgba(240, 250, 255, ${s.alpha})`);

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(s.x, s.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Head glow
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240, 250, 255, ${s.alpha})`;
        ctx.fill();
      }
    }

    if (!prefersReducedMotion) {
      state.orbitalAnimationFrame = requestAnimationFrame(draw);
    }
  }

  resizeCanvas();
  buildStars();
  if (!prefersReducedMotion) {
    state.orbitalAnimationFrame = requestAnimationFrame(draw);
  } else {
    draw(0);
  }

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (state.orbitalAnimationFrame) cancelAnimationFrame(state.orbitalAnimationFrame);
      resizeCanvas();
      buildStars();
      if (!prefersReducedMotion) {
        state.orbitalAnimationFrame = requestAnimationFrame(draw);
      } else {
        draw(0);
      }
    }, 120);
  });
}

// ── Journey Panels — Left (launch) + Right (orbit) ───────────────────────────

function initJourneyPanels() {
  const pL = document.getElementById('journey-panel-left');
  const pR = document.getElementById('journey-panel');
  const cL = document.getElementById('journey-canvas-left');
  const cR = document.getElementById('journey-canvas');
  const lL = document.getElementById('journey-label-left');
  const lR = document.getElementById('journey-label');

  const pref = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ─── Shared helpers ─── */
  const W = 280;
  let H   = 0;
  const cl  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lr  = (a, b, t)   => a + (b - a) * cl(t, 0, 1);
  const ease = t => t < .5 ? 2*t*t : -1+(4-2*t)*t;
  const sin = Math.sin, cos = Math.cos, PI = Math.PI, rnd = Math.random;

  /* ─── LEFT canvas context ─── */
  const ctxL = cL ? cL.getContext('2d') : null;
  /* ─── RIGHT canvas context ─── */
  const ctxR = cR ? cR.getContext('2d') : null;

  /* ─── Stable star fields (seeded) ─── */
  const STARS_L = [], STARS_R = [];
  function seedStars(arr, seed) {
    arr.length = 0;
    for (let i = 0; i < 140; i++) {
      const h1 = Math.sin(i * (127.1 + seed) + 311.7) * 43758.5453;
      const h2 = Math.sin(i * (269.5 + seed) + 183.3) * 43758.5453;
      const h3 = Math.sin(i * (419.2 + seed) +  77.1) * 43758.5453;
      const h4 = Math.sin(i * (538.9 + seed) + 220.4) * 43758.5453;
      const frac = v => v - Math.floor(v);
      const temp = frac(Math.abs(h3));
      arr.push({
        x: frac(Math.abs(h1)) * W,
        y: frac(Math.abs(h2)) * H,
        r: 0.2 + frac(Math.abs(h4)) * 1.3,
        base: 0.15 + frac(Math.abs(h3)) * 0.7,
        twPhase: i * 0.74,
        twSpeed: 0.007 + frac(Math.abs(h4)) * 0.016,
        hue: temp < 0.2 ? 220 : temp < 0.5 ? 210 : temp < 0.75 ? 45 : 18,
        sat: temp < 0.2 ? 80 : temp < 0.5 ? 25 : temp < 0.75 ? 35 : 55,
      });
    }
  }

  /* ─── Phase labels ─── */
  const LEFT_LABELS  = ['Initialisation','Mise à feu','Décollage','Max-Q','Séparation','En transit'];
  const RIGHT_LABELS = ['En attente','Trajectoire','Approche','Déploiement','Déploiement','En orbite'];

  /* ─── Resize ─── */
  function resize() {
    H = (pL || pR).offsetHeight || (window.innerHeight - 57);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const [c, ctx] of [[cL, ctxL], [cR, ctxR]]) {
      if (!c || !ctx) continue;
      c.width  = Math.floor(W * dpr);
      c.height = Math.floor(H * dpr);
      c.style.width  = `${W}px`;
      c.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    seedStars(STARS_L, 0);
    seedStars(STARS_R, 99);
  }

  /* ════════════════════════════════════════════════════
     SHARED DRAWING HELPERS
  ════════════════════════════════════════════════════ */

  function drawSpace(ctx, alpha) {
    ctx.fillStyle = `rgba(1, 3, 10, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStarField(ctx, stars, depthRatio, tick) {
    for (const s of stars) {
      if (!pref) s.twPhase += s.twSpeed;
      const tw = 0.65 + 0.35 * sin(s.twPhase);
      const a  = s.base * tw * cl(depthRatio * 3, 0, 1);
      if (a < 0.02) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, 90%, ${a})`;
      ctx.fill();
      if (s.r > 1.15 && a > 0.4) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
        g.addColorStop(0, `hsla(${s.hue}, ${s.sat}%, 90%, ${a * 0.3})`);
        g.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 5, 0, PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  function drawNebula(ctx, nx, ny, r, colorA, colorB, alpha) {
    if (alpha < 0.01) return;
    const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
    g.addColorStop(0,   colorA.replace('A', `${alpha * 0.25})`));
    g.addColorStop(0.5, colorB.replace('A', `${alpha * 0.1})`));
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ─── Photorealistic Earth ─── */
  function drawEarth(ctx, cx, cy, r, alpha, tick) {
    if (alpha < 0.01 || r < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    // Atmosphere halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 2.0);
    halo.addColorStop(0,   'rgba(50, 140, 255, 0.32)');
    halo.addColorStop(0.4, 'rgba(30, 100, 220, 0.14)');
    halo.addColorStop(1,   'rgba(10, 40, 160, 0)');
    ctx.beginPath(); ctx.arc(cx, cy, r * 2.0, 0, PI * 2);
    ctx.fillStyle = halo; ctx.fill();

    // Ocean body
    const ocean = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, 0, cx, cy, r);
    ocean.addColorStop(0,   '#5ab5e8');
    ocean.addColorStop(0.35,'#1a6ec8');
    ocean.addColorStop(0.7, '#0c48a8');
    ocean.addColorStop(1,   '#061e60');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2);
    ctx.fillStyle = ocean; ctx.fill();

    // Clipped land + clouds
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.clip();

    ctx.globalAlpha = alpha * 0.82;
    ctx.fillStyle = '#2e7840';
    // Africa
    ctx.beginPath(); ctx.ellipse(cx+r*.08, cy-r*.05, r*.22, r*.32, -.2, 0, PI*2); ctx.fill();
    // Europe
    ctx.fillStyle = '#3a8848';
    ctx.beginPath(); ctx.ellipse(cx-r*.05, cy-r*.34, r*.15, r*.11, .5, 0, PI*2); ctx.fill();
    // Americas
    ctx.fillStyle = '#2a7038';
    ctx.beginPath(); ctx.ellipse(cx-r*.4, cy-r*.08, r*.13, r*.28, .3, 0, PI*2); ctx.fill();
    // Asia
    ctx.fillStyle = '#328042';
    ctx.beginPath(); ctx.ellipse(cx+r*.38, cy-r*.17, r*.26, r*.19, -.4, 0, PI*2); ctx.fill();

    // Clouds
    ctx.globalAlpha = alpha * 0.55;
    const cOff = tick * 0.00012;
    const cld = (ox, oy, w, h, a) => {
      ctx.save(); ctx.translate(cx+ox, cy+oy); ctx.rotate(a);
      const cg = ctx.createRadialGradient(0,0,0,0,0,w);
      cg.addColorStop(0,'rgba(255,255,255,0.9)');
      cg.addColorStop(0.5,'rgba(230,245,255,0.45)');
      cg.addColorStop(1,'rgba(200,225,255,0)');
      ctx.fillStyle=cg;
      ctx.beginPath(); ctx.ellipse(0,0,w,h,0,0,PI*2); ctx.fill();
      ctx.restore();
    };
    cld(r*.1+sin(cOff)*r*.04,  -r*.48, r*.28, r*.06,  .2);
    cld(-r*.3+cos(cOff)*r*.03,  r*.14, r*.24, r*.05, -.15);
    cld(r*.44+sin(cOff*1.3)*r*.02, r*.4, r*.2, r*.05, .4);

    // Night side
    ctx.globalAlpha = alpha;
    const night = ctx.createLinearGradient(cx+r*.1, cy-r, cx+r, cy+r*.2);
    night.addColorStop(0,'rgba(0,2,10,0)');
    night.addColorStop(.5,'rgba(0,2,10,0.3)');
    night.addColorStop(1,'rgba(0,2,10,0.78)');
    ctx.fillStyle = night;
    ctx.fillRect(cx-r, cy-r, r*2, r*2);

    ctx.restore(); // end clip

    // Rim glow
    const rim = ctx.createRadialGradient(cx, cy, r*.96, cx, cy, r*1.07);
    rim.addColorStop(0,'rgba(65, 165, 255, 0.52)');
    rim.addColorStop(.5,'rgba(45, 125, 220, 0.2)');
    rim.addColorStop(1,'rgba(25, 80, 180, 0)');
    ctx.beginPath(); ctx.arc(cx, cy, r*1.07, 0, PI*2);
    ctx.fillStyle = rim; ctx.fill();

    // Specular glint
    const spec = ctx.createRadialGradient(cx-r*.3, cy-r*.3, 0, cx-r*.3, cy-r*.3, r*.38);
    spec.addColorStop(0,'rgba(255,255,255,0.24)');
    spec.addColorStop(1,'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(cx-r*.3, cy-r*.3, r*.38, 0, PI*2);
    ctx.fillStyle = spec; ctx.fill();

    ctx.restore();
  }

  /* ─── Launch pad ─── */
  function drawPad(ctx, cx, top, alpha) {
    if (alpha < 0.01) return;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = '#1c3060';
    ctx.beginPath(); ctx.roundRect(cx-18, top, 36, 10, 2); ctx.fill();
    ctx.fillStyle = '#243a6a';
    ctx.fillRect(cx+10, top-42, 6, 42);
    ctx.strokeStyle = 'rgba(70,100,170,0.4)'; ctx.lineWidth = .7;
    for (let y = top-38; y < top; y += 9) {
      ctx.beginPath(); ctx.moveTo(cx+10,y); ctx.lineTo(cx+16,y+9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx+16,y); ctx.lineTo(cx+10,y+9); ctx.stroke();
    }
    ctx.fillStyle = '#1e3868';
    ctx.beginPath(); ctx.roundRect(cx-14,top-8,28,10,2); ctx.fill();
    ctx.restore();
  }

  /* ─── Falcon 9 rocket ─── */
  function drawRocket(ctx, cx, cy, scale, alpha, exh, tick, ratio) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Plume
    if (exh > 0.02) {
      const p = ctx.createRadialGradient(0, 40, 1, 0, 52, 32);
      p.addColorStop(0,  `rgba(255,255,200,${exh*.95})`);
      p.addColorStop(.2, `rgba(255,190,50, ${exh*.8})`);
      p.addColorStop(.5, `rgba(255,110,15, ${exh*.55})`);
      p.addColorStop(1,  'rgba(200,50,0,0)');
      ctx.beginPath(); ctx.ellipse(0,50,16+sin(tick*.28)*2,28+sin(tick*.22)*3,0,0,PI*2);
      ctx.fillStyle=p; ctx.fill();

      // Shock diamonds
      const sp = .5+.5*sin(tick*.42);
      ctx.globalAlpha = alpha * exh * (.55+sp*.35);
      ctx.fillStyle='rgba(255,245,180,.85)';
      ctx.beginPath(); ctx.ellipse(0,30+sp*3,5,7,0,0,PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,220,140,.65)';
      ctx.beginPath(); ctx.ellipse(0,42+sp*4,7,9,0,0,PI*2); ctx.fill();
      ctx.globalAlpha=alpha;
    }

    // First stage
    const bg = ctx.createLinearGradient(-7,-30,7,28);
    bg.addColorStop(0,'#eaf3ff'); bg.addColorStop(.5,'#ffffff'); bg.addColorStop(1,'#b5d8f8');
    ctx.beginPath(); ctx.roundRect(-7,-30,14,60,[1,1,0,0]); ctx.fillStyle=bg; ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.42)';
    ctx.beginPath(); ctx.roundRect(-3,-30,4,60,1); ctx.fill();
    ctx.fillStyle='#12162a'; ctx.fillRect(-7,-2,14,5);

    // Second stage
    const s2 = ctx.createLinearGradient(-5.5,-52,5.5,-30);
    s2.addColorStop(0,'#eff6ff'); s2.addColorStop(1,'#cce0f8');
    ctx.beginPath(); ctx.roundRect(-5.5,-52,11,22,[1,1,0,0]); ctx.fillStyle=s2; ctx.fill();

    // Nose fairing
    ctx.beginPath();
    ctx.moveTo(0,-73); ctx.bezierCurveTo(6,-67,5.5,-58,5.5,-52);
    ctx.lineTo(-5.5,-52); ctx.bezierCurveTo(-5.5,-58,-6,-67,0,-73); ctx.closePath();
    const ng=ctx.createLinearGradient(-5.5,-73,5.5,-52);
    ng.addColorStop(0,'#d5ecff'); ng.addColorStop(.5,'#f4feff'); ng.addColorStop(1,'#c5dff5');
    ctx.fillStyle=ng; ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.moveTo(0,-73); ctx.bezierCurveTo(2.5,-69,2.5,-62,2.5,-57);
    ctx.lineTo(-0.5,-57); ctx.bezierCurveTo(-0.5,-62,-0.5,-69,0,-73); ctx.closePath(); ctx.fill();

    // Grid fins
    const fd = cl((ratio-.36)*7,0,1);
    if (fd > 0) {
      ctx.globalAlpha = alpha*fd;
      const fg = ctx.createLinearGradient(-20,-10,20,5);
      fg.addColorStop(0,'#88aed8'); fg.addColorStop(1,'#5880a8');
      ctx.fillStyle=fg;
      for (const side of [-1,1]) {
        ctx.save(); ctx.translate(side*7,-12); ctx.rotate(side*.2);
        ctx.beginPath(); ctx.roundRect(side>0?0:-10,0,10,14,2); ctx.fill();
        ctx.strokeStyle='rgba(40,80,140,.5)'; ctx.lineWidth=.5;
        for (let gx=(side>0?2:-8);gx<(side>0?10:0);gx+=4) {
          ctx.beginPath(); ctx.moveTo(gx,1); ctx.lineTo(gx,13); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(side>0?1:-9,5); ctx.lineTo(side>0?9:-1,5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(side>0?1:-9,9); ctx.lineTo(side>0?9:-1,9); ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha=alpha;
    }

    // Legs
    ctx.fillStyle='rgba(155,190,230,.65)';
    ctx.beginPath(); ctx.moveTo(-7,26); ctx.lineTo(-12,31); ctx.lineTo(-8,31); ctx.lineTo(-7,27); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(7,26);  ctx.lineTo(12,31);  ctx.lineTo(8,31);  ctx.lineTo(7,27);  ctx.closePath(); ctx.fill();

    // Engine nozzle
    const nz = ctx.createLinearGradient(-7,26,7,32);
    nz.addColorStop(0,'#b0c8e8'); nz.addColorStop(1,'#6888a8');
    ctx.fillStyle=nz;
    ctx.beginPath(); ctx.moveTo(-5,26); ctx.lineTo(5,26); ctx.lineTo(4.5,31); ctx.lineTo(-4.5,31); ctx.closePath(); ctx.fill();

    // astr decal
    ctx.fillStyle='rgba(37,116,240,.5)'; ctx.fillRect(-5,5,10,4);
    ctx.fillStyle='rgba(255,255,255,.75)'; ctx.fillRect(-4,6,8,1.5);

    ctx.restore();
  }

  /* ─── ISS-style satellite ─── */
  function drawSatellite(ctx, cx, cy, scale, alpha, tick) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.rotate(sin(tick*.005)*.07);

    // Truss
    ctx.fillStyle='#c5d5e5'; ctx.strokeStyle='rgba(110,150,200,.45)'; ctx.lineWidth=.7;
    ctx.fillRect(-52,-3.5,104,7); ctx.strokeRect(-52,-3.5,104,7);
    ctx.strokeStyle='rgba(90,130,180,.3)'; ctx.lineWidth=.5;
    for (let tx=-46;tx<=46;tx+=13) { ctx.beginPath(); ctx.moveTo(tx,-3.5); ctx.lineTo(tx,3.5); ctx.stroke(); }

    // Solar panels
    for (const [px,pw,dir] of [[-52,38,-1],[14,38,1]]) {
      for (const row of [-1,1]) {
        const ph=row*18;
        const pg=ctx.createLinearGradient(px,0,px+pw,ph);
        pg.addColorStop(0,'#0e2e98'); pg.addColorStop(.4,'#1558d0'); pg.addColorStop(1,'#1040a0');
        ctx.fillStyle=pg; ctx.fillRect(px,row===1?3.5:-3.5+ph,pw,Math.abs(ph));
        ctx.strokeStyle='rgba(90,160,255,.35)'; ctx.lineWidth=.5;
        for (let gx=px+7;gx<px+pw;gx+=7) { ctx.beginPath(); ctx.moveTo(gx,row===1?3.5:ph-3.5); ctx.lineTo(gx,row===1?ph+3.5:0-3.5); ctx.stroke(); }
        ctx.fillStyle='rgba(80,155,255,.08)'; ctx.fillRect(px,row===1?3.5:-3.5+ph,pw*.3,Math.abs(ph));
      }
      ctx.strokeStyle='rgba(130,195,255,.38)'; ctx.lineWidth=.7;
      ctx.strokeRect(px,-21.5,pw,43);
    }

    // Central hab
    const hg=ctx.createLinearGradient(-15,-11,15,11);
    hg.addColorStop(0,'#e2ecf8'); hg.addColorStop(.4,'#ffffff'); hg.addColorStop(1,'#b5cee8');
    ctx.fillStyle=hg; ctx.strokeStyle='rgba(130,185,235,.5)'; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.roundRect(-15,-11,30,22,5); ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.3)';
    ctx.beginPath(); ctx.roundRect(-13,-11,11,22,[5,0,0,5]); ctx.fill();
    for (const wx of [-6,0,6]) {
      ctx.beginPath(); ctx.arc(wx,0,3.2,0,PI*2); ctx.fillStyle='#0e3898'; ctx.fill();
      ctx.beginPath(); ctx.arc(wx,0,1.8,0,PI*2); ctx.fillStyle='#3a88d0'; ctx.fill();
      ctx.beginPath(); ctx.arc(wx-.7,-.7,.8,0,PI*2); ctx.fillStyle='rgba(255,255,255,.55)'; ctx.fill();
    }

    // Radiators
    for (const side of [-1,1]) {
      const rx=side*17;
      const rg=ctx.createLinearGradient(rx,-7,rx+side*12,7);
      rg.addColorStop(0,'#e5f2ff'); rg.addColorStop(1,'#aecce0');
      ctx.fillStyle=rg; ctx.fillRect(rx,-7,side*13,14);
      ctx.strokeStyle='rgba(95,155,205,.4)'; ctx.lineWidth=.5;
      for (let ry=-5;ry<=5;ry+=3.5) { ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx+side*13,ry); ctx.stroke(); }
    }

    // Antenna dish
    ctx.beginPath(); ctx.arc(3,-14,7,PI,PI*2);
    ctx.strokeStyle='rgba(175,218,255,.85)'; ctx.lineWidth=1.1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,-14); ctx.lineTo(3,-8); ctx.stroke();

    ctx.restore();
  }

  /* ─── Orbit ring ─── */
  function drawOrbit(ctx, cx, cy, rx, ry, alpha) {
    if (alpha < 0.01) return;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, PI*2);
    ctx.strokeStyle='rgba(80,155,255,.38)'; ctx.lineWidth=1;
    ctx.setLineDash([6,10]); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  /* ─── Contrail ─── */
  function drawContrail(ctx, x1,y1,x2,y2,alpha) {
    if (alpha < 0.01) return;
    const g=ctx.createLinearGradient(x1,y1,x2,y2);
    g.addColorStop(0,'rgba(120,180,255,0)');
    g.addColorStop(.7,`rgba(160,205,255,${alpha*.22})`);
    g.addColorStop(1,`rgba(200,230,255,${alpha*.48})`);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.strokeStyle=g; ctx.lineWidth=2; ctx.stroke();
  }

  /* ─── Exhaust particles (shared pool) ─── */
  const PARTS = [];
  function emitExhaust(cx,cy,sc,intensity) {
    if (pref || intensity<.08 || PARTS.length>200) return;
    for (let i=0;i<3;i++) {
      PARTS.push({
        x:cx+(rnd()-.5)*4*sc, y:cy+26*sc,
        vx:(rnd()-.5)*1.5, vy:rnd()*2.2+.5,
        life:1, r:(rnd()*3+1)*sc, hue:16+rnd()*22
      });
    }
  }
  function tickParticles(ctx) {
    for (let i=PARTS.length-1;i>=0;i--) {
      const p=PARTS[i];
      p.x+=p.vx; p.y+=p.vy; p.vy+=.04; p.life-=.032; p.r*=.996;
      if (p.life<=0||p.r<.15){PARTS.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,PI*2);
      ctx.fillStyle=`hsla(${p.hue},90%,${55+p.life*28}%,${p.life*.78})`;
      ctx.fill();
    }
  }

  /* ════════════════════════════════════════════════════
     LEFT CANVAS — Launch phase (steps 1 → 6)
  ════════════════════════════════════════════════════ */
  function renderLeft(ratio, tick) {
    if (!ctxL) return;
    const ctx = ctxL;
    ctx.clearRect(0, 0, W, H);

    // Space deepens as we ascend
    drawSpace(ctx, lr(.08, .85, ratio));

    // Stars (sparse at launch, dense in space)
    drawStarField(ctx, STARS_L, ratio, tick);

    // Nebula hints
    drawNebula(ctx, W*.65, H*.22, 90,
      'rgba(30,80,200,A', 'rgba(15,50,140,A', cl((ratio-.2)*2,0,1));

    // Atmosphere gradient at bottom (fades as we go higher)
    const atmA = cl(1-ratio*2, 0, 1);
    if (atmA > 0) {
      const atm = ctx.createLinearGradient(0, H-H*lr(.5,.1,ratio), 0, H);
      atm.addColorStop(0,'rgba(8,35,100,0)');
      atm.addColorStop(.4,`rgba(18,75,200,${atmA*.28})`);
      atm.addColorStop(1,`rgba(45,130,255,${atmA*.55})`);
      ctx.fillStyle=atm; ctx.fillRect(0,0,W,H);
    }

    // Earth — visible at bottom, zooms out and fades
    const eBaseR = cl(W*.32, 50, 90);
    const eScale = lr(1, .28, ease(ratio));
    const eR     = eBaseR * eScale;
    const eY     = H - 20 + eBaseR*(1-eScale)*.8;
    const eAlpha = cl(1 - ratio*1.5, .05, 1);
    drawEarth(ctx, W*.5, eY, eR, eAlpha, tick);

    // Launchpad
    drawPad(ctx, W*.5, eY-eR, cl(1-ratio*20,0,1));

    // Rocket — ascends from Earth surface to top of panel
    const rStartY = eY - eR - 18;
    const rEndY   = H * .06;
    const rY      = lr(rStartY, rEndY, ease(cl(ratio*1.4,0,1)));
    const rX      = W*.5 + sin(ease(ratio)*PI*.5)*14;
    const rScale  = lr(.82, .48, ratio);
    const rAlpha  = cl(ratio < .52 ? 1 : 1-(ratio-.52)*5, 0, 1);
    const exh     = pref ? .8 : cl(ratio<.48? .6+.4*sin(tick*.28) : (1-ratio)*5, 0, 1);

    drawContrail(ctx, W*.5, eY-eR, rX, rY+24*rScale, cl(ratio*3,0,1));
    drawRocket(ctx, rX, rY, rScale, rAlpha, exh, tick, ratio);
    emitExhaust(rX, rY, rScale, exh);
    tickParticles(ctx);

    // Stage separation flash ~step 4
    const sepF = cl((ratio-.3)/.05,0,1)*cl(1-(ratio-.38)/.05,0,1);
    if (sepF > 0) {
      const sg = ctx.createRadialGradient(rX,rY,0,rX,rY,32);
      sg.addColorStop(0,`rgba(255,200,100,${sepF*.85})`);
      sg.addColorStop(.4,`rgba(255,120,40,${sepF*.4})`);
      sg.addColorStop(1,'rgba(255,80,0,0)');
      ctx.beginPath(); ctx.arc(rX,rY,32,0,PI*2); ctx.fillStyle=sg; ctx.fill();
    }

    // Right-edge fade into main content
    const re=ctx.createLinearGradient(W-46,0,W,0);
    re.addColorStop(0,'rgba(2,5,14,0)');
    re.addColorStop(1,'rgba(2,5,14,.72)');
    ctx.fillStyle=re; ctx.fillRect(W-46,0,46,H);

    // Label
    if (lL) {
      const idx = cl(Math.floor(ratio*LEFT_LABELS.length),0,LEFT_LABELS.length-1);
      lL.textContent = LEFT_LABELS[idx];
    }
  }

  /* ════════════════════════════════════════════════════
     RIGHT CANVAS — Orbit phase (steps 6 → 11)
     Rocket "arrives" from left edge, deploys as satellite
  ════════════════════════════════════════════════════ */
  function renderRight(ratio, tick) {
    if (!ctxR) return;
    const ctx = ctxR;
    ctx.clearRect(0, 0, W, H);

    // Deep space background — darker at start, fully revealed
    drawSpace(ctx, lr(.04, .9, ratio));

    // Stars
    drawStarField(ctx, STARS_R, cl(ratio*2,0,1), tick);

    // Nebula
    drawNebula(ctx, W*.38, H*.3, 100,
      'rgba(25,65,190,A','rgba(14,40,130,A', cl((ratio-.1)*1.5,0,1));
    drawNebula(ctx, W*.72, H*.55, 70,
      'rgba(60,25,180,A','rgba(30,10,110,A', cl((ratio-.25)*2,0,1));

    // Earth visible at very bottom of right panel (thin limb glow)
    const limbA = cl(ratio * 2.5, 0, .7);
    if (limbA > 0) {
      const earthY = H + W*.4;
      drawEarth(ctx, W*.5, earthY, W*.48, limbA*.6, tick);
    }

    // Orbit ring
    const orbitCY = H * .2;
    const orbitA = cl((ratio-.45)*3.5,0,1);
    drawOrbit(ctx, W*.5, orbitCY, 68, 18, orbitA);

    // ── Rocket arrives from the LEFT edge ──
    // ratio 0.45: rocket enters left edge at mid-height
    // ratio 0.72: rocket reaches orbit position (top-center)
    const arriveT  = cl((ratio-.45)/.27, 0, 1);
    const rocketA  = cl(ratio<.45?0:ratio<.78?arriveT:1-(ratio-.78)*6, 0, 1);
    if (rocketA > 0) {
      // Path: enters from (0, H*.55) → curves up to (W*.5, orbitCY)
      const rx = lr(-20, W*.5, ease(arriveT));
      const ry = lr(H*.55, orbitCY, ease(arriveT));
      const rScale = lr(.3, .5, arriveT);
      const exh = pref?.75: cl(ratio<.72?.55+.45*sin(tick*.28):(1-ratio)*4,0,1);

      drawContrail(ctx, 0, H*.55, rx, ry+24*rScale, rocketA*.7);
      drawRocket(ctx, rx, ry, rScale, rocketA, exh, tick, ratio);
      emitExhaust(rx, ry, rScale, exh*rocketA);
    }

    // Satellite deploys from ~step 9
    const satA = cl((ratio-.75)/.25, 0, 1);
    if (satA > 0) {
      const angle  = tick * .009;
      const satX   = W*.5 + cos(angle)*68;
      const satY   = orbitCY + sin(angle)*18;
      const satSc  = lr(0, .8, satA);
      drawSatellite(ctx, satX, satY, satSc, satA, tick);

      // Orbital sunrise
      if (satA > .45) {
        const sunPhase = (satA-.45)/.55;
        const sunA = sunPhase * (.55+.45*sin(angle*1.5));
        const sg = ctx.createRadialGradient(W*.85, orbitCY-28, 0, W*.85, orbitCY-28, 52);
        sg.addColorStop(0,`rgba(255,205,85,${sunA*.6})`);
        sg.addColorStop(.4,`rgba(255,148,45,${sunA*.28})`);
        sg.addColorStop(1,'rgba(255,80,0,0)');
        ctx.beginPath(); ctx.arc(W*.85, orbitCY-28, 52, 0, PI*2);
        ctx.fillStyle=sg; ctx.fill();
      }
    }

    // Particle tick (shared pool draws on ctxR too)
    if (rocketA > 0) tickParticles(ctx);

    // Left-edge fade
    const le=ctx.createLinearGradient(0,0,46,0);
    le.addColorStop(0,'rgba(2,5,14,.72)');
    le.addColorStop(1,'rgba(2,5,14,0)');
    ctx.fillStyle=le; ctx.fillRect(0,0,46,H);

    // Label
    if (lR) {
      const idx = cl(Math.floor(ratio*RIGHT_LABELS.length),0,RIGHT_LABELS.length-1);
      lR.textContent = RIGHT_LABELS[idx];
    }
  }

  /* ════════════════════════════════════════════════════
     MAIN LOOP
  ════════════════════════════════════════════════════ */
  let tick = 0;
  function loop() {
    tick++;
    const ratio = cl((state.currentStep-1)/(TOTAL_STEPS-1), 0, 1);
    renderLeft(ratio, tick);
    renderRight(ratio, tick);
    state.journeyAnimFrame = requestAnimationFrame(loop);
  }

  resize();
  if (pref) {
    const r0 = cl((state.currentStep-1)/(TOTAL_STEPS-1),0,1);
    renderLeft(r0,0); renderRight(r0,0);
  } else {
    loop();
  }

  let rzt;
  window.addEventListener('resize', () => {
    clearTimeout(rzt);
    rzt = setTimeout(() => {
      if (state.journeyAnimFrame) cancelAnimationFrame(state.journeyAnimFrame);
      resize();
      pref ? (()=>{const r=cl((state.currentStep-1)/(TOTAL_STEPS-1),0,1);renderLeft(r,0);renderRight(r,0);})() : loop();
    }, 100);
  });
}

// ── Legacy stub (replaced by initJourneyPanels) ──────────────────────────────
function initJourneyCanvas() {
  const panel  = document.getElementById('journey-panel');
  const canvas = document.getElementById('journey-canvas');
  const label  = document.getElementById('journey-label');
  if (!panel || !canvas) return;

  const pref = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 320;
  let H = 0;
  const ctx = canvas.getContext('2d');

  /* ─── helpers ─── */
  const cl  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lr  = (a, b, t)   => a + (b - a) * cl(t, 0, 1);
  const ease = t => t < .5 ? 2*t*t : -1+(4-2*t)*t;
  const sin  = Math.sin, cos = Math.cos, PI = Math.PI, rnd = Math.random;

  /* ─── star field (seeded, stable across frames) ─── */
  const STARS = [];
  function buildStars() {
    STARS.length = 0;
    // deterministic pseudo-random using index as seed
    for (let i = 0; i < 180; i++) {
      const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const s2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      const s3 = Math.sin(i * 419.2 + 77.1)  * 43758.5453;
      const s4 = Math.sin(i * 538.9 + 220.4) * 43758.5453;
      const s5 = Math.sin(i * 672.3 + 99.2)  * 43758.5453;
      const frac = v => v - Math.floor(v);
      // Star color temperature variety
      const temp = frac(Math.abs(s3));
      let hue, sat;
      if (temp < 0.15)      { hue = 220; sat = 80; }  // blue giants
      else if (temp < 0.45) { hue = 210; sat = 30; }  // white
      else if (temp < 0.72) { hue = 45;  sat = 40; }  // yellow
      else                  { hue = 20;  sat = 60; }  // orange/red dwarfs
      STARS.push({
        x: frac(Math.abs(s))  * W,
        y: frac(Math.abs(s2)) * H,
        r: 0.25 + frac(Math.abs(s4)) * 1.35,
        base: 0.18 + frac(Math.abs(s5)) * 0.72,
        twPhase: i * 0.74,
        twSpeed: 0.008 + frac(Math.abs(s3)) * 0.018,
        hue, sat,
      });
    }
  }

  /* ─── phase labels ─── */
  const LABELS = [
    'Initialisation', 'Mise à feu', 'Décollage',
    'Percée atmosphérique', 'Max-Q', 'Coupure moteur',
    'Séparation du premier étage', 'Trajectoire orbitale',
    'Approche satellite', 'Déploiement solaire', 'En orbite',
  ];

  /* ─── resize ─── */
  function resize() {
    H = panel.offsetHeight || (window.innerHeight - 57);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
  }

  /* ════════════════════════════════════════════════════
     DRAWING PRIMITIVES
  ════════════════════════════════════════════════════ */

  /* ─── Deep space background with Milky Way ─── */
  function drawBackground(ratio) {
    // Base void
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, W, H);

    // Milky Way band (diagonal, fades in after launch)
    const mwA = cl((ratio - 0.15) * 1.4, 0, 0.55);
    if (mwA > 0) {
      const mw = ctx.createLinearGradient(0, H*0.1, W, H*0.65);
      mw.addColorStop(0,   `rgba(10, 20, 60, 0)`);
      mw.addColorStop(0.3, `rgba(18, 35, 80, ${mwA * 0.5})`);
      mw.addColorStop(0.5, `rgba(22, 42, 95, ${mwA})`);
      mw.addColorStop(0.7, `rgba(18, 35, 80, ${mwA * 0.5})`);
      mw.addColorStop(1,   `rgba(10, 20, 60, 0)`);
      ctx.fillStyle = mw;
      ctx.fillRect(0, 0, W, H);

      // Fine star dust on the band
      ctx.fillStyle = `rgba(200, 220, 255, ${mwA * 0.06})`;
      for (let i = 0; i < 80; i++) {
        const bx = (sin(i * 37.9) * 0.5 + 0.5) * W;
        const by = (sin(i * 53.1 + 1.2) * 0.5 + 0.5) * H;
        ctx.fillRect(bx, by, 0.6, 0.6);
      }
    }

    // Atmosphere near Earth bottom — blue limb glow
    const atmH = H * lr(0.38, 0.12, ratio);
    if (atmH > 0) {
      const atm = ctx.createLinearGradient(0, H - atmH, 0, H);
      atm.addColorStop(0, 'rgba(10, 40, 110, 0)');
      atm.addColorStop(0.4, `rgba(20, 80, 200, ${lr(0.28, 0.06, ratio)})`);
      atm.addColorStop(0.75, `rgba(35, 110, 230, ${lr(0.45, 0.08, ratio)})`);
      atm.addColorStop(1, `rgba(50, 140, 255, ${lr(0.55, 0.10, ratio)})`);
      ctx.fillStyle = atm;
      ctx.fillRect(0, H - atmH, W, atmH);
    }
  }

  /* ─── Star field with twinkling ─── */
  function drawStars(ratio, tick) {
    const depthAlpha = cl(ratio * 2.8 + 0.08, 0, 1);
    for (const s of STARS) {
      if (!pref) s.twPhase += s.twSpeed;
      const tw = 0.65 + 0.35 * sin(s.twPhase);
      const a  = s.base * tw * depthAlpha;
      if (a < 0.02) continue;

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, 90%, ${a})`;
      ctx.fill();

      // Glow halo on bright stars
      if (s.r > 1.1 && a > 0.35) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
        g.addColorStop(0, `hsla(${s.hue}, ${s.sat}%, 90%, ${a * 0.35})`);
        g.addColorStop(1, `hsla(${s.hue}, ${s.sat}%, 90%, 0)`);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 5, 0, PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // Diffraction cross on very bright stars
        if (s.r > 1.4 && a > 0.55) {
          ctx.strokeStyle = `hsla(${s.hue}, 50%, 95%, ${a * 0.28})`;
          ctx.lineWidth = 0.5;
          const size = s.r * 8;
          ctx.beginPath();
          ctx.moveTo(s.x - size, s.y); ctx.lineTo(s.x + size, s.y);
          ctx.moveTo(s.x, s.y - size); ctx.lineTo(s.x, s.y + size);
          ctx.stroke();
        }
      }
    }
  }

  /* ─── Photorealistic Earth ─── */
  function drawEarth(cx, cy, r, alpha, tick) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer glow / halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 2.1);
    halo.addColorStop(0,   'rgba(40, 120, 255, 0.28)');
    halo.addColorStop(0.35,'rgba(30, 90, 220, 0.14)');
    halo.addColorStop(0.7, 'rgba(20, 60, 180, 0.05)');
    halo.addColorStop(1,   'rgba(10, 30, 120, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.1, 0, PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // Deep ocean base
    const ocean = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, 0, cx, cy, r);
    ocean.addColorStop(0,   '#4a9fd4');
    ocean.addColorStop(0.3, '#1e6fc2');
    ocean.addColorStop(0.65,'#0d4a9e');
    ocean.addColorStop(1,   '#062060');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, PI * 2);
    ctx.fillStyle = ocean;
    ctx.fill();

    // Clipping for land & clouds
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, PI * 2);
    ctx.clip();

    // ── Land masses ──
    ctx.globalAlpha = alpha * 0.88;

    // Africa / Europe shape
    ctx.fillStyle = '#2d7a3a';
    ctx.beginPath();
    ctx.ellipse(cx + r*0.08, cy - r*0.05, r*0.22, r*0.35, -0.2, 0, PI*2);
    ctx.fill();
    // Europe lobe
    ctx.fillStyle = '#3d8f45';
    ctx.beginPath();
    ctx.ellipse(cx - r*0.04, cy - r*0.35, r*0.16, r*0.12, 0.5, 0, PI*2);
    ctx.fill();
    // Americas
    ctx.fillStyle = '#2a6e34';
    ctx.beginPath();
    ctx.ellipse(cx - r*0.42, cy - r*0.1, r*0.14, r*0.3, 0.3, 0, PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - r*0.48, cy + r*0.22, r*0.11, r*0.18, -0.15, 0, PI*2);
    ctx.fill();
    // Asia
    ctx.fillStyle = '#348040';
    ctx.beginPath();
    ctx.ellipse(cx + r*0.38, cy - r*0.18, r*0.28, r*0.2, -0.4, 0, PI*2);
    ctx.fill();
    // Australia
    ctx.fillStyle = '#c8a030';
    ctx.beginPath();
    ctx.ellipse(cx + r*0.44, cy + r*0.3, r*0.12, r*0.08, 0.3, 0, PI*2);
    ctx.fill();

    // ── Cloud wisps ──
    ctx.globalAlpha = alpha * 0.6;
    const cloudOff = tick * 0.00015; // very slow drift
    const cloudPath = (ox, oy, w, h, a) => {
      ctx.save();
      ctx.translate(cx + ox, cy + oy);
      ctx.rotate(a);
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
      cg.addColorStop(0, 'rgba(255,255,255,0.85)');
      cg.addColorStop(0.5,'rgba(230,240,255,0.4)');
      cg.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(0, 0, w, h, 0, 0, PI*2);
      ctx.fill();
      ctx.restore();
    };
    cloudPath(r*0.1  + sin(cloudOff)*r*0.04, -r*0.5, r*0.3, r*0.06, 0.2);
    cloudPath(-r*0.3 + cos(cloudOff)*r*0.03,  r*0.15, r*0.25, r*0.05, -0.15);
    cloudPath(r*0.45 + sin(cloudOff*1.3)*r*0.02, r*0.42, r*0.22, r*0.05, 0.4);
    cloudPath(-r*0.05+ cos(cloudOff*0.8)*r*0.03, -r*0.25, r*0.32, r*0.07, -0.3);

    // ── Night side with city lights ──
    ctx.globalAlpha = alpha;
    const night = ctx.createLinearGradient(cx + r*0.2, cy - r, cx + r, cy + r*0.2);
    night.addColorStop(0,   'rgba(0,3,12,0)');
    night.addColorStop(0.45,'rgba(0,3,12,0.25)');
    night.addColorStop(0.7, 'rgba(0,3,12,0.62)');
    night.addColorStop(1,   'rgba(0,3,12,0.82)');
    ctx.fillStyle = night;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // City lights on dark side
    ctx.globalAlpha = alpha * 0.7;
    const cityData = [
      [0.52, -0.18], [0.42, -0.28], [0.55, -0.08],  // Europe
      [0.48,  0.04], [0.38,  0.10],                   // Middle East
      [0.62, -0.25], [0.70, -0.15],                   // Asia
    ];
    for (const [ox, oy] of cityData) {
      const lx = cx + r * ox, ly = cy + r * oy;
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 0.08);
      lg.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
      lg.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.beginPath();
      ctx.arc(lx, ly, r * 0.08, 0, PI * 2);
      ctx.fillStyle = lg;
      ctx.fill();
    }

    ctx.restore();

    // Thin atmosphere rim (drawn outside clip)
    ctx.save();
    ctx.globalAlpha = alpha;
    const rim = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.08);
    rim.addColorStop(0,   'rgba(60, 160, 255, 0.55)');
    rim.addColorStop(0.5, 'rgba(40, 120, 220, 0.22)');
    rim.addColorStop(1,   'rgba(20, 80, 180, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, 0, PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();

    // Specular highlight (sun glint on ocean)
    const spec = ctx.createRadialGradient(cx - r*0.32, cy - r*0.32, 0, cx - r*0.32, cy - r*0.32, r * 0.4);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(cx - r*0.32, cy - r*0.32, r * 0.4, 0, PI * 2);
    ctx.fillStyle = spec;
    ctx.fill();
    ctx.restore();
  }

  /* ─── Launch pad & infrastructure ─── */
  function drawLaunchpad(cx, earthTop, alpha) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    const base = earthTop + 4;
    // Flame trench
    const trench = ctx.createLinearGradient(cx - 20, base, cx - 20, base + 16);
    trench.addColorStop(0, '#1a1a2e');
    trench.addColorStop(1, '#0d0d1a');
    ctx.fillStyle = trench;
    ctx.beginPath();
    ctx.roundRect(cx - 20, base, 40, 16, [0, 0, 4, 4]);
    ctx.fill();

    // Launch mount table
    ctx.fillStyle = '#2a3a5e';
    ctx.beginPath();
    ctx.roundRect(cx - 16, base - 8, 32, 12, 2);
    ctx.fill();
    // Sheen
    ctx.fillStyle = 'rgba(140, 170, 220, 0.12)';
    ctx.beginPath();
    ctx.roundRect(cx - 16, base - 8, 32, 4, [2, 2, 0, 0]);
    ctx.fill();

    // Hold-down arms
    for (const ox of [-11, -5, 5, 11]) {
      ctx.fillStyle = '#1e3060';
      ctx.fillRect(cx + ox - 1.5, base - 18, 3, 12);
    }

    // Support tower
    const tw = ctx.createLinearGradient(cx + 14, base - 50, cx + 20, base);
    tw.addColorStop(0, '#283a60');
    tw.addColorStop(1, '#1a2848');
    ctx.fillStyle = tw;
    ctx.fillRect(cx + 14, base - 50, 8, 50);
    // Tower cross braces
    ctx.strokeStyle = 'rgba(80, 110, 180, 0.4)';
    ctx.lineWidth = 0.8;
    for (let y = base - 45; y < base; y += 10) {
      ctx.beginPath();
      ctx.moveTo(cx + 14, y);
      ctx.lineTo(cx + 22, y + 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 22, y);
      ctx.lineTo(cx + 14, y + 10);
      ctx.stroke();
    }
    // Service arm
    ctx.fillStyle = '#2a4070';
    ctx.fillRect(cx + 8, base - 38, 8, 4);

    ctx.restore();
  }

  /* ─── Falcon 9 style rocket ─── */
  function drawRocket(cx, cy, scale, alpha, exhaustIntensity, tick, ratio) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const S = 1; // uniform inner scale

    /* ── Plume / exhaust ── */
    if (exhaustIntensity > 0.02) {
      // Outer plume bell
      const p1 = ctx.createRadialGradient(0, 42, 2, 0, 55, 38);
      p1.addColorStop(0,   `rgba(255, 255, 200, ${exhaustIntensity * 0.95})`);
      p1.addColorStop(0.15,`rgba(255, 200, 60,  ${exhaustIntensity * 0.85})`);
      p1.addColorStop(0.4, `rgba(255, 120, 20,  ${exhaustIntensity * 0.6})`);
      p1.addColorStop(0.75,`rgba(200, 60, 0,    ${exhaustIntensity * 0.28})`);
      p1.addColorStop(1,   'rgba(150, 30, 0, 0)');
      ctx.beginPath();
      ctx.ellipse(0, 52, 18 + sin(tick*0.3)*2, 30 + sin(tick*0.25)*3, 0, 0, PI*2);
      ctx.fillStyle = p1;
      ctx.fill();

      // Shock diamond 1
      const shockPulse = 0.5 + 0.5 * sin(tick * 0.45);
      ctx.globalAlpha = alpha * exhaustIntensity * (0.55 + shockPulse * 0.35);
      ctx.fillStyle = 'rgba(255, 240, 180, 0.8)';
      ctx.beginPath();
      ctx.ellipse(0, 32 + shockPulse * 3, 5, 7, 0, 0, PI*2);
      ctx.fill();
      // Shock diamond 2
      ctx.fillStyle = 'rgba(255, 220, 140, 0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 44 + shockPulse * 4, 7, 9, 0, 0, PI*2);
      ctx.fill();
      ctx.globalAlpha = alpha;

      // Engine glow wash on rocket body
      const eng = ctx.createRadialGradient(0, 25, 0, 0, 25, 24);
      eng.addColorStop(0, `rgba(255, 180, 40, ${exhaustIntensity * 0.32})`);
      eng.addColorStop(1, 'rgba(255, 120, 0, 0)');
      ctx.beginPath();
      ctx.arc(0, 25, 24, 0, PI*2);
      ctx.fillStyle = eng;
      ctx.fill();
    }

    /* ── First stage body ── */
    const bodyG = ctx.createLinearGradient(-7, -30, 7, 28);
    bodyG.addColorStop(0,   '#e8f2ff');
    bodyG.addColorStop(0.25,'#ffffff');
    bodyG.addColorStop(0.5, '#f4f9ff');
    bodyG.addColorStop(0.75,'#dceeff');
    bodyG.addColorStop(1,   '#b8d8f8');
    ctx.beginPath();
    ctx.roundRect(-7, -30, 14, 60, [1, 1, 0, 0]);
    ctx.fillStyle = bodyG;
    ctx.fill();

    // Metallic highlight strip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.roundRect(-3, -30, 4, 60, 1);
    ctx.fill();

    // Black interstage band
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(-7, -2, 14, 5);
    ctx.fillStyle = 'rgba(80, 120, 200, 0.25)';
    ctx.fillRect(-7, -2, 14, 2);

    /* ── Second stage ── */
    const s2G = ctx.createLinearGradient(-5.5, -52, 5.5, -30);
    s2G.addColorStop(0, '#f0f6ff');
    s2G.addColorStop(1, '#cce0f8');
    ctx.beginPath();
    ctx.roundRect(-5.5, -52, 11, 22, [1, 1, 0, 0]);
    ctx.fillStyle = s2G;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.roundRect(-2.5, -52, 3, 22, 1);
    ctx.fill();

    /* ── Fairing nose cone ── */
    ctx.beginPath();
    ctx.moveTo(0, -74);
    ctx.bezierCurveTo(6, -68, 5.5, -58, 5.5, -52);
    ctx.lineTo(-5.5, -52);
    ctx.bezierCurveTo(-5.5, -58, -6, -68, 0, -74);
    ctx.closePath();
    const noseG = ctx.createLinearGradient(-5.5, -74, 5.5, -52);
    noseG.addColorStop(0,   '#d8eeff');
    noseG.addColorStop(0.5, '#f5feff');
    noseG.addColorStop(1,   '#c8dff5');
    ctx.fillStyle = noseG;
    ctx.fill();
    // Nose specular
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -74);
    ctx.bezierCurveTo(2.5, -70, 2.5, -63, 2.5, -58);
    ctx.lineTo(-0.5, -58);
    ctx.bezierCurveTo(-0.5, -63, -0.5, -70, 0, -74);
    ctx.closePath();
    ctx.fill();

    /* ── Grid fins (deployed at ratio > 0.4) ── */
    const finDeploy = cl((ratio - 0.38) * 6, 0, 1);
    if (finDeploy > 0) {
      ctx.globalAlpha = alpha * finDeploy;
      const finG = ctx.createLinearGradient(-20, -10, 20, 5);
      finG.addColorStop(0, '#8ab0d8');
      finG.addColorStop(1, '#5a80aa');
      ctx.fillStyle = finG;
      // Left fin
      ctx.save();
      ctx.translate(-7, -12);
      ctx.rotate(-0.2);
      ctx.beginPath();
      ctx.roundRect(-10, 0, 10, 14, 2);
      ctx.fill();
      // Grid lines
      ctx.strokeStyle = 'rgba(40,80,140,0.5)';
      ctx.lineWidth = 0.5;
      for (let gx = -8; gx < 0; gx += 4) {
        ctx.beginPath(); ctx.moveTo(gx, 1); ctx.lineTo(gx, 13); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-9, 5); ctx.lineTo(-1, 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, 9); ctx.lineTo(-1, 9); ctx.stroke();
      ctx.restore();
      // Right fin
      ctx.save();
      ctx.translate(7, -12);
      ctx.rotate(0.2);
      ctx.beginPath();
      ctx.roundRect(0, 0, 10, 14, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,80,140,0.5)';
      ctx.lineWidth = 0.5;
      for (let gx = 2; gx < 10; gx += 4) {
        ctx.beginPath(); ctx.moveTo(gx, 1); ctx.lineTo(gx, 13); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(1, 5); ctx.lineTo(9, 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, 9); ctx.lineTo(9, 9); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    /* ── Landing legs (folded close to body) ── */
    ctx.fillStyle = 'rgba(160, 195, 235, 0.65)';
    ctx.beginPath();
    ctx.moveTo(-7, 26);
    ctx.lineTo(-11, 30);
    ctx.lineTo(-8, 30);
    ctx.lineTo(-7, 27);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(7, 26);
    ctx.lineTo(11, 30);
    ctx.lineTo(8, 30);
    ctx.lineTo(7, 27);
    ctx.closePath();
    ctx.fill();

    /* ── Engine cluster (9 Merlin engines) ── */
    const nozzleG = ctx.createLinearGradient(-7, 26, 7, 32);
    nozzleG.addColorStop(0, '#b0c8e8');
    nozzleG.addColorStop(1, '#6888a8');
    ctx.fillStyle = nozzleG;
    // Center
    ctx.beginPath();
    ctx.moveTo(-5, 26); ctx.lineTo(5, 26); ctx.lineTo(4.5, 31); ctx.lineTo(-4.5, 31); ctx.closePath();
    ctx.fill();
    // Hexagonal cluster hint
    ctx.strokeStyle = 'rgba(60, 100, 160, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-4, 27); ctx.lineTo(-1.5, 27);
    ctx.moveTo(1.5, 27); ctx.lineTo(4, 27);
    ctx.moveTo(0, 26.5); ctx.lineTo(0, 31);
    ctx.stroke();

    /* ── astr.studio decal ── */
    ctx.fillStyle = 'rgba(37, 116, 240, 0.55)';
    ctx.fillRect(-5, 5, 10, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(-4, 6, 8, 1.5);

    ctx.restore();
  }

  /* ─── Stage separation flash ─── */
  function drawStageSep(cx, cy, alpha) {
    if (alpha < 0.01) return;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
    g.addColorStop(0, `rgba(255, 200, 100, ${alpha * 0.8})`);
    g.addColorStop(0.4, `rgba(255, 120, 40, ${alpha * 0.4})`);
    g.addColorStop(1, 'rgba(255, 80, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ─── Photorealistic ISS-style satellite ─── */
  function drawSatellite(cx, cy, scale, alpha, tick) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.rotate(sin(tick * 0.006) * 0.08); // gentle sway

    /* ─ Main truss structure ─ */
    ctx.fillStyle = '#c8d8e8';
    ctx.strokeStyle = 'rgba(120,160,210,0.5)';
    ctx.lineWidth = 0.8;
    // Central truss
    ctx.fillRect(-55, -4, 110, 8);
    ctx.strokeRect(-55, -4, 110, 8);
    // Truss segments
    ctx.strokeStyle = 'rgba(100,140,190,0.35)';
    ctx.lineWidth = 0.6;
    for (let tx = -50; tx <= 50; tx += 14) {
      ctx.beginPath(); ctx.moveTo(tx, -4); ctx.lineTo(tx, 4); ctx.stroke();
    }

    /* ─ Solar arrays — 4 panels ─ */
    const panelColors = [
      { x: -55, w: 44 },
      { x:  11, w: 44 },
    ];
    for (const p of panelColors) {
      // Panel support arm
      ctx.fillStyle = '#a8b8cc';
      ctx.fillRect(p.x + (p.w === 44 && p.x < 0 ? 0 : 0), -1.5, 10, 3);

      for (let row = 0; row < 2; row++) {
        const py = row === 0 ? -4 : 4;
        const panG = ctx.createLinearGradient(p.x, py, p.x + p.w, py + (row === 0 ? -16 : 16));
        panG.addColorStop(0,   '#1030a0');
        panG.addColorStop(0.3, '#1848c8');
        panG.addColorStop(0.7, '#2060e0');
        panG.addColorStop(1,   '#0c2880');
        ctx.fillStyle = panG;
        const ph = row === 0 ? -16 : 16;
        ctx.fillRect(p.x, py, p.w, ph);
        // Grid cells
        ctx.strokeStyle = 'rgba(100, 170, 255, 0.35)';
        ctx.lineWidth = 0.5;
        for (let gx = p.x + 8; gx < p.x + p.w; gx += 8) {
          ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx, py + ph); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(p.x, py + ph*0.5); ctx.lineTo(p.x + p.w, py + ph*0.5); ctx.stroke();
        // Solar reflection highlight
        ctx.fillStyle = 'rgba(80, 160, 255, 0.1)';
        ctx.fillRect(p.x, py, p.w * 0.3, ph);
      }

      // Panel border
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(p.x, -20, p.w, 40);
    }

    /* ─ Habitat modules ─ */
    // Main hab cylinder
    const habG = ctx.createLinearGradient(-16, -12, 16, 12);
    habG.addColorStop(0,   '#e4eef8');
    habG.addColorStop(0.35,'#ffffff');
    habG.addColorStop(0.65,'#d8ecf8');
    habG.addColorStop(1,   '#b8d0e8');
    ctx.fillStyle = habG;
    ctx.beginPath();
    ctx.roundRect(-16, -12, 32, 24, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 190, 240, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Module sheen
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.roundRect(-14, -12, 12, 24, [5, 0, 0, 5]);
    ctx.fill();

    // Porthole windows
    for (const wx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.arc(wx, 0, 3.5, 0, PI*2);
      ctx.fillStyle = '#1040a0';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wx, 0, 2, 0, PI*2);
      ctx.fillStyle = '#4090d0';
      ctx.fill();
      // Reflection
      ctx.beginPath();
      ctx.arc(wx - 0.8, -0.8, 0.8, 0, PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }

    // Docking ring
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, PI*2);
    ctx.stroke();

    /* ─ Radiator panels ─ */
    for (const side of [-1, 1]) {
      const rx = side * 18;
      const radG = ctx.createLinearGradient(rx, -8, rx + side*12, 8);
      radG.addColorStop(0, '#e8f4ff');
      radG.addColorStop(1, '#b0cce0');
      ctx.fillStyle = radG;
      ctx.fillRect(rx, -8, side*14, 16);
      // Tubes
      ctx.strokeStyle = 'rgba(100, 160, 210, 0.4)';
      ctx.lineWidth = 0.5;
      for (let ry = -6; ry <= 6; ry += 4) {
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + side*14, ry);
        ctx.stroke();
      }
    }

    /* ─ Earth below the satellite (reflection glow) ─ */
    const earthRef = ctx.createRadialGradient(0, 22, 0, 0, 22, 20);
    earthRef.addColorStop(0, 'rgba(40, 120, 220, 0.18)');
    earthRef.addColorStop(1, 'rgba(40, 120, 220, 0)');
    ctx.beginPath();
    ctx.arc(0, 22, 20, 0, PI*2);
    ctx.fillStyle = earthRef;
    ctx.fill();

    ctx.restore();
  }

  /* ─── Orbit ellipse ─── */
  function drawOrbit(cx, cy, rx, ry, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, PI*2);
    ctx.strokeStyle = 'rgba(80, 155, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ─── Contrail / flight path ─── */
  function drawContrail(rocketX, rocketY, startX, startY, alpha) {
    if (alpha < 0.01) return;
    const g = ctx.createLinearGradient(startX, startY, rocketX, rocketY);
    g.addColorStop(0,    'rgba(120, 180, 255, 0)');
    g.addColorStop(0.6,  `rgba(160, 200, 255, ${alpha * 0.25})`);
    g.addColorStop(1,    `rgba(200, 230, 255, ${alpha * 0.5})`);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(rocketX, rocketY);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ─── Exhaust particles ─── */
  const particles = [];

  function emitParticles(cx, cy, scale, intensity, inSpace) {
    if (!pref && intensity > 0.1 && particles.length < 220) {
      const count = inSpace ? 1 : 3;
      for (let i = 0; i < count; i++) {
        const spread = inSpace ? 2 : 4;
        particles.push({
          x:    cx + (rnd() - 0.5) * spread * scale,
          y:    cy + 28 * scale,
          vx:   (rnd() - 0.5) * 1.6,
          vy:   rnd() * 2.4 + 0.6,
          life: 1,
          r:    (rnd() * 3.5 + 1.2) * scale,
          hue:  inSpace ? 200 + rnd() * 40 : 18 + rnd() * 22,
          bright: inSpace ? 70 : 55,
        });
      }
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vx *= 0.98;
      p.vy += 0.05;
      p.life -= 0.032;
      p.r   *= 0.995;
      if (p.life <= 0 || p.r < 0.2) { particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, PI*2);
      ctx.fillStyle = `hsla(${p.hue}, 90%, ${p.bright + p.life * 25}%, ${p.life * 0.78})`;
      ctx.fill();
    }
  }

  /* ════════════════════════════════════════════════════
     MAIN RENDER LOOP
  ════════════════════════════════════════════════════ */

  let tick = 0;
  const earthY  = () => H - 80;
  const earthR  = () => cl(W * 0.28, 55, 80);

  function render() {
    tick++;
    const ratio = cl((state.currentStep - 1) / (TOTAL_STEPS - 1), 0, 1);

    // Update phase label
    if (label) {
      const idx = cl(Math.floor(ratio * LABELS.length), 0, LABELS.length - 1);
      label.textContent = LABELS[idx];
    }

    ctx.clearRect(0, 0, W, H);

    const eY = earthY();
    const eR = earthR();

    /* ── Background ── */
    drawBackground(ratio);

    /* ── Stars ── */
    drawStars(ratio, tick);

    /* ── Nebula glow (visible from step 4+) ── */
    const nebA = cl((ratio - 0.28) * 1.8, 0, 1);
    if (nebA > 0) {
      const nb = ctx.createRadialGradient(W*0.62, H*0.28, 0, W*0.62, H*0.28, 110);
      nb.addColorStop(0, `rgba(30, 80, 200, ${nebA * 0.2})`);
      nb.addColorStop(0.5,`rgba(20, 50, 150, ${nebA * 0.08})`);
      nb.addColorStop(1,  'rgba(10, 30, 100, 0)');
      ctx.beginPath(); ctx.arc(W*0.62, H*0.28, 110, 0, PI*2);
      ctx.fillStyle = nb; ctx.fill();

      const nb2 = ctx.createRadialGradient(W*0.2, H*0.42, 0, W*0.2, H*0.42, 80);
      nb2.addColorStop(0, `rgba(60, 30, 180, ${nebA * 0.14})`);
      nb2.addColorStop(1, 'rgba(30, 10, 100, 0)');
      ctx.beginPath(); ctx.arc(W*0.2, H*0.42, 80, 0, PI*2);
      ctx.fillStyle = nb2; ctx.fill();
    }

    /* ── Earth ── */
    const earthAlpha = cl(1 - ratio * 1.8, 0.06, 1);
    drawEarth(W * 0.5, eY, eR * cl(1 - ratio * 0.35, 0.65, 1), earthAlpha, tick);

    /* ── Launch pad ── */
    const padAlpha = cl(1 - ratio * 18, 0, 1);
    drawLaunchpad(W * 0.5, eY - eR, padAlpha);

    /* ── Rocket trajectory ── */
    // Stage separation happens around step 4-5 (ratio ~0.33-0.41)
    const sepRatio = cl((ratio - 0.32) / 0.06, 0, 1);
    const inSpace  = ratio > 0.4;

    // Rocket position: launch from Earth, arc up, then straight toward top
    const startY = eY - eR - 20;
    const endY   = H * 0.18;
    const rocketY = lr(startY, endY, ease(ratio));
    const rocketX = W * 0.5 + sin(ease(ratio) * PI * 0.6) * 22;
    const rocketScale = lr(0.85, 0.52, ratio);

    /* ── Contrail ── */
    const contrailA = cl(ratio * 3, 0, 1);
    drawContrail(rocketX, rocketY, W * 0.5, eY - eR, contrailA);

    /* ── Stage sep flash ── */
    const sepFlash = cl((sepRatio - 0.1) * 5, 0, 1) * cl(1 - (sepRatio - 0.3) * 5, 0, 1);
    if (sepFlash > 0) {
      drawStageSep(rocketX, rocketY + 5 * rocketScale, sepFlash);
    }

    /* ── Rocket ── */
    const rocketAlpha = cl(ratio < 0.88 ? 1 : 1 - (ratio - 0.88) * 8, 0, 1);
    const exhaustFlicker = pref ? 0.85 : 0.65 + 0.35 * sin(tick * 0.28 + sin(tick * 0.17) * 0.5);
    const exhaustA = cl(ratio < 0.82 ? exhaustFlicker : (1 - ratio) * 6, 0, 1);
    drawRocket(rocketX, rocketY, rocketScale, rocketAlpha, exhaustA, tick, ratio);
    emitParticles(rocketX, rocketY, rocketScale, exhaustA, inSpace);
    drawParticles();

    /* ── Orbit path ── */
    const orbitA = cl((ratio - 0.72) * 4, 0, 1);
    const orbitCY = H * 0.17;
    if (orbitA > 0) drawOrbit(W * 0.5, orbitCY, 68, 18, orbitA);

    /* ── Satellite ── */
    const satA = cl((ratio - 0.84) / 0.16, 0, 1);
    if (satA > 0) {
      const angle = tick * 0.010;
      const satX  = W * 0.5 + cos(angle) * 68;
      const satY  = orbitCY + sin(angle) * 18;
      const satScale = lr(0, 1.1, satA) * 0.78;
      drawSatellite(satX, satY, satScale, satA, tick);

      // Orbital sunrise glow
      if (satA > 0.5) {
        const sunA = cl((satA - 0.5) * 2, 0, 1) * (0.5 + 0.5 * sin(angle * 2));
        const sunG = ctx.createRadialGradient(W * 0.82, orbitCY - 30, 0, W * 0.82, orbitCY - 30, 50);
        sunG.addColorStop(0, `rgba(255, 200, 80, ${sunA * 0.55})`);
        sunG.addColorStop(0.4,`rgba(255, 140, 40, ${sunA * 0.25})`);
        sunG.addColorStop(1,  'rgba(255, 80, 0, 0)');
        ctx.beginPath(); ctx.arc(W * 0.82, orbitCY - 30, 50, 0, PI*2);
        ctx.fillStyle = sunG; ctx.fill();
      }
    }

    /* ── Left edge blend ── */
    const edgeG = ctx.createLinearGradient(0, 0, 28, 0);
    edgeG.addColorStop(0, 'rgba(2, 5, 14, 0.75)');
    edgeG.addColorStop(1, 'rgba(2, 5, 14, 0)');
    ctx.fillStyle = edgeG;
    ctx.fillRect(0, 0, 28, H);
  }

  /* ── Animation loop ── */
  function loop() {
    render();
    state.journeyAnimFrame = requestAnimationFrame(loop);
  }

  resize();
  if (pref) {
    render();
  } else {
    loop();
  }

  let rzt;
  window.addEventListener('resize', () => {
    clearTimeout(rzt);
    rzt = setTimeout(() => {
      if (state.journeyAnimFrame) cancelAnimationFrame(state.journeyAnimFrame);
      resize();
      pref ? render() : loop();
    }, 100);
  });
}

document.addEventListener('DOMContentLoaded', init);
