import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { cdaConfig } from '../config/cda.config.js';
import { saveBooking, getBookingsByDate } from './booking.service.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.resolve(process.cwd(), 'google-credentials.json');
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

export interface TimeSlot {
  time: string;       // e.g. "07:30"
  display: string;    // e.g. "07:30 AM"
  isoStart: string;   // ISO string
  isoEnd: string;     // ISO string (30 mins later)
  available: boolean;
}

export interface BookingRequest {
  phone: string;
  name: string;
  plate: string;
  vehicleType: string;
  fuelType?: string;
  brand?: string;
  model?: string;
  dateStr: string; // ISO date format YYYY-MM-DD
  timeSlot: TimeSlot;
}

/**
 * Obtener cliente autenticado de Google Calendar
 */
function getCalendarClient() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: SCOPES,
      });
      return google.calendar({ version: 'v3', auth });
    }

    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: SCOPES,
      });
      return google.calendar({ version: 'v3', auth });
    }
  } catch (error) {
    console.warn('⚠️ Google Calendar no configurado aún o credenciales inválidas. Usando agenda local.');
  }
  return null;
}

/**
 * Extraer año, mes y día de forma segura sin desfase de zona horaria
 */
function parseDateParts(dateString: string) {
  const parts = dateString.split('-').map((p) => parseInt(p, 10));
  return { year: parts[0], month: parts[1] - 1, day: parts[2] };
}

/**
 * Determinar horario de apertura y cierre según día de la semana
 * - Lunes a Viernes: 7:00 AM a 7:00 PM (19:00)
 * - Sábados: 7:00 AM a 5:00 PM (17:00)
 * - Domingos y Festivos: 8:00 AM a 12:00 PM (12:00)
 */
function getBusinessHoursForDate(year: number, month: number, dayOfMonth: number) {
  // Mediodía local para calcular el día de la semana exacto sin riesgo de desfase por UTC
  const dateObj = new Date(year, month, dayOfMonth, 12, 0, 0);
  const dayOfWeek = dateObj.getDay(); // 0 = Domingo, 6 = Sábado, 1 a 5 = Lunes a Viernes

  if (dayOfWeek === 0) {
    // Domingos y Festivos: 8:00 AM a 12:00 PM
    return {
      openHour: 8,
      openMin: 0,
      closeHour: 12,
      closeMin: 0,
    };
  } else if (dayOfWeek === 6) {
    // Sábados: 7:00 AM a 5:00 PM
    return {
      openHour: 7,
      openMin: 0,
      closeHour: 17,
      closeMin: 0,
    };
  } else {
    // Lunes a Viernes: 7:00 AM a 7:00 PM
    return {
      openHour: 7,
      openMin: 0,
      closeHour: 19,
      closeMin: 0,
    };
  }
}

/**
 * Formatear hora a formato AM/PM
 */
function formatAmPm(hour: number, min: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayMin = min < 10 ? `0${min}` : `${min}`;
  return `${displayHour}:${displayMin} ${period}`;
}

export function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || 'cajacdagirardot@gmail.com';
}

/**
 * Consultar turnos disponibles en Google Calendar para una fecha específica (en bloques de 30 min)
 * Filtra automáticamente las horas pasadas si la fecha es hoy.
 */
