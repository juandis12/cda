import fs from 'fs';
import path from 'path';
import { getPauseStatus } from './pause.service.js';

export interface ChatMessage {
  id: string;
  from: string; // Número de teléfono normalizado (573XXXXXXXXX)
  name?: string;
  text: string;
  sender: 'CLIENT' | 'BOT' | 'AGENT';
  timestamp: string;
  plate?: string;
}

export interface ConversationSummary {
  phone: string;
  name: string;
  lastMessage: string;
  lastTimestamp: string;
  unread: number;
  totalMessages: number;
  plate?: string;
  isPaused?: boolean;
  remainingPauseMinutes?: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CHAT_FILE = path.join(DATA_DIR, 'chat_history.json');
const SESSIONS_DIR = path.resolve(process.cwd(), 'bot_sessions');

const messagesCache: ChatMessage[] = [];

/**
 * Normaliza cualquier LID o número de teléfono a formato estándar colombiano 573XXXXXXXXX
 */
export const normalizePhoneNumber = (raw: string): string => {
  if (!raw) return '';
  let clean = raw.replace(/[^0-9]/g, '');
  if (!clean) return '';

  // 1. Revisar en bot_sessions/lid-cache.json
  try {
    const lidCachePath = path.join(SESSIONS_DIR, 'lid-cache.json');
    if (fs.existsSync(lidCachePath)) {
      const lidCache = JSON.parse(fs.readFileSync(lidCachePath, 'utf-8'));
      const entries = lidCache.entries || {};
      for (const [lidKey, val] of Object.entries<any>(entries)) {
        const cleanLid = lidKey.replace(/[^0-9]/g, '');
        if (clean === cleanLid) {
          const pn = (val?.pn || '').replace(/[^0-9]/g, '');
          if (pn) return pn;
        }
      }
    }
  } catch {}

  // 2. Mapeos conocidos de LIDs
  if (clean === '191878267973683') return '573025897192'; // Juan Diego Ruiz
  if (clean === '17875771343051') return '573508496417';  // Juan Pablo Copete
  if (clean === '56109989646559') return '573112921709';  // Revicar SAS
  if (clean === '221281177878779') return '573023752035'; // Jefe Leonardo / Cardeñoza
  if (clean === '254017317953725') return '573125491389'; // Don Juan Pablo
  if (clean === '247970037542992') return '573165113380'; // Martha García
  if (clean === '255112501018652') return '573209703695'; // Deyanira (FAI65A)

  // 3. Si es un celular colombiano de 10 dígitos (3XXXXXXXXX), agregar prefijo 57
  if (clean.length === 10 && clean.startsWith('3')) {
    return '57' + clean;
  }

  return clean;
};

/**
 * Convierte eventos crudos de Baileys/BuilderBot (_event_media__, etc.) en textos legibles con iconos
 */
export const formatFriendlyMediaText = (raw: string): string => {
  if (!raw) return '';
  const text = String(raw).trim();

  // Foto o Imagen / Video
  if (/^(_?event_?media|eventmedia|__event_media__)/i.test(text)) {
    return '📷 [Foto / Imagen recibida]';
  }
  // Audio o Nota de voz
  if (/^(_?event_?(voice_note|audio)|eventvoicenote|eventaudio)/i.test(text)) {
    return '🎤 [Nota de voz / Audio recibido]';
  }
  // Documento / Archivo
  if (/^(_?event_?document|eventdocument|eventfile)/i.test(text)) {
    return '📄 [Documento / Archivo adjunto]';
  }
  // Llamada
  if (/^(_?event_?call|eventcall)/i.test(text)) {
    return '📞 [Llamada de WhatsApp]';
  }
  // Ubicación
  if (/^(_?event_?location|eventlocation)/i.test(text)) {
    return '📍 [Ubicación GPS compartida]';
  }
  // Pedido / Orden
  if (/^(_?event_?order|eventorder)/i.test(text)) {
    return '🛒 [Pedido / Orden recibida]';
  }

  return text;
};

// Inicializar almacenamiento
export const initChatStorage = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CHAT_FILE)) {
    fs.writeFileSync(CHAT_FILE, JSON.stringify([], null, 2), 'utf-8');
  } else if (messagesCache.length === 0) {
    try {
      const raw = fs.readFileSync(CHAT_FILE, 'utf-8');
      const parsed: ChatMessage[] = JSON.parse(raw || '[]');
      
      // Normalizar teléfonos y textos en caché cargado
      for (const msg of parsed) {
        msg.from = normalizePhoneNumber(msg.from);
        msg.text = formatFriendlyMediaText(msg.text);
        if (msg.from === '573025897192') {
          msg.name = 'Juan Diego Ruiz';
          msg.plate = msg.plate || 'AGI18G';
        } else if (msg.from === '573023752035') {
          msg.name = 'Cardeñoza (Jefe Leonardo)';
        } else if (msg.from === '573125491389') {
          msg.name = 'Don Juan Pablo';
        } else if (msg.from === '573112921709') {
          msg.name = 'Revicar SAS SOAT';
        }
      }
      messagesCache.push(...parsed);
    } catch {
      // Ignorar
    }
  }
};

