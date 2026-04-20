/**
 * Cloudflare Pages Function — POST /api/submit
 * Reçoit le formulaire multipart, valide, envoie via SMTP SSL.
 * Compatible Workers runtime (pas de Node.js requis).
 */

import { connect } from 'cloudflare:sockets';

// ─── Client SMTP minimal ─────────────────────────────────────────────────────

class SmtpClient {
  constructor() {
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.buffer  = '';
    this.writer  = null;
    this.reader  = null;
  }

  async connect(host, port) {
    const socket = connect(
      { hostname: host, port },
      { secureTransport: 'on' }, // SSL direct sur port 465
    );
    this.writer = socket.writable.getWriter();
    this.reader = socket.readable.getReader();
  }

  // Lit une ligne SMTP (terminée par \n)
  async readLine() {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx !== -1) {
        const line = this.buffer.slice(0, idx + 1);
        this.buffer = this.buffer.slice(idx + 1);
        return line.trimEnd();
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error('Socket SMTP fermé inopinément');
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  // Lit une réponse SMTP complète (supporte multi-lignes 250-... / 250 ...)
  async readResponse() {
    const lines = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (line.length >= 4 && line[3] === ' ') {
        return { code: parseInt(line.slice(0, 3), 10), text: lines.join('\n') };
      }
    }
  }

  // Envoie une commande et attend la réponse
  async cmd(command) {
    await this.writer.write(this.encoder.encode(command + '\r\n'));
    return this.readResponse();
  }

  // Envoie des données brutes sans lire de réponse
  async write(data) {
    await this.writer.write(this.encoder.encode(data));
  }

  async close() {
    try { await this.writer.close(); } catch (_) {}
  }
}

// ─── Encodage base64 UTF-8 sûr ───────────────────────────────────────────────

