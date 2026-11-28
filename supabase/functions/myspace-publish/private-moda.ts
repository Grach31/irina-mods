import {visibleCaption} from './core.ts';

const CATEGORIES = new Set(['clothing', 'bags', 'shoes', 'jewelry', 'accessories']);
export const PRIVATE_MODA_ID = /^\d{4}-\d{2}-\d{2}-gcc-[a-f0-9]{16,64}$/;
const SHA = /^[a-f0-9]{64}$/;
const escape = (value: string) => value.replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

type Item = {name: string; shop: string; price: number; url: string; photo_sha256: string};
type Manifest = {id: string; title: string; text: string; items: Item[]};

export async function approvedPrivateModa(id: string, revision: string, raw: string,
  sha: (value: string) => Promise<string>): Promise<Manifest> {
  if (!PRIVATE_MODA_ID.test(id) || !SHA.test(revision)) throw Error('revision_required');
  if (!raw || new TextEncoder().encode(raw).length > 100_000) throw Error('draft_unavailable');
  if (await sha(raw) !== revision) throw Error('draft_changed');
  const m = JSON.parse(raw);
  if (!m || m.schema_version !== 1 || m.mode !== 'private_preview' || m.id !== id ||
      m.rights_verified !== false || m.publication_allowed !== false || !CATEGORIES.has(m.category) ||
      typeof m.title !== 'string' || !m.title.trim() || m.title.length > 75 ||
      !SHA.test(m.cover_sha256) || !SHA.test(m.source_archive_sha256) ||
      typeof m.text !== 'string' || m.text.length > 12_000 || !Array.isArray(m.items) || m.items.length !== 3) {
    throw Error('draft_held_or_invalid');
  }
  const urls = new Set(), photos = new Set([m.cover_sha256]);
  for (const item of m.items) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 ||
        typeof item.shop !== 'string' || item.shop.length > 100 || !Number.isFinite(item.price) ||
        item.price <= 0 || item.price > 10_000_000 || typeof item.url !== 'string' || item.url.length > 2048 ||
        !SHA.test(item.photo_sha256) || photos.has(item.photo_sha256)) throw Error('draft_held_or_invalid');
    let source;
    try { source = new URL(item.url); } catch { throw Error('draft_held_or_invalid'); }
    if (source.protocol !== 'https:' || source.username || source.password ||
        /[\x00-\x20\x7f]/.test(item.url) || urls.has(source.href)) throw Error('draft_held_or_invalid');
    urls.add(source.href);
    photos.add(item.photo_sha256);
  }
  return m;
}

export function privateModaMessage(manifest: Manifest, channel: string) {
  // The private manifest stores title, advice and product lines in this order.
  // Rebuild the Telegram links from checked item data, never from stored markup.
  const [title, blank, advice] = manifest.text.split('\n');
  if (visibleCaption(title) !== manifest.title || blank !== '' || !advice?.trim()) {
    throw Error('draft_held_or_invalid');
  }
  const lines = manifest.items.map(item => {
    const price = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(item.price);
    return `• <a href="${escape(item.url)}">${escape(item.name)} — ${escape(item.shop)}</a> — ${price} ₽`;
  });
  const text = [`<b>${escape(manifest.title)}</b>`, '', escape(visibleCaption(advice)), '', ...lines].join('\n');
  if (visibleCaption(text).length > 4096) throw Error('caption_too_long');
  const form = new FormData();
  form.set('chat_id', channel);
  form.set('text', text);
  form.set('parse_mode', 'HTML');
  form.set('link_preview_options', JSON.stringify({is_disabled: true}));
  return form;
}