const persistMessages = () => {
  try {
    initChatStorage();
    fs.writeFileSync(CHAT_FILE, JSON.stringify(messagesCache.slice(-2000), null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando historial de chat:', err);
  }
};

export const addMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage => {
  initChatStorage();
  const cleanPhone = normalizePhoneNumber(msg.from);
  const formattedText = formatFriendlyMediaText(msg.text || '');
  if (!cleanPhone || !formattedText) {
    return {
      id: `MSG-${Date.now()}`,
      from: cleanPhone || '',
      text: formattedText || '',
      sender: msg.sender,
      timestamp: new Date().toISOString(),
    };
  }

  // Deduplicación: si el mismo mensaje con el mismo remitente y teléfono llegó en los últimos 2.5 segundos
  const now = Date.now();
  const isDuplicate = messagesCache.slice(-10).some((m) => {
    const timeDiff = now - new Date(m.timestamp).getTime();
    return (
      m.from === cleanPhone &&
      m.sender === msg.sender &&
      m.text.trim() === formattedText.trim() &&
      timeDiff < 2500
    );
  });

  if (isDuplicate) {
    return messagesCache[messagesCache.length - 1];
  }

  // Buscar nombre y placa en mensajes previos si no vienen especificados
  let name = msg.name;
  let plate = msg.plate;

  if (!name || !plate) {
    for (let i = messagesCache.length - 1; i >= 0; i--) {
      const prev = messagesCache[i];
      if (prev.from === cleanPhone) {
        if (!name && prev.name && prev.name !== 'Cliente') name = prev.name;
        if (!plate && prev.plate) plate = prev.plate;
        if (name && plate) break;
      }
    }
  }

  // Buscar también en clientes.json si sigue sin nombre/placa
  if (!name || !plate) {
    try {
      const clientesRaw = fs.readFileSync(path.join(DATA_DIR, 'clientes.json'), 'utf-8');
      const clientes = JSON.parse(clientesRaw || '[]');
      const match = clientes.find((c: any) => {
        const cPhone = normalizePhoneNumber(c.phone || '');
        return cPhone && (cPhone === cleanPhone || cleanPhone.endsWith(cPhone) || cPhone.endsWith(cleanPhone));
      });
      if (match) {
        if (!name || name === 'Cliente') name = match.name;
        if (!plate) plate = match.plate;
      }
    } catch {}
  }

  // Nombres de contactos administrativos o excluidos
  if (!name || name === 'Cliente') {
    if (cleanPhone.endsWith('3112921709')) name = 'Revicar SAS SOAT';
    else if (cleanPhone.endsWith('3125491389')) name = 'Don Juan Pablo';
    else if (cleanPhone.endsWith('3023752035')) name = 'Cardeñoza (Jefe Leonardo)';
    else if (cleanPhone.endsWith('3025897192')) name = 'Juan Diego Ruiz';
    else if (cleanPhone.endsWith('3508496417')) name = 'Juan Pablo Copete';
    else if (cleanPhone.endsWith('3209703695')) name = 'Deyanira';
  }

  const newMsg: ChatMessage = {
    id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    from: cleanPhone,
    name: name || (msg.sender === 'CLIENT' ? 'Cliente' : undefined),
    text: formattedText,
    sender: msg.sender,
    timestamp: new Date().toISOString(),
    plate,
  };

  messagesCache.push(newMsg);
  persistMessages();
  return newMsg;
};

export const getConversation = (phone: string): ChatMessage[] => {
  initChatStorage();
  const cleanPhone = normalizePhoneNumber(phone);
  return messagesCache.filter((m) => {
    const mPhone = normalizePhoneNumber(m.from);
    return mPhone === cleanPhone || mPhone.endsWith(cleanPhone) || cleanPhone.endsWith(mPhone);
  });
};

export const getAllConversations = (): ConversationSummary[] => {
  initChatStorage();
  const map = new Map<string, ConversationSummary>();

  for (const m of messagesCache) {
    const cleanPhone = normalizePhoneNumber(m.from);
    if (!cleanPhone) continue;

    const existing = map.get(cleanPhone);
    let name = m.name;
    if (!name || name === 'Cliente') {
      name = existing?.name || `Cliente (${cleanPhone.slice(-4)})`;
    }
    const plate = m.plate || existing?.plate;

    map.set(cleanPhone, {
      phone: cleanPhone,
      name,
      lastMessage: m.text,
      lastTimestamp: m.timestamp,
      unread: 0,
      totalMessages: (existing?.totalMessages || 0) + 1,
      plate,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

