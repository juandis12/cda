import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { cdaConfig, extractColombianPlate } from '../config/cda.config.js';
import { saveBooking, getBookingsByDate, getAllBookings, updateAllBookings, BookingData } from './booking.service.js';
import { getAllCustomers } from './customers.service.js';

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

  // Validar y normalizar la placa colombiana
  let validPlate = extractColombianPlate(req.plate);
  if (!validPlate && req.phone) {
    const allCustomers = getAllCustomers();
    const matched = allCustomers.find((c) => {
      const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
      const rPhone = (req.phone || '').replace(/[^0-9]/g, '');
      return cPhone && rPhone && (cPhone === rPhone || rPhone.endsWith(cPhone) || cPhone.endsWith(rPhone));
    });
    if (matched?.plate) {
      validPlate = matched.plate.toUpperCase();
    }
  }
  const cleanPlate = validPlate || req.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const summary = `🚗 RTM ${cleanPlate} - ${req.name} (${cdaConfig.shortName})`;
  const description = [
    `🚘 CITA DE REVISIÓN TÉCNICO-MECÁNICA`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏢 CDA: ${cdaConfig.name}`,
    `👤 Cliente: ${req.name}`,
    `📞 Teléfono: ${req.phone}`,
    `🚘 Placa: ${cleanPlate}`,
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

/**
 * Sincronizar citas bidireccionalmente con Google Calendar.
 * Si una cita fue modificada en Google Calendar (cambio de fecha, hora o estado),
 * actualiza automáticamente el registro local para que coincida exactamente con Google Calendar.
 */
export async function syncBookingsWithGoogleCalendar(): Promise<{
  totalSynced: number;
  updatedCount: number;
  addedCount: number;
  details: string[];
}> {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('⚠️ [Calendar Sync] No hay cliente de Google Calendar disponible.');
    return { totalSynced: 0, updatedCount: 0, addedCount: 0, details: [] };
  }

  const calendarId = getCalendarId();
  const localBookings = getAllBookings();
  let updatedCount = 0;
  let addedCount = 0;
  const details: string[] = [];

  try {
    // Consultar eventos desde hace 30 días hasta 90 días en el futuro
    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const googleEvents = response.data.items || [];
    console.log(`📅 [Calendar Sync] Consultados ${googleEvents.length} eventos de Google Calendar (${calendarId}).`);

    for (const ev of googleEvents) {
      if (!ev.id) continue;
      const startIso = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T12:00:00.000Z` : '');
      const endIso = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T12:30:00.000Z` : '');
      if (!startIso) continue;

      const dt = new Date(startIso);
      const colDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(dt);

      const colTimeSlot = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Bogota',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(dt);

      // Parsear placa, cliente, teléfono desde summary o descripción
      const summary = ev.summary || '';
      const desc = ev.description || '';

      const phoneMatch = desc.match(/Tel(?:éfono)?:\s*([0-9]+)/i);
      const phone = phoneMatch ? phoneMatch[1] : '';

      // Buscar si ya existe la cita local por googleEventId
      let existing = localBookings.find((b) => b.googleEventId === ev.id);

      // 1. Validar y extraer placa colombiana legítima desde descripción o resumen
      let plate = extractColombianPlate(desc) || extractColombianPlate(summary) || '';

      // 2. Si no se encontró placa en el evento pero hay teléfono, buscar en la base de datos de clientes
      const allCustomers = getAllCustomers();
      if (!plate && phone) {
        const matchedCustomer = allCustomers.find((c) => {
          const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
          return cPhone && (cPhone === phone || phone.endsWith(cPhone) || cPhone.endsWith(phone));
        });
        if (matchedCustomer?.plate) {
          plate = matchedCustomer.plate.toUpperCase();
        }
      }

      // 3. Si sigue sin placa pero ya existía localmente con una placa válida, preservar la placa válida local
      if (!plate && existing?.plate && extractColombianPlate(existing.plate)) {
        plate = existing.plate;
      }

      // Buscar si ya existe localmente por placa + fecha
      if (!existing && plate) {
        existing = localBookings.find((b) => b.plate === plate && (b.date === colDateStr || b.isoStart?.startsWith(colDateStr)));
      }

      const nameMatch = desc.match(/Cliente:\s*([^\n\r]+)/i) || summary.match(/-\s*([^(]+)/);
      let name = nameMatch ? nameMatch[1].trim() : '';

      if (!name || name === 'Cliente CDA') {
        const matched = allCustomers.find((c) => (phone && c.phone && c.phone.includes(phone)) || (plate && c.plate === plate));
        if (matched?.name) name = matched.name;
        else name = name || 'Cliente CDA';
      }

      // Si la placa se corrigió y Google Calendar tenía un título incorrecto, parcharlo en Google Calendar
      if (plate && (summary.includes('PLACA') || summary.includes('BAJAJ') || !extractColombianPlate(summary))) {
        try {
          const newSummary = `🚗 RTM ${plate} - ${name} (${cdaConfig.shortName})`;
          calendar.events.patch({
            calendarId,
            eventId: ev.id,
            requestBody: {
              summary: newSummary,
            },
          }).catch(() => {});
          console.log(`🔧 [Google Calendar Auto-Fix] Evento corregido en Google Calendar: "${newSummary}" (ID: ${ev.id})`);
        } catch {}
      }

      const typeMatch = desc.match(/Tipo:\s*([^\n\r]+)/i);
      const vehicleType = typeMatch ? typeMatch[1].trim() : 'Liviano';

      const brandModelMatch = desc.match(/Marca y Modelo:\s*([^\n\r]+)/i);
      const brandModelStr = brandModelMatch ? brandModelMatch[1].trim() : '';
      const [brand, ...modelParts] = brandModelStr.split(' - ');
      const model = modelParts.join(' - ');

      if (existing) {
        // Verificar si la fecha o la hora en Google Calendar son diferentes a las locales
        const hasDateChanged = existing.date !== colDateStr;
        const hasTimeChanged = existing.timeSlot !== colTimeSlot;
        const hasStartIsoChanged = existing.isoStart !== startIso;

        if (hasDateChanged || hasTimeChanged || hasStartIsoChanged || !existing.googleEventId) {
          const oldTime = `${existing.date} ${existing.timeSlot}`;
          const newTime = `${colDateStr} ${colTimeSlot}`;

          existing.date = colDateStr;
          existing.timeSlot = colTimeSlot;
          existing.isoStart = startIso;
          existing.isoEnd = endIso;
          existing.googleEventId = ev.id;
          existing.googleHtmlLink = ev.htmlLink || existing.googleHtmlLink;
          existing.status = ev.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
          if (name && (existing.name === 'Cliente CDA' || !existing.name)) existing.name = name;
          if (phone && !existing.phone) existing.phone = phone;

          updatedCount++;
          details.push(`Modificada cita ${existing.plate} de [${oldTime}] a [${newTime}] según Google Calendar`);
          console.log(`🔄 [Calendar Sync] Cita ${existing.plate} actualizada a: ${newTime} (ID: ${ev.id})`);
        }
      } else if (plate) {
        // Cita nueva creada directamente en Google Calendar
        const newBooking: BookingData = {
          id: `CITA-GCAL-${ev.id.slice(-6)}`,
          phone: phone || '',
          name: name || 'Cliente CDA',
          plate,
          vehicleType: vehicleType || 'Liviano',
          brand: (brand && brand !== 'N/A') ? brand : '',
          model: (model && model !== 'N/A') ? model : '',
          date: colDateStr,
          timeSlot: colTimeSlot,
          isoStart: startIso,
          isoEnd: endIso,
          googleEventId: ev.id,
          googleHtmlLink: ev.htmlLink || undefined,
          createdAt: new Date().toISOString(),
          status: ev.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
        };
        localBookings.push(newBooking);
        addedCount++;
        details.push(`Agregada nueva cita ${plate} (${colDateStr} ${colTimeSlot}) encontrada en Google Calendar`);
        console.log(`➕ [Calendar Sync] Nueva cita ${plate} importada de Google Calendar: ${colDateStr} ${colTimeSlot}`);
      }
    }

    // Persistir cambios si hubo alguna actualización o adición
    if (updatedCount > 0 || addedCount > 0) {
      updateAllBookings(localBookings);
      console.log(`💾 [Calendar Sync] Base de citas actualizada con éxito (${updatedCount} modificadas, ${addedCount} añadidas).`);
    } else {
      console.log(`✅ [Calendar Sync] Las citas ya están 100% sincronizadas con Google Calendar.`);
    }

    return {
      totalSynced: googleEvents.length,
      updatedCount,
      addedCount,
      details,
    };
  } catch (err: any) {
    console.error('❌ [Calendar Sync] Error sincronizando con Google Calendar:', err?.message || err);
    return { totalSynced: 0, updatedCount, addedCount, details: [`Error: ${err?.message || err}`] };
  }
}
