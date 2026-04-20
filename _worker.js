/**
 * Cloudflare Worker — prospect-qualifier
 * Sert les fichiers statiques + gère POST /api/submit via SMTP SSL.
 */

import { connect } from 'cloudflare:sockets';

// ─── Client SMTP ─────────────────────────────────────────────────────────────

class SmtpClient {
  constructor() {
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.buffer  = '';
    this.writer  = null;
    this.reader  = null;
  }

  async connect(host, port) {
    const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    this.writer  = socket.writable.getWriter();
    this.reader  = socket.readable.getReader();
  }

  async readLine() {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx !== -1) {
        const line = this.buffer.slice(0, idx + 1);
        this.buffer = this.buffer.slice(idx + 1);
        return line.trimEnd();
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error('Socket SMTP fermé');
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

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

  async cmd(command) {
    await this.writer.write(this.encoder.encode(command + '\r\n'));
    return this.readResponse();
  }

  async write(data) {
    await this.writer.write(this.encoder.encode(data));
  }

  async close() {
    try { await this.writer.close(); } catch (_) {}
  }
}

// ─── Helpers encodage ────────────────────────────────────────────────────────

function b64utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64bytes(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function getField(fd, key) {
  const vals = fd.getAll(key).filter(v => typeof v === 'string');
  return vals.length ? vals.join(', ') : '—';
}

function formatSize(bytes) {
  if (bytes < 1024)    return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1048576).toFixed(1)} Mo`;
}

function interestBadge(val) {
  if (!val)                  return `<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">Non précisé</span>`;
  if (val.includes('rapidement')) return `<span style="padding:5px 12px;border-radius:20px;background:#D1FAE5;color:#065F46;font-weight:600;font-size:13px">🔥 ${val}</span>`;
  if (val.includes('semaines'))   return `<span style="padding:5px 12px;border-radius:20px;background:#FEF3C7;color:#92400E;font-weight:600;font-size:13px">⏳ ${val}</span>`;
  if (val.includes('Peut-être'))  return `<span style="padding:5px 12px;border-radius:20px;background:#EFF6FF;color:#1D4ED8;font-weight:600;font-size:13px">💡 ${val}</span>`;
  return `<span style="padding:5px 12px;border-radius:20px;background:#F3F4F6;color:#6B7280;font-weight:600;font-size:13px">💤 ${val}</span>`;
}

// ─── MIME builder ────────────────────────────────────────────────────────────

function buildMime({ from, to, subject, html, text, attachments }) {
  const b = 'bp_' + crypto.randomUUID().replace(/-/g, '');
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64utf8(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64utf8(text).match(/.{1,76}/g).join('\r\n'),
    `--${b}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64utf8(html).match(/.{1,76}/g).join('\r\n'),
  ];

  for (const a of attachments) {
    lines.push(
      `--${b}`,
      `Content-Type: ${a.type}; name="${a.name}"`,
      `Content-Disposition: attachment; filename="${a.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      a.data.match(/.{1,76}/g).join('\r\n'),
    );
  }

  lines.push(`--${b}--`);
  return lines.join('\r\n');
}

// ─── Envoi SMTP ───────────────────────────────────────────────────────────────

async function sendEmail(env, { subject, html, text, attachments }) {
  const smtp = new SmtpClient();
  await smtp.connect(env.SMTP_HOST, parseInt(env.SMTP_PORT || '465', 10));

  const gr = await smtp.readResponse();
  if (gr.code !== 220) throw new Error(`Greeting: ${gr.text}`);

  const ehlo = await smtp.cmd(`EHLO ${env.SMTP_HOST}`);
  if (ehlo.code !== 250) throw new Error(`EHLO: ${ehlo.text}`);

  const auth = await smtp.cmd('AUTH LOGIN');
  if (auth.code !== 334) throw new Error(`AUTH: ${auth.text}`);

  const u = await smtp.cmd(btoa(env.SMTP_USER));
  if (u.code !== 334) throw new Error('Auth user échouée');

  const p = await smtp.cmd(btoa(env.SMTP_PASS));
  if (p.code !== 235) throw new Error('Auth password échouée');

  const mf = await smtp.cmd(`MAIL FROM:<${env.FROM_EMAIL}>`);
  if (mf.code !== 250) throw new Error(`MAIL FROM: ${mf.text}`);

  const rt = await smtp.cmd(`RCPT TO:<${env.TO_EMAIL}>`);
  if (rt.code !== 250) throw new Error(`RCPT TO: ${rt.text}`);

  const di = await smtp.cmd('DATA');
  if (di.code !== 354) throw new Error(`DATA: ${di.text}`);

  const msg = buildMime({
    from: `"${env.AGENCY_NAME || 'astr.studio'}" <${env.FROM_EMAIL}>`,
    to: env.TO_EMAIL,
    subject, html, text, attachments,
  });

  await smtp.write(msg + '\r\n.\r\n');
  const sent = await smtp.readResponse();
  if (sent.code !== 250) throw new Error(`Send: ${sent.text}`);

  await smtp.cmd('QUIT');
  await smtp.close();
}

