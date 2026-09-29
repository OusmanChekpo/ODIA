'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeContactName(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeInternationalPhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Utilise un numéro international au format + indicatif pays et numéro, par exemple +229…');
  return phone;
}

class ContactsService {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.resolve(__dirname, '..', '..', 'data'));
    this.file = path.join(this.dataDir, 'contacts.json');
    this.items = [];
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.items = Array.isArray(data) ? data.filter((item) => item && typeof item.name === 'string' && typeof item.phone === 'string') : [];
    } catch { this.items = []; }
    return this;
  }

  async persist() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.items, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.file);
  }

  async add(name, phone) {
    const cleanName = String(name || '').trim().slice(0, 80);
    const normalized = normalizeContactName(cleanName);
    const e164 = normalizeInternationalPhone(phone);
    if (!normalized) throw new Error('Indique un nom de contact.');
    const existing = this.items.findIndex((item) => normalizeContactName(item.name) === normalized);
    const item = { name: cleanName, phone: e164, updatedAt: new Date().toISOString() };
    if (existing >= 0) this.items[existing] = item;
    else this.items.push(item);
    await this.persist();
    return { text: `Contact **${cleanName}** enregistré localement pour WhatsApp. 📇` };
  }

  list() {
    return this.items.map(({ name, phone }) => ({ name, phone }));
  }

  find(name) {
    const normalized = normalizeContactName(name);
    if (!normalized) return null;
    return this.items.find((item) => normalizeContactName(item.name) === normalized) || null;
  }

  prepareWhatsApp(name, message) {
    const contact = this.find(name);
    if (!contact) return { error: `Je ne trouve pas « ${String(name).trim()} » dans tes contacts locaux. Ajoute-le avec « ajoute contact ${String(name).trim()} +indicatif… » puis réessaie.` };
    const text = String(message || '').trim().slice(0, 1200);
    if (!text) return { error: 'Le message est vide. Dis ce que tu veux envoyer.' };
    const digits = contact.phone.replace(/\D/g, '');
    const url = new URL(`https://wa.me/${digits}`);
    url.searchParams.set('text', text);
    return { contact: { name: contact.name, phone: contact.phone }, message: text, url: url.href };
  }
}

module.exports = { ContactsService, normalizeContactName, normalizeInternationalPhone };
