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
  selectedFiles: [],  // File objects sélectionnés par l'utilisateur
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
};

// ── Initialisation ───────────────────────────────────────────────────────────

function init() {
  // Timestamp de chargement de la page (anti-spam)
  els.loadTime.value = Date.now().toString();

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
  const pct = Math.round((state.currentStep / TOTAL_STEPS) * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressPct.textContent = `${pct}%`;
  els.stepNum.textContent = state.currentStep;
  els.progressTrack.setAttribute('aria-valuenow', pct);
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

document.addEventListener('DOMContentLoaded', init);
