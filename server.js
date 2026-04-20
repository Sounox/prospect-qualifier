'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const TO_EMAIL = process.env.TO_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL;
const AGENCY_NAME = process.env.AGENCY_NAME || 'Notre Agence';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.svg', '.pdf', '.doc', '.docx',
]);

// ─── App setup ──────────────────────────────────────────────────────────────

const app = express();
// Resend exige une valeur non vide — on passe un placeholder en dev si la clé manque
const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder_dev_key');

const UPLOAD_DIR = path.join(__dirname, 'uploads-temp');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Multer ─────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.has(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    cb(new Error(`Fichier non autorisé : ${file.originalname}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 10 },
});

// ─── Static files ───────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ─── Route POST /api/submit ─────────────────────────────────────────────────

app.post('/api/submit', (req, res) => {
  upload.array('files', 10)(req, res, async (uploadErr) => {
    if (uploadErr instanceof multer.MulterError) {
      return res.status(400).json({ success: false, error: `Erreur d'upload : ${uploadErr.message}` });
    }
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message });
    }

    const data = req.body;
    const uploadedFiles = req.files || [];

    try {
      // ── Anti-spam : honeypot ──────────────────────────────────────────────
      if (data.website_url && data.website_url.trim() !== '') {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({ success: false, error: 'Soumission rejetée.' });
      }

      // ── Anti-spam : délai minimum (20 secondes depuis le chargement) ──────
      const loadTime = parseInt(data._load_time || '0', 10);
      if (Date.now() - loadTime < 20000) {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({ success: false, error: 'Soumission trop rapide. Veuillez réessayer.' });
      }

      // ── Validation des champs requis ──────────────────────────────────────
      const required = {
        contact_name: 'Votre nom',
        company_name: "Nom de l'entreprise",
        contact_email: 'Adresse email',
        rgpd: 'Acceptation RGPD',
      };

      for (const [field, label] of Object.entries(required)) {
        if (!data[field] || data[field].trim() === '') {
          cleanupFiles(uploadedFiles);
          return res.status(400).json({ success: false, error: `Le champ "${label}" est requis.` });
        }
      }

      // ── Validation email ──────────────────────────────────────────────────
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.contact_email.trim())) {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({ success: false, error: 'Adresse email invalide.' });
      }

      // ── Génération identifiant et date ────────────────────────────────────
      const submissionId = uuidv4();
      const submissionDate = new Date().toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // ── Préparation des pièces jointes ────────────────────────────────────
      const attachments = uploadedFiles.map((file) => ({
        filename: file.originalname,
        content: fs.readFileSync(file.path),
      }));

      // ── Envoi de l'email via Resend ───────────────────────────────────────
      const subject = `[Nouveau prospect maquette] ${data.company_name} – ${data.contact_name}`;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: TO_EMAIL,
        subject,
        html: buildEmailHtml(data, uploadedFiles, submissionId, submissionDate),
        text: buildEmailText(data, uploadedFiles, submissionId, submissionDate),
        attachments,
      });

      // ── Nettoyage des fichiers temporaires ────────────────────────────────
      cleanupFiles(uploadedFiles);

      return res.json({ success: true, submissionId });

    } catch (err) {
      console.error('[Submit error]', err);
      cleanupFiles(uploadedFiles);
      return res.status(500).json({
        success: false,
        error: "Une erreur est survenue lors de l'envoi. Veuillez réessayer.",
      });
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanupFiles(files) {
  for (const file of files) {
    fs.unlink(file.path, () => {});
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Retourne la valeur d'un champ (string ou array → string joiné) */
function getValue(data, key) {
  const val = data[key];
  if (!val) return '—';
  if (Array.isArray(val)) return val.join(', ');
  return val.trim() || '—';
}

function buildInterestBadge(readiness) {
  if (!readiness) return '<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">Non précisé</span>';
  if (readiness.includes('rapidement')) return `<span style="padding:5px 12px;border-radius:20px;background:#D1FAE5;color:#065F46;font-weight:600;font-size:13px">🔥 ${readiness}</span>`;
  if (readiness.includes('semaines')) return `<span style="padding:5px 12px;border-radius:20px;background:#FEF3C7;color:#92400E;font-weight:600;font-size:13px">⏳ ${readiness}</span>`;
  if (readiness.includes('Peut-être')) return `<span style="padding:5px 12px;border-radius:20px;background:#EFF6FF;color:#1D4ED8;font-weight:600;font-size:13px">💡 ${readiness}</span>`;
  return `<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">💤 ${readiness}</span>`;
}

// ─── Template email HTML ──────────────────────────────────────────────────────

function buildEmailHtml(data, files, submissionId, date) {
  const q = (key) => getValue(data, key);
  const extras = (extraKey, label) =>
    data[extraKey] ? `<span style="color:#6C757D"> · ${label} : <em>${data[extraKey]}</em></span>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nouveau prospect</title>
</head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:'Inter',Arial,sans-serif;color:#1A1A1A">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:680px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1A5FD4 0%,#2574F0 60%,#4E93FF 100%);padding:36px 40px">
            <p style="margin:0 0 6px;color:rgba(255,255,255,0.7);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">
              ${AGENCY_NAME} · Questionnaire de qualification
            </p>
            <h1 style="margin:0 0 8px;color:#FFFFFF;font-size:24px;font-weight:800;line-height:1.3">
              🎯 Nouveau prospect — Demande de maquette
            </h1>
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:14px">
              Reçu le ${date}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px">

          <!-- Submission ID badge -->
          <p style="margin:0 0 28px">
            <span style="display:inline-block;background:#EEF4FF;color:#2574F0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.05em">
              ID : ${submissionId.slice(0, 8).toUpperCase()}
            </span>
          </p>

          <!-- Coordonnées -->
          <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">
            Coordonnées
          </h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
            <tr>
              <td width="50%" style="padding:0 8px 12px 0">
                <div style="background:#F8F9FA;padding:14px 16px;border-radius:10px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">Entreprise</p>
                  <p style="margin:0;font-size:15px;font-weight:600;color:#1A1A1A">${q('company_name')}</p>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px">
                <div style="background:#F8F9FA;padding:14px 16px;border-radius:10px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">Contact</p>
                  <p style="margin:0;font-size:15px;font-weight:600;color:#1A1A1A">${q('contact_name')}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:0 8px 12px 0">
                <div style="background:#F8F9FA;padding:14px 16px;border-radius:10px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">Email</p>
                  <p style="margin:0;font-size:15px;font-weight:500"><a href="mailto:${q('contact_email')}" style="color:#2574F0;text-decoration:none">${q('contact_email')}</a></p>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 8px">
                <div style="background:#F8F9FA;padding:14px 16px;border-radius:10px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">Téléphone</p>
                  <p style="margin:0;font-size:15px;font-weight:500;color:#1A1A1A">${data.contact_phone || '<span style="color:#aaa">Non renseigné</span>'}</p>
                </div>
              </td>
            </tr>
            ${data.current_website ? `
            <tr>
              <td colspan="2">
                <div style="background:#F8F9FA;padding:14px 16px;border-radius:10px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">Site actuel</p>
                  <p style="margin:0;font-size:15px;font-weight:500"><a href="${data.current_website}" style="color:#2574F0">${data.current_website}</a></p>
                </div>
              </td>
            </tr>` : ''}
          </table>

          <!-- Niveau d'intérêt -->
          <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">
            Niveau d'intérêt
          </h2>
          <div style="margin-bottom:32px">
            ${buildInterestBadge(data.q10_readiness)}
          </div>

          <!-- Réponses -->
          <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">
            Réponses au questionnaire
          </h2>

          ${[
            ['1', 'Objectif principal', `${q('q1_objective')}${extras('q1_objective_other', 'Précision')}`],
            ['2', 'Site existant', `${q('q2_existing_site')}${data.q2_existing_url ? ` · <a href="${data.q2_existing_url}" style="color:#2574F0">${data.q2_existing_url}</a>` : ''}`],
            ['3', 'Type de site', `${q('q3_site_type')}${extras('q3_site_type_comment', 'Commentaire')}`],
            ['4', 'Pages indispensables', `${q('q4_pages')}${extras('q4_pages_other', 'Autre')}`],
            ['5', 'Style visuel', `${q('q5_style')}${extras('q5_style_description', 'Description')}`],
            ['6', 'Couleurs / univers', `${q('q6_colors')}${extras('q6_colors_details', 'Précisions')}`],
            ['7', 'Priorités', `${q('q7_priorities')}${extras('q7_priorities_other', 'Autre')}`],
            ['8', 'Éléments disponibles', q('q8_assets')],
            ['9', 'Ce qu\'il souhaite voir dans la maquette', `<em>${q('q9_expectations')}</em>`],
            ['10', 'Disponibilité pour un échange', q('q10_readiness')],
          ].map(([num, label, value]) => `
          <div style="margin-bottom:12px;padding:16px;background:#F8F9FA;border-radius:10px;border-left:3px solid #2574F0">
            <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">${num}. ${label}</p>
            <p style="margin:0;font-size:14px;color:#1A1A1A;line-height:1.6">${value}</p>
          </div>`).join('')}

          <!-- Fichiers -->
          ${files.length > 0 ? `
          <h2 style="margin:28px 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">
            Fichiers transmis (${files.length})
          </h2>
          <div>
            ${files.map(f => `
            <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 16px;background:#EEF4FF;border-radius:20px;font-size:13px;color:#2574F0;font-weight:500">
              📎 ${f.originalname} <span style="color:#92ABD8;font-size:12px">(${formatFileSize(f.size)})</span>
            </div>`).join('')}
          </div>` : `
          <p style="color:#6C757D;font-size:13px;margin:16px 0 0">Aucun fichier transmis avec cette demande.</p>`}

        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F8F9FA;padding:20px 40px;border-top:1px solid #EAEAEA">
            <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6">
              <strong style="color:#6C757D">Soumission ID :</strong> ${submissionId} &nbsp;·&nbsp;
              <strong style="color:#6C757D">Date :</strong> ${date} &nbsp;·&nbsp;
              Source : Questionnaire ${AGENCY_NAME}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Template email texte brut ────────────────────────────────────────────────

function buildEmailText(data, files, submissionId, date) {
  const q = (key) => getValue(data, key);
  const extra = (key, label) => (data[key] ? ` (${label} : ${data[key]})` : '');

  return `NOUVEAU PROSPECT — DEMANDE DE MAQUETTE
${AGENCY_NAME} · Questionnaire de qualification
Reçu le : ${date}
ID de soumission : ${submissionId}

════════════════════════════════════════
COORDONNÉES
════════════════════════════════════════
Entreprise  : ${q('company_name')}
Contact     : ${q('contact_name')}
Email       : ${q('contact_email')}
Téléphone   : ${data.contact_phone || 'Non renseigné'}
Site actuel : ${data.current_website || 'Non renseigné'}

════════════════════════════════════════
NIVEAU D'INTÉRÊT
════════════════════════════════════════
${q('q10_readiness')}

════════════════════════════════════════
RÉPONSES AU QUESTIONNAIRE
════════════════════════════════════════
1. Objectif principal
   ${q('q1_objective')}${extra('q1_objective_other', 'Précision')}

2. Site existant
   ${q('q2_existing_site')}${extra('q2_existing_url', 'URL')}

3. Type de site
   ${q('q3_site_type')}${extra('q3_site_type_comment', 'Commentaire')}

4. Pages indispensables
   ${q('q4_pages')}${extra('q4_pages_other', 'Autre')}

5. Style visuel
   ${q('q5_style')}${extra('q5_style_description', 'Description')}

6. Couleurs / univers
   ${q('q6_colors')}${extra('q6_colors_details', 'Précisions')}

7. Priorités
   ${q('q7_priorities')}${extra('q7_priorities_other', 'Autre')}

8. Éléments disponibles
   ${q('q8_assets')}

9. Ce qu'il souhaite voir dans la maquette
   ${q('q9_expectations')}

10. Disponibilité pour un échange
    ${q('q10_readiness')}

════════════════════════════════════════
FICHIERS TRANSMIS
════════════════════════════════════════
${files.length > 0
    ? files.map(f => `- ${f.originalname} (${formatFileSize(f.size)})`).join('\n')
    : 'Aucun fichier transmis.'}
`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  Serveur lancé → http://localhost:${PORT}`);
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY non configurée — les emails ne seront pas envoyés');
  }
});
