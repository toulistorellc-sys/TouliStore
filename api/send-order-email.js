// Vercel serverless function — sends the order-confirmation email with Resend
// ONLY after PayPal confirms the payment is really COMPLETED.
// Secrets live in Vercel → Settings → Environment Variables (never in index.html).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toFixed(2);

function addBD(d, n) {            // add business days
  const x = new Date(d);
  while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) n--; }
  return x;
}

const TXT = {
  en: { subj: 'Order {id} confirmed — Touli Store', hi: 'Thank you, {n}!', lead: 'Your payment was received and your order is confirmed.', order: 'Order', items: 'Your items', qty: 'Qty', sub: 'Subtotal', ship: 'Shipping', free: 'FREE', tax: 'Sales tax', total: 'Total paid', to: 'Shipping to', carrier: 'Delivery company', est: 'Estimated delivery', track: 'Your delivery steps', view: 'View my order', foot: 'Questions? Just reply to this email.', st: ['Order received', 'Design approved', 'Made & engraved', 'Shipped with USPS', 'Delivered'], sd: ['Done ✓', 'Preview emailed within 24 h', '3–5 business days', 'Tracking number sent to you', 'At your door'], note: 'We will email you a preview of your design to approve before we make it.' },
  fr: { subj: 'Commande {id} confirmée — Touli Store', hi: 'Merci, {n} !', lead: 'Votre paiement a bien été reçu et votre commande est confirmée.', order: 'Commande', items: 'Vos articles', qty: 'Qté', sub: 'Sous-total', ship: 'Livraison', free: 'GRATUITE', tax: 'Taxe de vente', total: 'Total payé', to: 'Livraison à', carrier: 'Transporteur', est: 'Livraison estimée', track: 'Les étapes de votre livraison', view: 'Voir ma commande', foot: 'Des questions ? Répondez simplement à cet e-mail.', st: ['Commande reçue', 'Création approuvée', 'Fabriquée & gravée', 'Expédiée avec USPS', 'Livrée'], sd: ['Terminé ✓', 'Aperçu envoyé sous 24 h', '3–5 jours ouvrables', 'Numéro de suivi envoyé', 'Chez vous'], note: 'Nous vous enverrons un aperçu de votre création à approuver avant la fabrication.' },
  es: { subj: 'Pedido {id} confirmado — Touli Store', hi: '¡Gracias, {n}!', lead: 'Recibimos tu pago y tu pedido está confirmado.', order: 'Pedido', items: 'Tus artículos', qty: 'Cant.', sub: 'Subtotal', ship: 'Envío', free: 'GRATIS', tax: 'Impuesto de venta', total: 'Total pagado', to: 'Enviar a', carrier: 'Empresa de entrega', est: 'Entrega estimada', track: 'Los pasos de tu entrega', view: 'Ver mi pedido', foot: '¿Preguntas? Solo responde a este correo.', st: ['Pedido recibido', 'Diseño aprobado', 'Hecho y grabado', 'Enviado con USPS', 'Entregado'], sd: ['Listo ✓', 'Vista previa en 24 h', '3–5 días hábiles', 'Número de rastreo enviado', 'En tu puerta'], note: 'Te enviaremos una vista previa de tu diseño para aprobarla antes de fabricarlo.' }
};

async function imageOrLogo(site, rel) {      // use the product photo if it exists, otherwise the logo
  const logo = site + '/assets/logo.png';
  if (!rel || /^data:/i.test(rel)) return logo;
  const url = /^https?:/i.test(rel) ? rel : site + '/' + String(rel).replace(/^\/+/, '');
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok ? url : logo; } catch { return logo; }
}