export async function getAvailableTimeSlots(dateString: string): Promise<TimeSlot[]> {
  const { year, month, day } = parseDateParts(dateString);
  const { openHour, openMin, closeHour, closeMin } = getBusinessHoursForDate(year, month, day);
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

  const dayStart = new Date(year, month, day, openHour, openMin, 0, 0);
  const dayEnd = new Date(year, month, day, closeHour, closeMin, 0, 0);

  // Obtener eventos ocupados en Google Calendar
  const busyIntervals: { start: number; end: number }[] = [];

  if (calendar) {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      for (const ev of events) {
        if (ev.start?.dateTime && ev.end?.dateTime) {
          busyIntervals.push({
            start: new Date(ev.start.dateTime).getTime(),
            end: new Date(ev.end.dateTime).getTime(),
          });
        }
      }
    } catch (err: any) {
      console.error('Error al consultar eventos en Google Calendar:', err?.message || err);
    }
  }

  // También cruzamos con citas guardadas localmente
  const localBookings = getBookingsByDate(dateString);
  for (const b of localBookings) {
    if (b.isoStart && b.isoEnd) {
      busyIntervals.push({
        start: new Date(b.isoStart).getTime(),
        end: new Date(b.isoEnd).getTime(),
      });
    }
  }

  const slots: TimeSlot[] = [];
  const durationMs = (cdaConfig.inspectionDurationMinutes || 30) * 60 * 1000;

  let currentSlotTime = new Date(year, month, day, openHour, openMin, 0, 0);
  const endTimeLimit = new Date(year, month, day, closeHour, closeMin, 0, 0);

  // Calcular si la fecha solicitada es hoy (en hora de Colombia)
  const now = new Date();
  const colTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  const isToday = (dateString === colTodayStr);
  const minFutureTime = now.getTime() + (10 * 60 * 1000);

  while (currentSlotTime.getTime() + durationMs <= endTimeLimit.getTime()) {
    const slotStartMs = currentSlotTime.getTime();
    const slotEndMs = slotStartMs + durationMs;

    // Si es hoy, filtrar todas las horas que ya hayan pasado
    if (isToday && slotStartMs < minFutureTime) {
      currentSlotTime = new Date(currentSlotTime.getTime() + durationMs);
      continue;
    }

    // Verificar colisión con eventos ocupados
    const isOccupied = busyIntervals.some(
      (busy) => Math.max(slotStartMs, busy.start) < Math.min(slotEndMs, busy.end)
    );

    const hour = currentSlotTime.getHours();
    const min = currentSlotTime.getMinutes();
    const timeStr = `${hour < 10 ? '0' + hour : hour}:${min < 10 ? '0' + min : min}`;

    if (!isOccupied) {
      slots.push({
        time: timeStr,
        display: formatAmPm(hour, min),
        isoStart: new Date(slotStartMs).toISOString(),
        isoEnd: new Date(slotEndMs).toISOString(),
        available: true,
      });
    }

    // Siguiente bloque de 30 minutos
    currentSlotTime = new Date(currentSlotTime.getTime() + durationMs);
  }

  return slots;
}

/**
 * Crear cita en Google Calendar y persistir en base local
 */
export async function createCalendarAppointment(req: BookingRequest) {
  const calendar = getCalendarClient();
  let googleEventId: string | null = null;
  let googleHtmlLink: string | null = null;

  const summary = `🚗 RTM ${req.plate} - ${req.name} (${cdaConfig.shortName})`;
  const description = [
    `🚘 CITA DE REVISIÓN TÉCNICO-MECÁNICA`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏢 CDA: ${cdaConfig.name}`,
    `👤 Cliente: ${req.name}`,
    `📞 Teléfono: ${req.phone}`,
    `🚘 Placa: ${req.plate}`,
    `📌 Tipo: ${req.vehicleType}`,
    `⛽ Combustible: ${req.fuelType || 'No especificado'}`,
    `🏷️ Marca y Modelo: ${req.brand || 'N/A'} - ${req.model || 'N/A'}`,
    `⏱️ Duración de prueba: ${cdaConfig.inspectionDurationMinutes} minutos`,
    `📍 Sede: ${cdaConfig.address} (${cdaConfig.city})`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `ℹ️ Recuerda: El SOAT no es obligatorio para la inspección en pista.`,
  ].join('\n');

  if (calendar) {
    try {
      const calendarId = getCalendarId();
      const response = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary,
          description,
          location: `${cdaConfig.address}, ${cdaConfig.city}`,
          start: {
            dateTime: req.timeSlot.isoStart,
            timeZone: 'America/Bogota',
          },
          end: {
            dateTime: req.timeSlot.isoEnd,
            timeZone: 'America/Bogota',
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 30 },
              { method: 'email', minutes: 60 },
            ],
          },
        },
      });

      googleEventId = response.data.id || null;
      googleHtmlLink = response.data.htmlLink || null;
      console.log(`✅ Cita agendada en Google Calendar (${calendarId}) con ID: ${googleEventId}`);
    } catch (error: any) {
      console.error('❌ Error insertando cita en Google Calendar:', error?.message || error);
    }
  }

  // Guardar en almacenamiento local persistente
  const localBooking = saveBooking({
    phone: req.phone,
    name: req.name,
    plate: req.plate,
    vehicleType: req.vehicleType,
    fuelType: req.fuelType,
    brand: req.brand,
    model: req.model,
    date: req.dateStr || (req as any).date || new Date().toISOString().split('T')[0],
    timeSlot: req.timeSlot.display,
    isoStart: req.timeSlot.isoStart,
    isoEnd: req.timeSlot.isoEnd,
    googleEventId: googleEventId || undefined,
    googleHtmlLink: googleHtmlLink || undefined,
  });

  return {
    ...localBooking,
    googleEventId,
    googleHtmlLink,
  };
}
