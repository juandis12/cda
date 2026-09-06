import fs from 'fs';
import path from 'path';
import { isBlacklisted } from '../config/cda.config.js';

export interface CustomerRecord {
  id?: string;
  name: string;
  phone: string;
  plate: string;
  vehicleType?: string;
  serviceType?: string;
  brand?: string;
  model?: string;
  year?: string;
  fuel?: string;
  price?: string;
  lastInspectionDate?: string;
  rtmExpirationDate: string; // Formato YYYY-MM-DD
  soatExpirationDate?: string;
  notes?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const JSON_FILE = path.join(DATA_DIR, 'clientes.json');
const CSV_FILE = path.join(DATA_DIR, 'clientes.csv');

/**
 * Normalizar número de teléfono a formato de WhatsApp (Colombia 573XXXXXXXXX)
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  // Si contiene múltiples teléfonos (ej. "3101234567 / 3119876543")
  const parts = rawPhone.split(/[\/\,\-\s]+/);
  for (const p of parts) {
    const cleaned = p.replace(/[^0-9]/g, '');
    if (cleaned.length === 10 && cleaned.startsWith('3')) {
      return `57${cleaned}`;
    }
    if (cleaned.startsWith('57') && cleaned.length === 12 && cleaned[2] === '3') {
      return cleaned;
    }
  }
  const allClean = rawPhone.replace(/[^0-9]/g, '');
  if (allClean.length === 10 && allClean.startsWith('3')) {
    return `57${allClean}`;
  }
  if (allClean.startsWith('57') && allClean.length === 12) {
    return allClean;
  }
  return '';
}

/**
 * Normalizar fechas a formato estándar YYYY-MM-DD
 */
export function normalizeDate(rawDate: string): string {
  if (!rawDate) return '';
  const clean = rawDate.trim().split(' ')[0]; // quitar la hora si viene
  
  // Formato YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Formato DD/MM/YYYY o D/M/YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  return clean;
}

/**
 * Determinar precio exacto de acuerdo a tipo de vehículo y servicio
 */
export function getVehiclePrice(type?: string, service?: string): string {
  const t = (type || '').toUpperCase();
  const s = (service || '').toUpperCase();

  if (t.includes('MOTO')) {
    return '$247.274';
  }
  if (t.includes('PESADO')) {
    return s.includes('PUBLIC') || s.includes('PÚBLIC') ? '$562.084' : '$562.584';
  }
  // Por defecto Livianos
  return s.includes('PUBLIC') || s.includes('PÚBLIC') ? '$367.937' : '$368.537';
}

let cachedCustomers: CustomerRecord[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 segundos de caché ultrarrápido en RAM

/**
 * Cargar todos los clientes registrados desde CSV o JSON con caché en memoria
 */
export function getAllCustomers(forceRefresh: boolean = false): CustomerRecord[] {
  const now = Date.now();
  if (!forceRefresh && cachedCustomers && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedCustomers;
  }

  const customers: CustomerRecord[] = [];
  const seenPlates = new Set<string>();

  // Lista de archivos CSV a procesar
  const csvFilesToProcess: string[] = [];
  if (fs.existsSync(CSV_FILE)) csvFilesToProcess.push(CSV_FILE);

  // Escanear cualquier reporte RepGeneral*.csv en el directorio raíz y en data/
  try {
    const rootFiles = fs.readdirSync(process.cwd()).filter((f) => f.startsWith('RepGeneral') && f.endsWith('.csv'));
    for (const rf of rootFiles) {
      const full = path.join(process.cwd(), rf);
      if (!csvFilesToProcess.includes(full)) csvFilesToProcess.push(full);
    }
  } catch {}

  // 1. Cargar desde CSVs
  for (const filePath of csvFilesToProcess) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        if (!line.includes(';')) continue;
        const cols = line.split(';').map((c) => c.trim().replace(/^["']|["']$/g, ''));

        // Formato exportación CDA (más de 20 columnas)
        if (cols.length >= 15) {
          const plate = (cols[10] || '').toUpperCase().trim();
          if (!plate || plate.length < 5) continue;

          // Extraer teléfono del propietario (col 38) o tomador (col 46)
          let phoneRaw = cols[38] || cols[46] || '';
          if (phoneRaw.startsWith('000') || phoneRaw === '0') {
            phoneRaw = cols[46] || '';
          }
          const phone = normalizePhone(phoneRaw);
          if (!phone || phone.length < 10 || isBlacklisted(phone)) continue;

          const name = cols[34] || cols[42] || 'Cliente';
          const rtmExp = normalizeDate(cols[6] || '');
          const lastInsp = cols[2] || '';
          const vehicleType = cols[11] || (cols[9]?.includes('MOTO') ? 'MOTOS' : 'LIVIANO');
          const brand = cols[12] || '';
          const lineModel = cols[13] || '';
          const year = cols[14] || '';
          const serviceType = cols[15] || 'PARTICULAR';
          const fuel = cols[26] || 'GASOLINA';
          const soatExp = normalizeDate(cols[31] || '');
          const price = getVehiclePrice(vehicleType, serviceType);

          const fullModel = [lineModel, year ? `(${year})` : ''].filter(Boolean).join(' ');

          if (!seenPlates.has(plate)) {
            seenPlates.add(plate);
            customers.push({
              name: name.replace(/\s+/g, ' ').trim(),
              phone,
              plate,
              vehicleType,
              serviceType,
              brand,
              model: fullModel,
              year,
              fuel,
              price,
              lastInspectionDate: lastInsp,
              rtmExpirationDate: rtmExp,
              soatExpirationDate: soatExp,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error leyendo ${filePath}:`, err);
    }
  }

  // 2. Cargar desde JSON adicional
  if (fs.existsSync(JSON_FILE)) {
    try {
      const raw = fs.readFileSync(JSON_FILE, 'utf-8');
      const parsed: CustomerRecord[] = JSON.parse(raw || '[]');
      for (const item of parsed) {
        const cleanPhone = normalizePhone(item.phone);
        if (isBlacklisted(cleanPhone)) continue;
        const plate = item.plate.toUpperCase().trim();
        if (!seenPlates.has(plate)) {
          seenPlates.add(plate);
          customers.push({
            ...item,
            phone: cleanPhone,
            plate,
            price: item.price || getVehiclePrice(item.vehicleType, item.serviceType),
            rtmExpirationDate: normalizeDate(item.rtmExpirationDate),
          });
        }
      }
    } catch (err) {
      console.error('Error leyendo clientes.json:', err);
    }
  }

  cachedCustomers = customers;
  lastCacheTime = now;
  return customers;
}

/**
 * Obtener clientes cuya Revisión Técnico-Mecánica vence en un número específico de días
 */
export function getCustomersExpiringInDays(daysAhead: number): CustomerRecord[] {
  const all = getAllCustomers();
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysAhead);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  return all.filter((c) => normalizeDate(c.rtmExpirationDate) === targetDateStr);
}
