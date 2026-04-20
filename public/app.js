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
  initJourneyCanvas();
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

  const maxTilt = 3;
  document.addEventListener('pointermove', (event) => {
    const x = (event.clientX / window.innerWidth) - 0.5;
    const y = (event.clientY / window.innerHeight) - 0.5;
    const rotateY = x * maxTilt;
    const rotateX = -y * maxTilt;
    els.introVisual.style.transform = `translateY(0) perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
  });

  document.addEventListener('pointerleave', () => {
    els.introVisual.style.transform = 'translateY(0)';
  });
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

// ── Journey Canvas (rocket launch side animation) ────────────────────────────

function initJourneyCanvas() {
  const panel  = document.getElementById('journey-panel');
  const canvas = document.getElementById('journey-canvas');
  const label  = document.getElementById('journey-label');
  if (!panel || !canvas) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const W = 260;
  let H = 0;
  const ctx = canvas.getContext('2d');

  // ── particles for exhaust ────────────────────────────────────────────────
  const exhaust = [];

  // ── helpers ─────────────────────────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp  = (a, b, t)   => a + (b - a) * clamp(t, 0, 1);
  const easeInOut = (t)     => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

  // Journey phase labels
  const PHASE_LABELS = [
    'Initialisation', 'Mise à feu', 'Décollage',
    'Montée en orbite', 'Atmosphère', 'Zone de transition',
    'Espace profond', 'Trajectoire finale',
    'Approche orbitale', 'Déploiement', 'En orbite',
  ];

  function resize() {
    H = panel.offsetHeight || window.innerHeight - 57;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(W * ratio);
    canvas.height = Math.floor(H * ratio);
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // ── Drawing primitives ───────────────────────────────────────────────────

  function drawStarField(ratio) {
    // a few hand-placed bright stars that fade in as we go deeper
    const count = Math.floor(lerp(6, 22, ratio));
    const seed  = [0.12,0.45,0.28,0.73,0.61,0.09,0.84,0.37,0.52,0.18,
                   0.92,0.66,0.31,0.77,0.55,0.04,0.88,0.41,0.23,0.95,
                   0.14,0.68];
    for (let i = 0; i < count; i++) {
      const sx = seed[i % seed.length] * W;
      const sy = seed[(i + 5) % seed.length] * H * 0.75;
      const sr = 0.6 + seed[(i + 2) % seed.length] * 1.1;
      const sa = clamp(lerp(0, 0.9, (ratio - 0.05) * 4) * (0.5 + 0.5 * seed[(i+3)%seed.length]), 0, 1);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210, 235, 255, ${sa})`;
      ctx.fill();
      if (sr > 1.2 && sa > 0.4) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 4);
        g.addColorStop(0, `rgba(180, 220, 255, ${sa * 0.4})`);
        g.addColorStop(1, `rgba(180, 220, 255, 0)`);
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 4, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  function drawEarth(cx, cy, r, fadeOut) {
    // Outer atmosphere
    const atmoR = r * 1.55;
    const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, atmoR);
    atmo.addColorStop(0, `rgba(80, 160, 255, ${0.35 * fadeOut})`);
    atmo.addColorStop(0.5, `rgba(60, 120, 220, ${0.18 * fadeOut})`);
    atmo.addColorStop(1, 'rgba(40, 80, 180, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, atmoR, 0, Math.PI * 2);
    ctx.fillStyle = atmo;
    ctx.fill();

    // Body
    const body = ctx.createRadialGradient(cx - r*0.28, cy - r*0.28, r * 0.05, cx, cy, r);
    body.addColorStop(0, `rgba(120, 195, 255, ${fadeOut})`);
    body.addColorStop(0.45, `rgba(32, 110, 220, ${fadeOut})`);
    body.addColorStop(1, `rgba(8, 45, 120, ${fadeOut})`);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // Land masses
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.72 * fadeOut;
    ctx.fillStyle = '#5dce8a';
    ctx.beginPath();
    ctx.ellipse(cx - r*0.12, cy - r*0.18, r*0.24, r*0.14, 0.4, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + r*0.22, cy + r*0.08, r*0.19, r*0.11, -0.5, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - r*0.28, cy + r*0.22, r*0.14, r*0.08, 0.2, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Rim light
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(140, 210, 255, ${0.55 * fadeOut})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawLaunchpad(cx, cy, alpha) {
    ctx.globalAlpha = alpha;
    // Platform base
    ctx.fillStyle = '#1a3466';
    ctx.beginPath();
    ctx.roundRect(cx - 22, cy, 44, 10, 3);
    ctx.fill();
    // Tower
    ctx.fillStyle = '#243d6e';
    ctx.fillRect(cx + 12, cy - 40, 5, 40);
    // Arm
    ctx.fillStyle = '#2a4a80';
    ctx.fillRect(cx + 5, cy - 30, 12, 3);
    ctx.globalAlpha = 1;
  }

  function drawRocket(cx, cy, scale, alpha, exhaustAlpha, t) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Exhaust glow behind rocket
    if (exhaustAlpha > 0.05) {
      const e1 = ctx.createRadialGradient(0, 28, 0, 0, 38, 22);
      e1.addColorStop(0, `rgba(255, 210, 80, ${exhaustAlpha * 0.9})`);
      e1.addColorStop(0.35, `rgba(255, 120, 30, ${exhaustAlpha * 0.65})`);
      e1.addColorStop(0.7, `rgba(255, 60, 10, ${exhaustAlpha * 0.28})`);
      e1.addColorStop(1, 'rgba(255, 40, 0, 0)');
      ctx.beginPath();
      ctx.ellipse(0, 32, 10, 20, 0, 0, Math.PI * 2);
      ctx.fillStyle = e1;
      ctx.fill();

      // Inner white core
      const e2 = ctx.createRadialGradient(0, 24, 0, 0, 28, 8);
      e2.addColorStop(0, `rgba(255, 255, 240, ${exhaustAlpha})`);
      e2.addColorStop(1, 'rgba(255, 200, 60, 0)');
      ctx.beginPath();
      ctx.ellipse(0, 25, 4, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = e2;
      ctx.fill();
    }

    // Body gradient
    const bodyG = ctx.createLinearGradient(-9, -26, 9, 20);
    bodyG.addColorStop(0, '#f0f8ff');
    bodyG.addColorStop(0.5, '#ffffff');
    bodyG.addColorStop(1, '#a8d4ff');
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.bezierCurveTo(9, -12, 9, 6, 7, 18);
    ctx.lineTo(-7, 18);
    ctx.bezierCurveTo(-9, 6, -9, -12, 0, -28);
    ctx.fillStyle = bodyG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // astr.studio stripe
    ctx.fillStyle = 'rgba(37, 116, 240, 0.6)';
    ctx.fillRect(-7, -2, 14, 5);

    // Porthole
    ctx.beginPath();
    ctx.arc(0, -9, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2060e8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -9, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#b8e4ff';
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.arc(-1.2, -10.2, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();

    // Fins left & right
    ctx.fillStyle = '#7ab8f5';
    ctx.beginPath();
    ctx.moveTo(-7, 8);
    ctx.lineTo(-16, 20);
    ctx.lineTo(-7, 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(7, 8);
    ctx.lineTo(16, 20);
    ctx.lineTo(7, 18);
    ctx.closePath();
    ctx.fill();

    // Engine nozzle
    ctx.fillStyle = '#d0e8ff';
    ctx.beginPath();
    ctx.moveTo(-5, 18);
    ctx.lineTo(5, 18);
    ctx.lineTo(4, 24);
    ctx.lineTo(-4, 24);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawOrbitPath(cx, cy, rx, ry, alpha) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(80, 150, 255, ${alpha * 0.35})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSatellite(cx, cy, scale, alpha, orbitAngle) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.rotate(orbitAngle * 0.15);

    // Main body
    const bg = ctx.createLinearGradient(-10, -10, 10, 10);
    bg.addColorStop(0, '#daeeff');
    bg.addColorStop(1, '#a0c8f0');
    ctx.fillStyle = bg;
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-10, -10, 20, 20, 3);
    ctx.fill();
    ctx.stroke();

    // Solar panels — left
    const panelG = ctx.createLinearGradient(-44, -5, -12, 5);
    panelG.addColorStop(0, '#1a4db0');
    panelG.addColorStop(0.4, '#2478f0');
    panelG.addColorStop(1, '#4a9aff');
    ctx.fillStyle = panelG;
    ctx.fillRect(-44, -5, 30, 10);
    // Panel grid lines
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.4)';
    ctx.lineWidth = 0.5;
    for (let gx = -34; gx < -14; gx += 10) {
      ctx.beginPath(); ctx.moveTo(gx, -5); ctx.lineTo(gx, 5); ctx.stroke();
    }

    // Solar panels — right
    const panelG2 = ctx.createLinearGradient(12, -5, 44, 5);
    panelG2.addColorStop(0, '#4a9aff');
    panelG2.addColorStop(0.6, '#2478f0');
    panelG2.addColorStop(1, '#1a4db0');
    ctx.fillStyle = panelG2;
    ctx.fillRect(14, -5, 30, 10);
    for (let gx = 24; gx < 44; gx += 10) {
      ctx.beginPath(); ctx.moveTo(gx, -5); ctx.lineTo(gx, 5); ctx.stroke();
    }

    // Connecting rod
    ctx.fillStyle = '#8ab8e0';
    ctx.fillRect(-14, -1.5, 28, 3);

    // Body detail – lens
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1a50c0';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#88d4ff';
    ctx.fill();

    // Antenna dish
    ctx.beginPath();
    ctx.arc(4, -16, 7, Math.PI, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, -16);
    ctx.lineTo(4, -10);
    ctx.stroke();

    ctx.restore();
  }

  function drawFlightTrail(points, alpha) {
    if (points.length < 2) return;
    for (let i = 1; i < points.length; i++) {
      const t = i / points.length;
      ctx.beginPath();
      ctx.moveTo(points[i-1].x, points[i-1].y);
      ctx.lineTo(points[i].x, points[i].y);
      const grd = ctx.createLinearGradient(points[i-1].x, points[i-1].y, points[i].x, points[i].y);
      grd.addColorStop(0, `rgba(60, 140, 255, 0)`);
      grd.addColorStop(1, `rgba(100, 180, 255, ${alpha * t * 0.6})`);
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Pre-built curved trail path points (Earth → orbit arc)
  function buildTrailPoints(ratio) {
    const pts = [];
    const earthY = H - 70;
    const count = Math.floor(ratio * 40);
    for (let i = 0; i <= count; i++) {
      const t = i / 40;
      const x = W * 0.5 + Math.sin(t * Math.PI * 0.8) * 18;
      const y = lerp(earthY - 38, H * 0.22, easeInOut(t));
      pts.push({ x, y });
    }
    return pts;
  }

  // ── Main render ──────────────────────────────────────────────────────────

  let tick = 0;
  let lastRatio = -1;

  function render() {
    if (!panel.offsetParent && !document.body.dataset.screen === 'form') return;

    tick++;
    const ratio = clamp((state.currentStep - 1) / (TOTAL_STEPS - 1), 0, 1);

    // Update label
    if (label) {
      const idx = Math.min(Math.floor(ratio * PHASE_LABELS.length), PHASE_LABELS.length - 1);
      label.textContent = PHASE_LABELS[idx];
    }

    ctx.clearRect(0, 0, W, H);

    // ── Background deep-space gradient ─────────────────────────────────────
    const bgG = ctx.createLinearGradient(0, 0, 0, H);
    bgG.addColorStop(0, `rgba(2, 5, 16, ${lerp(0, 0.7, ratio)})`);
    bgG.addColorStop(0.5, `rgba(4, 10, 28, ${lerp(0.1, 0.55, ratio)})`);
    bgG.addColorStop(1, `rgba(6, 16, 44, ${lerp(0.2, 0.3, ratio)})`);
    ctx.fillStyle = bgG;
    ctx.fillRect(0, 0, W, H);

    // ── Stars ──────────────────────────────────────────────────────────────
    drawStarField(ratio);

    // ── Distant nebula glow (fades in mid-journey) ─────────────────────────
    const nebulaA = clamp((ratio - 0.25) * 2, 0, 1);
    if (nebulaA > 0) {
      const nx = W * 0.35, ny = H * 0.25;
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, 90);
      ng.addColorStop(0, `rgba(40, 100, 220, ${nebulaA * 0.18})`);
      ng.addColorStop(1, 'rgba(40, 100, 220, 0)');
      ctx.beginPath();
      ctx.arc(nx, ny, 90, 0, Math.PI * 2);
      ctx.fillStyle = ng;
      ctx.fill();
    }

    // ── Orbit path (fades in near end) ────────────────────────────────────
    const orbitA = clamp((ratio - 0.7) * 4, 0, 1);
    if (orbitA > 0) {
      drawOrbitPath(W * 0.5, H * 0.18, 55, 16, orbitA);
    }

    // ── Earth at bottom ───────────────────────────────────────────────────
    const earthY  = H - 70;
    const earthFade = clamp(1 - ratio * 1.6, 0.08, 1);
    drawEarth(W * 0.5, earthY, 44, earthFade);

    // Launch pad (only at start)
    if (ratio < 0.08) {
      drawLaunchpad(W * 0.5, earthY - 44, clamp(1 - ratio * 14, 0, 1));
    }

    // ── Flight trail ──────────────────────────────────────────────────────
    const trailPts = buildTrailPoints(ratio);
    drawFlightTrail(trailPts, clamp(ratio * 2.5, 0, 1));

    // ── Rocket position ───────────────────────────────────────────────────
    const rocketStartY = earthY - 36;
    const rocketEndY   = H * 0.22 - 8;
    const rocketX = W * 0.5 + Math.sin(easeInOut(ratio) * Math.PI * 0.8) * 18;
    const rocketY = lerp(rocketStartY, rocketEndY, easeInOut(ratio));

    const rocketScale = lerp(1, 0.6, ratio);
    const rocketAlpha = clamp(ratio < 0.88 ? 1 : 1 - (ratio - 0.88) * 8, 0, 1);
    const exhaustA    = clamp(ratio < 0.85 ? (0.7 + Math.sin(tick * 0.22) * 0.3) : (1 - ratio) * 7, 0, 1);

    drawRocket(rocketX, rocketY, rocketScale, rocketAlpha, exhaustA, tick);

    // ── Exhaust particle emit ─────────────────────────────────────────────
    if (!prefersReducedMotion && exhaustA > 0.1 && tick % 2 === 0) {
      exhaust.push({
        x:    rocketX + (Math.random() - 0.5) * 5 * rocketScale,
        y:    rocketY + 24 * rocketScale,
        vx:   (Math.random() - 0.5) * 1.2,
        vy:   Math.random() * 1.8 + 0.5,
        life: 1,
        r:    Math.random() * 3.5 + 1,
        hue:  20 + Math.random() * 25,
      });
    }

    // Draw & age particles
    for (let i = exhaust.length - 1; i >= 0; i--) {
      const p = exhaust[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.04;
      p.life -= 0.038;
      if (p.life <= 0) { exhaust.splice(i, 1); continue; }
      const a = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, ${55 + p.life * 30}%, ${a * 0.82})`;
      ctx.fill();
    }

    // ── Satellite (fades in near the end) ────────────────────────────────
    const satA = clamp((ratio - 0.82) / 0.18, 0, 1);
    if (satA > 0) {
      const orbitRX = 55, orbitRY = 16;
      const angle   = tick * 0.012;
      const satX    = W * 0.5 + Math.cos(angle) * orbitRX;
      const satY    = H * 0.18 + Math.sin(angle) * orbitRY;
      drawSatellite(satX, satY, satA, satA, angle);
    }

    // ── Right edge vignette ───────────────────────────────────────────────
    const vig = ctx.createLinearGradient(0, 0, W, 0);
    vig.addColorStop(0, 'rgba(3, 7, 20, 0.55)');
    vig.addColorStop(0.35, 'rgba(3, 7, 20, 0)');
    vig.addColorStop(1, 'rgba(3, 7, 20, 0)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Animation loop ───────────────────────────────────────────────────────
  function journeyLoop() {
    render();
    state.journeyAnimFrame = requestAnimationFrame(journeyLoop);
  }

  resize();
  if (prefersReducedMotion) {
    render();
  } else {
    journeyLoop();
  }

  window.addEventListener('resize', () => {
    resize();
    if (prefersReducedMotion) render();
  });
}

document.addEventListener('DOMContentLoaded', init);