async function verifyPayPal(orderID, expectedTotal) {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return { ok: false, why: 'PayPal secret not configured' };
  const base = process.env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const auth = 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
  const tk = await fetch(base + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!tk.ok) return { ok: false, why: 'PayPal auth failed' };
  const { access_token } = await tk.json();
  const r = await fetch(base + '/v2/checkout/orders/' + encodeURIComponent(orderID), { headers: { Authorization: 'Bearer ' + access_token } });
  if (!r.ok) return { ok: false, why: 'PayPal order not found' };
  const o = await r.json();
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  if (o.status !== 'COMPLETED' || !cap || cap.status !== 'COMPLETED') return { ok: false, why: 'Payment not completed' };
  const paid = Number(cap.amount?.value);
  if (Math.abs(paid - Number(expectedTotal)) > 0.011) return { ok: false, why: 'Amount mismatch' };
  return { ok: true, paid };
}

async function buildEmail(b, site) {
  const T = TXT[b.lang] || TXT.en;
  const first = esc(String(b.name || '').trim().split(/\s+/)[0] || '');
  const d = new Date(b.date || Date.now()), ex = /Express/i.test(b.service || '');
  const fd = x => x.toLocaleDateString(b.lang === 'fr' ? 'fr-FR' : b.lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric' });
  const est = fd(addBD(d, ex ? 5 : 8)) + ' – ' + fd(addBD(d, ex ? 9 : 15));

  const rows = [];
  for (const it of (b.items || []).slice(0, 20)) {
    const img = await imageOrLogo(site, it.img);
    rows.push(`<tr><td style="padding:12px 0;border-bottom:1px solid #f0e8dc;width:84px"><img src="${esc(img)}" width="72" height="72" alt="" style="display:block;border-radius:12px;object-fit:cover;background:#f6f1ea"></td>
<td style="padding:12px 10px;border-bottom:1px solid #f0e8dc;font-size:14px;color:#1a2233"><b>${esc(it.name)}</b><div style="font-size:12px;color:#7a8394;margin-top:4px;line-height:1.5">${esc(it.options)}</div></td>
<td style="padding:12px 0;border-bottom:1px solid #f0e8dc;font-size:13px;color:#445;text-align:right;white-space:nowrap">${esc(T.qty)} ${Number(it.qty) || 1}<br><b style="color:#1a2233">${money(it.price * it.qty)}</b></td></tr>`);
  }

  const steps = T.st.map((s, i) => {
    const done = i === 0;
    const circle = `<div style="width:34px;height:34px;line-height:34px;border-radius:50%;margin:0 auto 8px;font-weight:800;font-size:14px;text-align:center;${done ? 'background:#12a05c;color:#fff' : (i === 1 ? 'background:#ff7900;color:#fff' : 'background:#ece6dc;color:#7a8394')}">${done ? '✓' : i + 1}</div>`;
    return `<td valign="top" align="center" style="width:20%;padding:0 3px">${circle}<div style="font-size:12px;font-weight:700;color:#1a2233;line-height:1.3">${esc(s)}</div><div style="font-size:11px;color:#7a8394;margin-top:3px;line-height:1.35">${esc(i === 4 ? est : T.sd[i])}</div></td>`;
  }).join('');

  const a = b.addr || {};
  const line = (l, v, bold) => `<tr><td style="padding:4px 0;font-size:14px;color:${bold ? '#1a2233' : '#556'};${bold ? 'font-weight:800;font-size:17px;border-top:1px solid #f0e8dc;padding-top:10px' : ''}">${l}</td><td align="right" style="padding:4px 0;font-size:14px;color:${bold ? '#1a2233' : '#556'};${bold ? 'font-weight:800;font-size:17px;border-top:1px solid #f0e8dc;padding-top:10px' : ''}">${v}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,#ff7900,#ff9a2e);padding:22px 28px"><img src="${site}/assets/logo.png" height="40" alt="Touli Store" style="display:block;background:#fff;border-radius:10px;padding:4px 10px"></td></tr>
<tr><td style="padding:30px 28px 6px"><div style="font-size:26px;font-weight:800;color:#1a2233">${T.hi.replace('{n}', first)}</div>
<p style="font-size:15px;color:#556;line-height:1.6;margin:10px 0 4px">${T.lead}</p>
<p style="font-size:13px;color:#7a8394;margin:0">${T.order} <b style="color:#1a2233">${esc(b.orderId)}</b> · ${fd(d)}</p></td></tr>
<tr><td style="padding:20px 28px 0"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#d86a00;margin-bottom:6px">${T.items}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${line(T.sub, money(b.subtotal))}${line(T.ship, Number(b.shipping) ? money(b.shipping) : T.free)}${Number(b.tax) ? line(T.tax, money(b.tax)) : ''}${line(T.total, money(b.total), true)}</table></td></tr>
<tr><td style="padding:26px 28px 0"><div style="background:#fff8f0;border:1px solid #f1d9b9;border-radius:16px;padding:20px 12px">
<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#d86a00;margin:0 10px 16px">${T.track}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${steps}</tr></table>
<p style="font-size:12px;color:#7a8394;margin:16px 10px 0;line-height:1.5">${T.note}</p></div></td></tr>
<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" style="width:50%;font-size:13px;color:#556;line-height:1.6;padding-right:10px"><b style="color:#1a2233">${T.carrier}</b><br>🚚 USPS ${esc(String(b.service || '').replace(/^USPS\s*/i, ''))}<br><span style="color:#7a8394">${T.est}: <b style="color:#1a2233">${est}</b></span></td>
<td valign="top" style="width:50%;font-size:13px;color:#556;line-height:1.6"><b style="color:#1a2233">${T.to}</b><br>${esc(a.n)}<br>${esc(a.a)}<br>${esc(a.c)}${a.s ? ', ' + esc(a.s) : ''} ${esc(a.z)}</td></tr></table></td></tr>
<tr><td align="center" style="padding:28px"><a href="${site}/#/orders" style="display:inline-block;background:#ff7900;color:#fff;font-weight:800;text-decoration:none;border-radius:30px;padding:14px 30px;font-size:15px">${T.view}</a></td></tr>
<tr><td style="background:#111a2e;padding:18px 28px;text-align:center;font-size:12px;color:#aeb7c7;line-height:1.6">${T.foot}<br>Touli Store · toulistorellc@gmail.com</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: T.subj.replace('{id}', b.orderId), html };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'RESEND_API_KEY missing' });
  const site = (process.env.SITE_URL || 'https://toulistore.vercel.app').replace(/\/+$/, '');
  const from = process.env.FROM_EMAIL || 'Touli Store <onboarding@resend.dev>';
  const owner = process.env.STORE_NOTIFY_EMAIL || 'toulistorellc@gmail.com';

  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  if (!b.orderId || !b.paypalOrderId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return res.status(400).json({ error: 'Bad request' });

  try {
    const v = await verifyPayPal(b.paypalOrderId, b.total);     // real payment check
    if (!v.ok) return res.status(402).json({ error: v.why });

    const { subject, html } = await buildEmail(b, site);
    const send = (payload, idem) => fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify(payload) });

    const r1 = await send({ from, to: [b.email], subject, html, reply_to: owner }, 'cust-' + b.paypalOrderId);
    const a = b.addr || {};
    const r2 = await send({ from, to: [owner], subject: '🛍️ New paid order ' + b.orderId + ' — ' + money(b.total), html: `<p><b>${esc(b.orderId)}</b> · ${money(b.total)} · USPS ${esc(b.service)}</p><p>${esc(a.n)}<br>${esc(a.a)}, ${esc(a.c)} ${esc(a.s)} ${esc(a.z)}<br>${esc(a.p)} · ${esc(b.email)}</p><ul>${(b.items || []).map(i => `<li>${esc(i.name)} × ${Number(i.qty) || 1} — ${esc(i.options)}</li>`).join('')}</ul>`, reply_to: b.email }, 'owner-' + b.paypalOrderId);
    if (!r1.ok) return res.status(502).json({ error: 'Resend: ' + (await r1.text()) });
    return res.status(200).json({ ok: true, owner: r2.ok });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