function b64utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64bytes(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─── Constructeur email MIME multipart ───────────────────────────────────────

function buildMimeMessage({ from, to, subject, html, text, attachments }) {
  const boundary = 'bp_' + crypto.randomUUID().replace(/-/g, '');
  const lines = [];

  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: =?UTF-8?B?${b64utf8(subject)}?=`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');

  // Partie texte brut
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(b64utf8(text).match(/.{1,76}/g).join('\r\n'));

  // Partie HTML
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(b64utf8(html).match(/.{1,76}/g).join('\r\n'));

  // Pièces jointes
  for (const att of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${att.type}; name="${att.name}"`);
    lines.push(`Content-Disposition: attachment; filename="${att.name}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(att.data.match(/.{1,76}/g).join('\r\n'));
  }

  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

// ─── Envoi SMTP ───────────────────────────────────────────────────────────────

async function sendEmail(env, { subject, html, text, attachments }) {
  const smtp = new SmtpClient();

  await smtp.connect(env.SMTP_HOST, parseInt(env.SMTP_PORT || '465', 10));

  // Greeting
  const greeting = await smtp.readResponse();
  if (greeting.code !== 220) throw new Error(`Greeting SMTP: ${greeting.text}`);

  // EHLO
  const ehlo = await smtp.cmd(`EHLO ${env.SMTP_HOST}`);
  if (ehlo.code !== 250) throw new Error(`EHLO: ${ehlo.text}`);

  // AUTH LOGIN
  const auth = await smtp.cmd('AUTH LOGIN');
  if (auth.code !== 334) throw new Error(`AUTH: ${auth.text}`);

  const userResp = await smtp.cmd(btoa(env.SMTP_USER));
  if (userResp.code !== 334) throw new Error('Auth user échouée');

  const passResp = await smtp.cmd(btoa(env.SMTP_PASS));
  if (passResp.code !== 235) throw new Error('Auth password échouée');

  // MAIL FROM
  const mailFrom = await smtp.cmd(`MAIL FROM:<${env.FROM_EMAIL}>`);
  if (mailFrom.code !== 250) throw new Error(`MAIL FROM: ${mailFrom.text}`);

  // RCPT TO
  const rcptTo = await smtp.cmd(`RCPT TO:<${env.TO_EMAIL}>`);
  if (rcptTo.code !== 250) throw new Error(`RCPT TO: ${rcptTo.text}`);

  // DATA
  const dataInit = await smtp.cmd('DATA');
  if (dataInit.code !== 354) throw new Error(`DATA: ${dataInit.text}`);

  // Corps du message + terminaison
  const message = buildMimeMessage({
    from: `"${env.AGENCY_NAME || 'astr.studio'}" <${env.FROM_EMAIL}>`,
    to: env.TO_EMAIL,
    subject,
    html,
    text,
    attachments,
  });

  await smtp.write(message + '\r\n.\r\n');
  const sent = await smtp.readResponse();
  if (sent.code !== 250) throw new Error(`Envoi message: ${sent.text}`);

  await smtp.cmd('QUIT');
  await smtp.close();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getField(fd, key) {
  const vals = fd.getAll(key).filter(v => typeof v === 'string');
  if (vals.length === 0) return '—';
  return vals.join(', ');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1048576).toFixed(1)} Mo`;
}

function interestBadge(val) {
  if (!val) return `<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">Non précisé</span>`;
  if (val.includes('rapidement')) return `<span style="padding:5px 12px;border-radius:20px;background:#D1FAE5;color:#065F46;font-weight:600;font-size:13px">🔥 ${val}</span>`;
  if (val.includes('semaines'))  return `<span style="padding:5px 12px;border-radius:20px;background:#FEF3C7;color:#92400E;font-weight:600;font-size:13px">⏳ ${val}</span>`;
  if (val.includes('Peut-être')) return `<span style="padding:5px 12px;border-radius:20px;background:#EFF6FF;color:#1D4ED8;font-weight:600;font-size:13px">💡 ${val}</span>`;
  return `<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">💤 ${val}</span>`;
}

// ─── Template HTML ────────────────────────────────────────────────────────────

function buildHtml(fd, attachments, id, date, agency) {
  const q  = (k) => getField(fd, k);
  const ex = (k, label) => fd.get(k) ? ` · <em style="color:#6C757D">${label} : ${fd.get(k)}</em>` : '';

  const qaRows = [
    ['1',  'Objectif principal',                      `${q('q1_objective')}${ex('q1_objective_other','Précision')}`],
    ['2',  'Site existant',                           `${q('q2_existing_site')}${fd.get('q2_existing_url') ? ` · <a href="${fd.get('q2_existing_url')}" style="color:#2574F0">${fd.get('q2_existing_url')}</a>` : ''}`],
    ['3',  'Type de site',                            `${q('q3_site_type')}${ex('q3_site_type_comment','Commentaire')}`],
    ['4',  'Pages indispensables',                    `${q('q4_pages')}${ex('q4_pages_other','Autre')}`],
    ['5',  'Style visuel',                            `${q('q5_style')}${ex('q5_style_description','Description')}`],
    ['6',  'Couleurs / univers',                      `${q('q6_colors')}${ex('q6_colors_details','Précisions')}`],
    ['7',  'Priorités',                               `${q('q7_priorities')}${ex('q7_priorities_other','Autre')}`],
    ['8',  'Éléments disponibles',                    q('q8_assets')],
    ['9',  "Attentes pour la maquette",               `<em>${q('q9_expectations')}</em>`],
    ['10', 'Disponibilité pour un échange',           q('q10_readiness')],
  ].map(([n, label, val]) => `
    <div style="margin-bottom:12px;padding:16px;background:#F8F9FA;border-radius:10px;border-left:3px solid #2574F0">
      <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:0.06em">${n}. ${label}</p>
      <p style="margin:0;font-size:14px;line-height:1.6">${val}</p>
    </div>`).join('');

  const filesHtml = attachments.length > 0
    ? attachments.map(a => `<div style="display:inline-block;margin:0 8px 8px 0;padding:8px 16px;background:#EEF4FF;border-radius:20px;font-size:13px;color:#2574F0;font-weight:500">📎 ${a.name} <span style="color:#92ABD8;font-size:12px">(${formatSize(a.size)})</span></div>`).join('')
    : '<p style="color:#6C757D;font-size:13px;margin:0">Aucun fichier transmis.</p>';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:Arial,sans-serif;color:#1A1A1A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px"><tr><td align="center">
<table width="100%" style="max-width:680px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1A5FD4 0%,#2574F0 60%,#4E93FF 100%);padding:36px 40px">
    <p style="margin:0 0 6px;color:rgba(255,255,255,.7);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em">${agency} · Questionnaire de qualification</p>
    <h1 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:800">🎯 Nouveau prospect — Demande de maquette</h1>
    <p style="margin:0;color:rgba(255,255,255,.75);font-size:14px">Reçu le ${date}</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 40px">
    <p style="margin:0 0 28px"><span style="display:inline-block;background:#EEF4FF;color:#2574F0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:.05em">ID : ${id.slice(0,8).toUpperCase()}</span></p>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Coordonnées</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
      <tr>
        <td width="50%" style="padding:0 8px 12px 0"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Entreprise</p><p style="margin:0;font-size:15px;font-weight:600">${q('company_name')}</p></div></td>
        <td width="50%" style="padding:0 0 12px 8px"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Contact</p><p style="margin:0;font-size:15px;font-weight:600">${q('contact_name')}</p></div></td>
      </tr>
      <tr>
        <td width="50%" style="padding:0 8px 12px 0"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Email</p><p style="margin:0;font-size:15px"><a href="mailto:${q('contact_email')}" style="color:#2574F0;text-decoration:none">${q('contact_email')}</a></p></div></td>
        <td width="50%" style="padding:0 0 12px 8px"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Téléphone</p><p style="margin:0;font-size:15px">${fd.get('contact_phone') || '<span style="color:#aaa">Non renseigné</span>'}</p></div></td>
      </tr>
      ${fd.get('current_website') ? `<tr><td colspan="2"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Site actuel</p><p style="margin:0;font-size:15px"><a href="${fd.get('current_website')}" style="color:#2574F0">${fd.get('current_website')}</a></p></div></td></tr>` : ''}
    </table>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Niveau d'intérêt</h2>
    <div style="margin-bottom:32px">${interestBadge(fd.get('q10_readiness'))}</div>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Réponses au questionnaire</h2>
    ${qaRows}

    ${attachments.length > 0 ? `<h2 style="margin:28px 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Fichiers transmis (${attachments.length})</h2>` : ''}
    ${filesHtml}

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F8F9FA;padding:20px 40px;border-top:1px solid #EAEAEA">
    <p style="margin:0;font-size:12px;color:#9CA3AF">
      <strong style="color:#6C757D">ID :</strong> ${id} &nbsp;·&nbsp;
      <strong style="color:#6C757D">Date :</strong> ${date} &nbsp;·&nbsp;
      Source : Questionnaire ${agency}
    </p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

// ─── Template texte brut ──────────────────────────────────────────────────────

function buildText(fd, attachments, id, date, agency) {
  const q  = (k) => getField(fd, k);
  const ex = (k, label) => fd.get(k) ? ` (${label} : ${fd.get(k)})` : '';

  return `NOUVEAU PROSPECT — DEMANDE DE MAQUETTE
${agency} · ${date}
ID : ${id}

════════════════════════════════════════
COORDONNÉES
════════════════════════════════════════
Entreprise  : ${q('company_name')}
Contact     : ${q('contact_name')}
Email       : ${q('contact_email')}
Téléphone   : ${fd.get('contact_phone') || 'Non renseigné'}
Site actuel : ${fd.get('current_website') || 'Non renseigné'}

════════════════════════════════════════
NIVEAU D'INTÉRÊT : ${q('q10_readiness')}
════════════════════════════════════════

1.  Objectif         : ${q('q1_objective')}${ex('q1_objective_other','Précision')}
2.  Site existant    : ${q('q2_existing_site')}${ex('q2_existing_url','URL')}
3.  Type de site     : ${q('q3_site_type')}${ex('q3_site_type_comment','Commentaire')}
4.  Pages            : ${q('q4_pages')}${ex('q4_pages_other','Autre')}
5.  Style visuel     : ${q('q5_style')}${ex('q5_style_description','Description')}
6.  Couleurs         : ${q('q6_colors')}${ex('q6_colors_details','Précisions')}
7.  Priorités        : ${q('q7_priorities')}${ex('q7_priorities_other','Autre')}
8.  Éléments dispo   : ${q('q8_assets')}
9.  Attentes maquette: ${q('q9_expectations')}
10. Disponibilité    : ${q('q10_readiness')}

════════════════════════════════════════
FICHIERS (${attachments.length})
════════════════════════════════════════
${attachments.length > 0 ? attachments.map(a => `- ${a.name} (${formatSize(a.size)})`).join('\n') : 'Aucun fichier.'}
`;
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;

  let fd;
  try {
    fd = await request.formData();
  } catch (_) {
    return Response.json({ success: false, error: 'Données invalides.' }, { status: 400 });
  }

  // Anti-spam : honeypot
  if (fd.get('website_url')?.trim()) {
    return Response.json({ success: false, error: 'Soumission rejetée.' }, { status: 400 });
  }

  // Anti-spam : timing
  const loadTime = parseInt(fd.get('_load_time') || '0', 10);
  if (Date.now() - loadTime < 20000) {
    return Response.json({ success: false, error: 'Soumission trop rapide. Veuillez réessayer.' }, { status: 400 });
  }

  // Validation champs requis
  for (const [field, label] of [
    ['contact_name',  'Votre nom'],
    ['company_name',  "Nom de l'entreprise"],
    ['contact_email', 'Adresse email'],
    ['rgpd',          'Acceptation RGPD'],
  ]) {
    if (!fd.get(field)?.trim()) {
      return Response.json({ success: false, error: `Le champ "${label}" est requis.` }, { status: 400 });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.get('contact_email'))) {
    return Response.json({ success: false, error: 'Adresse email invalide.' }, { status: 400 });
  }

  // Traitement des fichiers
  const attachments = [];
  for (const file of fd.getAll('files')) {
    if (file instanceof File && file.size > 0) {
      const buffer = await file.arrayBuffer();
      attachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: b64bytes(buffer),
      });
    }
  }

  const submissionId = crypto.randomUUID();
  const date = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const agency = env.AGENCY_NAME || 'astr.studio';
  const subject = `[Nouveau prospect maquette] ${fd.get('company_name')} – ${fd.get('contact_name')}`;

  try {
    await sendEmail(env, {
      subject,
      html:        buildHtml(fd, attachments, submissionId, date, agency),
      text:        buildText(fd, attachments, submissionId, date, agency),
      attachments,
    });
  } catch (err) {
    console.error('[SMTP error]', err.message);
    return Response.json({ success: false, error: "Erreur lors de l'envoi. Veuillez réessayer." }, { status: 500 });
  }

  return Response.json({ success: true, submissionId });
}
