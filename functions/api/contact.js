/**
 * Cloudflare Pages Function — POST /api/contact
 * ------------------------------------------------------------
 * Sends "Contact the Author" form submissions to the author's inboxes
 * using Resend (https://resend.com). Two recipients by default:
 *
 *     Tony@RuDao.org  +  com2000@agent.qq.com
 *
 * This is OPTIONAL. If it is not deployed, the site automatically falls
 * back to Web3Forms keys configured in js/script.js, and if those are not
 * configured either, to the visitor's own email app (mailto:).
 *
 * SETUP (about 5 minutes)
 * 1. Create a free Resend account and add the domain `rudao.us`
 *    (Resend shows 2-3 DNS records — add them in Cloudflare DNS).
 * 2. Create an API key in Resend.
 * 3. Cloudflare dashboard → Workers & Pages → your RuDao Pages project
 *    → Settings → Variables and Secrets, add:
 *
 *        RESEND_API_KEY = re_xxxxxxxxxxxxxxxx
 *        CONTACT_FROM   = RuDao.us Contact Form <noreply@rudao.us>
 *        CONTACT_TO     = Tony@RuDao.org,com2000@agent.qq.com
 *
 * 4. Commit and push — Cloudflare Pages deploys this function automatically
 *    (the /functions directory is detected on any Pages project connected
 *    to this Git repository).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ success: false, error: 'Invalid JSON body.' }, 400);
  }

  // Honeypot — real users never fill this in.
  if (payload.botcheck) {
    return json({ success: true, skipped: 'spam' });
  }

  const name = String(payload.name || '').trim().slice(0, 120) || 'Anonymous visitor';
  const email = String(payload.email || '').trim().slice(0, 200);
  const message = String(payload.message || '').trim().slice(0, 5000);
  const page = String(payload.page || '').trim().slice(0, 300);

  if (!EMAIL_RE.test(email)) {
    return json({ success: false, error: 'A valid email address is required.' }, 400);
  }
  if (message.length < 5) {
    return json({ success: false, error: 'The message is too short.' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return json(
      { success: false, error: 'Email backend not configured (missing RESEND_API_KEY).' },
      501
    );
  }

  const from = env.CONTACT_FROM || 'RuDao.us Contact Form <noreply@rudao.us>';
  const to = (env.CONTACT_TO || 'Tony@RuDao.org,com2000@agent.qq.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const subject = `RuDao.us — new message from ${name}`;
  const html = `
    <div style="font-family:Georgia,serif;line-height:1.7;color:#1a1a1a">
      <h2 style="color:#a93226;margin:0 0 4px">RuDao.us — Contact Form</h2>
      <p style="color:#6b6b6b;margin:0 0 20px;font-size:13px">儒道 · Beyond The Art of War</p>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${page ? `<p><strong>Sent from:</strong> ${escapeHtml(page)}</p>` : ''}
      <hr style="border:none;border-top:1px solid #e8e0cf;margin:20px 0" />
      <p style="white-space:pre-wrap;font-size:16px">${escapeHtml(message)}</p>
    </div>
  `;
  const text = `RuDao.us — Contact Form

Name:  ${name}
Email: ${email}
${page ? `Sent from: ${page}\n` : ''}
${message}
`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: email,
      subject,
      html,
      text
    })
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text().catch(() => '');
    return json(
      { success: false, error: 'Upstream email provider rejected the message.', detail: detail.slice(0, 400) },
      502
    );
  }

  return json({ success: true, delivered_to: to.length });
}

// Anything other than POST is not supported.
export async function onRequest(context) {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  return json({ success: false, error: 'Method not allowed. Use POST.' }, 405);
}