// ─── Templates email ─────────────────────────────────────────────────────────

function buildHtml(fd, atts, id, date, agency) {
  const q  = k => getField(fd, k);
  const ex = (k, l) => fd.get(k) ? ` · <em style="color:#6C757D">${l} : ${fd.get(k)}</em>` : '';

  const rows = [
    ['1',  'Objectif principal',              `${q('q1_objective')}${ex('q1_objective_other','Précision')}`],
    ['2',  'Site existant',                   `${q('q2_existing_site')}${fd.get('q2_existing_url') ? ` · <a href="${fd.get('q2_existing_url')}" style="color:#2574F0">${fd.get('q2_existing_url')}</a>` : ''}`],
    ['3',  'Type de site',                    `${q('q3_site_type')}${ex('q3_site_type_comment','Commentaire')}`],
    ['4',  'Pages indispensables',            `${q('q4_pages')}${ex('q4_pages_other','Autre')}`],
    ['5',  'Style visuel',                    `${q('q5_style')}${ex('q5_style_description','Description')}`],
    ['6',  'Couleurs',                        `${q('q6_colors')}${ex('q6_colors_details','Précisions')}`],
    ['7',  'Priorités',                       `${q('q7_priorities')}${ex('q7_priorities_other','Autre')}`],
    ['8',  'Éléments disponibles',            q('q8_assets')],
    ['9',  'Attentes pour la maquette',       `<em>${q('q9_expectations')}</em>`],
    ['10', 'Disponibilité',                   q('q10_readiness')],
  ].map(([n, l, v]) => `
    <div style="margin-bottom:12px;padding:16px;background:#F8F9FA;border-radius:10px;border-left:3px solid #2574F0">
      <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase;letter-spacing:.06em">${n}. ${l}</p>
      <p style="margin:0;font-size:14px;line-height:1.6">${v}</p>
    </div>`).join('');

  const filesHtml = atts.length
    ? atts.map(a => `<div style="display:inline-block;margin:0 8px 8px 0;padding:8px 16px;background:#EEF4FF;border-radius:20px;font-size:13px;color:#2574F0;font-weight:500">📎 ${a.name} <span style="color:#92ABD8">(${formatSize(a.size)})</span></div>`).join('')
    : '<p style="color:#6C757D;font-size:13px;margin:0">Aucun fichier transmis.</p>';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:Arial,sans-serif;color:#1A1A1A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px"><tr><td align="center">
<table width="100%" style="max-width:680px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1A5FD4,#2574F0,#4E93FF);padding:36px 40px">
    <p style="margin:0 0 6px;color:rgba(255,255,255,.7);font-size:12px;font-weight:600;text-transform:uppercase">${agency} · Questionnaire de qualification</p>
    <h1 style="margin:0 0 8px;color:#fff;font-size:24px;font-weight:800">🎯 Nouveau prospect — Demande de maquette</h1>
    <p style="margin:0;color:rgba(255,255,255,.75);font-size:14px">Reçu le ${date}</p>
  </td></tr>
  <tr><td style="padding:36px 40px">
    <p style="margin:0 0 28px"><span style="background:#EEF4FF;color:#2574F0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700">ID : ${id.slice(0,8).toUpperCase()}</span></p>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Coordonnées</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
      <tr>
        <td width="50%" style="padding:0 8px 12px 0"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Entreprise</p><p style="margin:0;font-size:15px;font-weight:600">${q('company_name')}</p></div></td>
        <td width="50%" style="padding:0 0 12px 8px"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Contact</p><p style="margin:0;font-size:15px;font-weight:600">${q('contact_name')}</p></div></td>
      </tr>
      <tr>
        <td width="50%" style="padding:0 8px 0 0"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Email</p><p style="margin:0;font-size:15px"><a href="mailto:${q('contact_email')}" style="color:#2574F0;text-decoration:none">${q('contact_email')}</a></p></div></td>
        <td width="50%" style="padding:0 0 0 8px"><div style="background:#F8F9FA;padding:14px 16px;border-radius:10px"><p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6C757D;text-transform:uppercase">Téléphone</p><p style="margin:0;font-size:15px">${fd.get('contact_phone') || '<span style="color:#aaa">Non renseigné</span>'}</p></div></td>
      </tr>
    </table>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Niveau d'intérêt</h2>
    <div style="margin-bottom:32px">${interestBadge(fd.get('q10_readiness'))}</div>

    <h2 style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Réponses</h2>
    ${rows}

    ${atts.length ? `<h2 style="margin:28px 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;color:#2574F0;padding-bottom:10px;border-bottom:2px solid #EEF4FF">Fichiers (${atts.length})</h2>` : ''}
    ${filesHtml}
  </td></tr>
  <tr><td style="background:#F8F9FA;padding:20px 40px;border-top:1px solid #EAEAEA">
    <p style="margin:0;font-size:12px;color:#9CA3AF"><strong style="color:#6C757D">ID :</strong> ${id} &nbsp;·&nbsp; <strong style="color:#6C757D">Date :</strong> ${date} &nbsp;·&nbsp; Source : ${agency}</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function buildText(fd, atts, id, date, agency) {
  const q  = k => getField(fd, k);
  const ex = (k, l) => fd.get(k) ? ` (${l} : ${fd.get(k)})` : '';
  return `NOUVEAU PROSPECT — ${agency}
${date} · ID : ${id}

COORDONNÉES
Entreprise  : ${q('company_name')}
Contact     : ${q('contact_name')}
Email       : ${q('contact_email')}
Téléphone   : ${fd.get('contact_phone') || 'Non renseigné'}
Site actuel : ${fd.get('current_website') || 'Non renseigné'}

NIVEAU D'INTÉRÊT : ${q('q10_readiness')}

RÉPONSES
1.  Objectif      : ${q('q1_objective')}${ex('q1_objective_other','Précision')}
2.  Site existant : ${q('q2_existing_site')}${ex('q2_existing_url','URL')}
3.  Type de site  : ${q('q3_site_type')}${ex('q3_site_type_comment','Commentaire')}
4.  Pages         : ${q('q4_pages')}${ex('q4_pages_other','Autre')}
5.  Style visuel  : ${q('q5_style')}${ex('q5_style_description','Description')}
6.  Couleurs      : ${q('q6_colors')}${ex('q6_colors_details','Précisions')}
7.  Priorités     : ${q('q7_priorities')}${ex('q7_priorities_other','Autre')}
8.  Éléments      : ${q('q8_assets')}
9.  Attentes      : ${q('q9_expectations')}
10. Disponibilité : ${q('q10_readiness')}

FICHIERS (${atts.length})
${atts.length ? atts.map(a => `- ${a.name} (${formatSize(a.size)})`).join('\n') : 'Aucun.'}`;
}

// ─── Handler /api/submit ──────────────────────────────────────────────────────

async function handleSubmit(request, env) {
  let fd;
  try { fd = await request.formData(); }
  catch (_) { return Response.json({ success: false, error: 'Données invalides.' }, { status: 400 }); }

  // Honeypot
  if (fd.get('website_url')?.trim()) {
    return Response.json({ success: false, error: 'Soumission rejetée.' }, { status: 400 });
  }

  // Timing anti-spam
  if (Date.now() - parseInt(fd.get('_load_time') || '0', 10) < 20000) {
    return Response.json({ success: false, error: 'Soumission trop rapide.' }, { status: 400 });
  }

  // Champs requis
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

  // Fichiers joints
  const attachments = [];
  for (const file of fd.getAll('files')) {
    if (file instanceof File && file.size > 0) {
      attachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: b64bytes(await file.arrayBuffer()),
      });
    }
  }

  const submissionId = crypto.randomUUID();
  const date = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const agency  = env.AGENCY_NAME || 'astr.studio';
  const subject = `[Nouveau prospect maquette] ${fd.get('company_name')} – ${fd.get('contact_name')}`;

  try {
    await sendEmail(env, {
      subject,
      html:        buildHtml(fd, attachments, submissionId, date, agency),
      text:        buildText(fd, attachments, submissionId, date, agency),
      attachments,
    });
  } catch (err) {
    console.error('[SMTP]', err.message);
    return Response.json({ success: false, error: "Erreur lors de l'envoi. Veuillez réessayer." }, { status: 500 });
  }

  return Response.json({ success: true, submissionId });
}

// ─── Entry point Worker ──────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route dynamique
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    // Tout le reste → fichiers statiques (public/)
    return env.ASSETS.fetch(request);
  },
};
