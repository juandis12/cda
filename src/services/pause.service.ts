import fs from 'fs';
import path from 'path';
import { normalizePhoneNumber } from './chat-history.service.js';

interface PauseRecord {
  phone: string;
  pausedAt: string;
  pausedUntil: number; // Timestamp en ms
  reason?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PAUSE_FILE = path.join(DATA_DIR, 'bot_pauses.json');

const memoryPauses = new Map<string, PauseRecord>();

export const initPauseStorage = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PAUSE_FILE)) {
    fs.writeFileSync(PAUSE_FILE, JSON.stringify({}, null, 2), 'utf-8');
  } else if (memoryPauses.size === 0) {
    try {
      const raw = fs.readFileSync(PAUSE_FILE, 'utf-8');
      const parsed: Record<string, PauseRecord> = JSON.parse(raw || '{}');
      for (const [phone, record] of Object.entries(parsed)) {
        if (record.pausedUntil > Date.now()) {
          memoryPauses.set(normalizePhoneNumber(phone), record);
        }
      }
    } catch {}
  }
};

const persistPauses = () => {
  try {
    initPauseStorage();
    const obj: Record<string, PauseRecord> = {};
    for (const [phone, record] of memoryPauses.entries()) {
      if (record.pausedUntil > Date.now()) {
        obj[phone] = record;
      }
    }
    fs.writeFileSync(PAUSE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando pausas de bot:', err);
  }
};

/**
 * Pausar respuestas automáticas para un número por N horas (por defecto 3 horas)
 */
export const pauseBotForPhone = (phone: string, durationHours: number = 3): PauseRecord => {
  initPauseStorage();
  const cleanPhone = normalizePhoneNumber(phone);
  const now = Date.now();
  const pausedUntil = now + durationHours * 60 * 60 * 1000;

  const record: PauseRecord = {
    phone: cleanPhone,
    pausedAt: new Date(now).toISOString(),
    pausedUntil,
    reason: 'HUMAN_AGENT',
  };

  memoryPauses.set(cleanPhone, record);
  persistPauses();
  console.log(`⏸️ [Bot Pausado] Usuario +${cleanPhone} silenciado por ${durationHours} horas (hasta ${new Date(pausedUntil).toLocaleTimeString()})`);
  return record;
};

/**
 * Reactivar el bot inmediatamente para un número
 */
export const unpauseBotForPhone = (phone: string): void => {
  initPauseStorage();
  const cleanPhone = normalizePhoneNumber(phone);
  if (memoryPauses.has(cleanPhone)) {
    memoryPauses.delete(cleanPhone);
    persistPauses();
    console.log(`▶️ [Bot Reactivado] Usuario +${cleanPhone} ya puede recibir respuestas automáticas.`);
  }
};

/**
 * Verificar si el bot está pausado para un número
 */
export const isBotPaused = (phone: string): boolean => {
  initPauseStorage();
  const cleanPhone = normalizePhoneNumber(phone);
  const record = memoryPauses.get(cleanPhone);
  if (!record) return false;

  if (Date.now() >= record.pausedUntil) {
    memoryPauses.delete(cleanPhone);
    persistPauses();
    return false;
  }

  return true;
};

/**
 * Obtener el estado detallado de la pausa
 */
export const getPauseStatus = (phone: string) => {
  initPauseStorage();
  const cleanPhone = normalizePhoneNumber(phone);
  const record = memoryPauses.get(cleanPhone);

  if (!record || Date.now() >= record.pausedUntil) {
    return { isPaused: false, remainingMinutes: 0, pausedUntil: null };
  }

  const remainingMs = record.pausedUntil - Date.now();
  const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));

  return {
    isPaused: true,
    remainingMinutes,
    pausedUntil: new Date(record.pausedUntil).toISOString(),
  };
};
