import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { getCustomersExpiringInDays, getAllCustomers, CustomerRecord } from './customers.service.js';
import { getBookingsByDate, BookingData } from './booking.service.js';
import { addMessage } from './chat-history.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'reminders_log.json');

interface ReminderLog {
  id: string;
  type: 'RTM_EXPIRATION' | 'APPOINTMENT_REMINDER' | 'APPOINTMENT_1HOUR_REMINDER';
  phone: string;
  plate: string;
  sentAt: string;
  details: string;
}

function getLog(): ReminderLog[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8') || '[]');
  } catch {
    return [];
  }
}

function saveLogEntry(entry: ReminderLog): void {
  const log = getLog();
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
}

function alreadySentToday(phone: string, plate: string, type: 'RTM_EXPIRATION' | 'APPOINTMENT_REMINDER' | 'APPOINTMENT_1HOUR_REMINDER'): boolean {
  const todayStr = new Date().toISOString().split('T')[0];
  const log = getLog();
  return log.some(
    (item) =>
      item.phone === phone &&
      item.plate === plate &&
      item.type === type &&
      item.sentAt.startsWith(todayStr)
  );
}

/**
 * Calcular días exactos restantes hasta la fecha de vencimiento
 */
export function calculateDaysUntil(dateStr: string): number {
  if (!dateStr) return 9999;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return 9999;
  const expDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const today = new Date();
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffTime = expDate.getTime() - todayZero.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 1. Enviar recordatorios a clientes cuya RTM está próxima a vencer (en los próximos 30 días o recién vencida)
 */
export async function sendRtmExpirationReminders(provider: any): Promise<number> {
  console.log('🔍 [Recordatorios RTM] Verificando vencimientos próximos de la base de datos...');
  const allCustomers = getAllCustomers();
  let sentCount = 0;

  for (const customer of allCustomers) {
    if (!customer.phone || !customer.plate || !customer.rtmExpirationDate) continue;

    if (isBlacklisted(customer.phone)) {
      continue;
    }

    const daysLeft = calculateDaysUntil(customer.rtmExpirationDate);

    // Enviar a cualquier cliente que venza en los próximos 30 días o con RTM vencida hasta 30 días atrás
    if (daysLeft > 30 || daysLeft < -30) {
      continue;
    }

    if (alreadySentToday(customer.phone, customer.plate, 'RTM_EXPIRATION')) {
      continue;
    }

    const vehicleInfo = [customer.brand, customer.model].filter(Boolean).join(' ') || 'tu vehículo';

    let urgencyText = '';
    if (daysLeft > 1) {
      urgencyText = `vence en *${daysLeft} día(s)* (Fecha: *${customer.rtmExpirationDate}*)`;
    } else if (daysLeft === 1) {
      urgencyText = `vence *MAÑANA* (Fecha: *${customer.rtmExpirationDate}*)`;
    } else if (daysLeft === 0) {
      urgencyText = `vence *HOY* (Fecha: *${customer.rtmExpirationDate}*)`;
    } else {
      urgencyText = `se encuentra *VENCIDA* desde el *${customer.rtmExpirationDate}* (hace ${Math.abs(daysLeft)} días)`;
    }

    const priceInfo = customer.price ? `\n💰 *Valor oficial:* ${customer.price}` : '';

    const message = [
      `👋 ¡Hola ${customer.name || 'Cliente'}!`,
      `Te saludamos de *${cdaConfig.name}* 🚗🏍️`,
      '',
      `⚠️ *RECORDATORIO DE REVISIÓN TÉCNICO-MECÁNICA*`,
      `Te recordamos que la Revisión Técnico-Mecánica de tu vehículo *${customer.plate}* (${vehicleInfo}) ${urgencyText}.${priceInfo}`,
      '',
      `⏱️ *¡La revisión se realiza en solo 30 minutos!*`,
      `🟢 *IMPORTANTE:* El SOAT vigente *NO es obligatorio* para realizar tu revisión en pista.`,
      `Evita multas e inmovilización de tu vehículo.`,
      '',
      `📍 *Ubicación del CDA:* ${cdaConfig.address} (${cdaConfig.city})`,
      `🗺️ *Google Maps:* ${cdaConfig.mapsUrl}`,
      '',
      `¿Deseas agendar tu turno para ser atendido sin filas?`,
      `👉 *Responde a este mensaje con la palabra "AGENDAR" y apartamos tu cupo en tiempo real.*`,
    ].join('\n');

    try {
      await provider.sendMessage(customer.phone, message, {});
      addMessage({
        from: customer.phone,
        name: customer.name,
        plate: customer.plate,
        text: message,
        sender: 'BOT',
      });
      saveLogEntry({
        id: `REM-${Date.now()}`,
        type: 'RTM_EXPIRATION',
        phone: customer.phone,
        plate: customer.plate,
        sentAt: new Date().toISOString(),
        details: `${urgencyText}`,
      });
      sentCount++;
      console.log(`✅ [RTM Reminder] Enviado a ${customer.name} (${customer.plate}) - ${urgencyText} - Tel: ${customer.phone}`);
      // Pausa breve para evitar saturación de envíos
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`❌ Error enviando recordatorio a ${customer.phone}:`, err);
    }
  }

  console.log(`📊 [Recordatorios RTM] Total mensajes de vencimiento enviados: ${sentCount}`);
  return sentCount;
}

/**
 * 2. Enviar recordatorios de cita agendada faltando 1 día para la fecha programada
 */
export async function sendTomorrowAppointmentReminders(provider: any): Promise<number> {
  console.log('🔍 [Recordatorios Citas] Verificando citas agendadas para el día de mañana...');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const tomorrowBookings = getBookingsByDate(tomorrowStr);
  let sentCount = 0;

  for (const booking of tomorrowBookings) {
    if (!booking.phone || !booking.plate) continue;

    if (isBlacklisted(booking.phone)) {
      continue;
    }

    if (alreadySentToday(booking.phone, booking.plate, 'APPOINTMENT_REMINDER')) {
      continue;
    }

    const message = [
      `🔔 *RECORDATORIO DE TU CITA DE MAÑANA - ${cdaConfig.shortName.toUpperCase()}* 🔔`,
      `Hola *${booking.name}*, te recordamos los detalles de tu cita para la Revisión Técnico-Mecánica:`,
      '',
      `🚘 *Placa:* ${booking.plate}`,
      `🏷️ *Vehículo:* ${booking.brand || ''} ${booking.model || ''} (${booking.vehicleType})`,
      `📅 *Fecha:* Mañana (${booking.date})`,
      `⏰ *Hora Agendada:* *${booking.timeSlot}*`,
      `⏱️ *Duración de revisión:* ${cdaConfig.inspectionDurationMinutes} minutos`,
      `📍 *Sede:* ${cdaConfig.address} (${cdaConfig.city})`,
      `🗺️ *Google Maps:* ${cdaConfig.mapsUrl}`,
      '',
      `📋 *RECOMENDACIONES IMPORTANTES:*`,
      `• 🟢 Recuerda: El SOAT vigente *NO es obligatorio* para la inspección.`,
      `• Traer Licencia de Tránsito (Tarjeta de propiedad).`,
      `• Por favor llegar *10 minutos antes* de la hora agendada.`,
      `• Vehículo limpio y baúl desocupado.`,
      '',
      `Si necesitas reprogramar o tienes alguna duda, responde a este mensaje con la palabra *ASESOR*. ¡Te esperamos!`,
    ].join('\n');

    try {
      await provider.sendMessage(booking.phone, message, {});
      addMessage({
        from: booking.phone,
        name: booking.name,
        plate: booking.plate,
        text: message,
        sender: 'BOT',
      });
      saveLogEntry({
        id: `CITA-REM-${Date.now()}`,
        type: 'APPOINTMENT_REMINDER',
        phone: booking.phone,
        plate: booking.plate,
        sentAt: new Date().toISOString(),
        details: `Cita programada para: ${booking.date} a las ${booking.timeSlot}`,
      });
      sentCount++;
      console.log(`✅ [Cita Reminder] Enviado a ${booking.name} (${booking.plate}) para mañana a las ${booking.timeSlot}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`❌ Error enviando recordatorio de cita a ${booking.phone}:`, err);
    }
  }

  console.log(`📊 [Recordatorios Citas] Total mensajes de cita de mañana enviados: ${sentCount}`);
  return sentCount;
}

/**
 * 3. Enviar recordatorio a clientes faltando 1 hora antes de su cita agendada
 */
export function parseBookingStartTime(booking: BookingData): Date | null {
  if (booking.isoStart) {
    return new Date(booking.isoStart);
  }
  if (!booking.date || !booking.timeSlot) return null;
  try {
    const parts = booking.date.split('-');
    let [time, modifier] = booking.timeSlot.trim().split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (modifier?.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (modifier?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    
    // Convertir fecha de turno
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), hours, minutes || 0);
    return dt;
  } catch {
    return null;
  }
}

export async function sendUpcoming1HourAppointmentReminders(provider: any): Promise<number> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const todayBookings = getBookingsByDate(todayStr);
  let sentCount = 0;

  for (const booking of todayBookings) {
    if (!booking.phone || !booking.plate) continue;

    if (isBlacklisted(booking.phone)) continue;

    if (alreadySentToday(booking.phone, booking.plate, 'APPOINTMENT_1HOUR_REMINDER')) {
      continue;
    }

    const startTime = parseBookingStartTime(booking);
    if (!startTime) continue;

    const diffMinutes = Math.round((startTime.getTime() - now.getTime()) / (1000 * 60));

    // Si faltan entre 10 y 80 minutos para la cita (aprox 1 hora antes)
    if (diffMinutes >= 10 && diffMinutes <= 80) {
      const vehicleInfo = [booking.brand, booking.model].filter(Boolean).join(' ') || booking.vehicleType || 'tu vehículo';

      const message = [
        `🔔 *¡RECORDATORIO: TU CITA ES EN 1 HORA! - ${cdaConfig.shortName.toUpperCase()}* 🔔`,
        `Hola *${booking.name}*, te recordamos los detalles de tu turno programado para hoy:`,
        '',
        `🚘 *Placa:* ${booking.plate}`,
        `🏷️ *Vehículo:* ${vehicleInfo}`,
        `📅 *Fecha:* Hoy (${booking.date})`,
        `⏰ *Hora de tu Turno:* *${booking.timeSlot}* (¡En aprox. ${diffMinutes} minutos!)`,
        `⏱️ *Duración de la inspección:* ${cdaConfig.inspectionDurationMinutes} minutos`,
        `📍 *Sede:* ${cdaConfig.address} (${cdaConfig.city})`,
        `🗺️ *Google Maps:* ${cdaConfig.mapsUrl}`,
        '',
        `📋 *RECOMENDACIONES IMPORTANTES PARA TU LLEGADA:*`,
        `• 🟢 *SOAT:* Recuerda que el SOAT vigente *NO es obligatorio* para la inspección.`,
        `• Por favor llegar *10 a 15 minutos antes* para ingresar a pista puntualmente.`,
        `• Presentar Licencia de Tránsito (Tarjeta de propiedad).`,
        `• Vehículo limpio y baúl desocupado.`,
        '',
        `¿Tienes algún imprevisto o necesitas ayuda? Responde a este mensaje y un asesor te atenderá. ¡Te esperamos!`,
      ].join('\n');

      try {
        await provider.sendMessage(booking.phone, message, {});
        addMessage({
          from: booking.phone,
          name: booking.name,
          plate: booking.plate,
          text: message,
          sender: 'BOT',
        });
        saveLogEntry({
          id: `CITA-1H-${Date.now()}`,
          type: 'APPOINTMENT_1HOUR_REMINDER',
          phone: booking.phone,
          plate: booking.plate,
          sentAt: new Date().toISOString(),
          details: `Aviso 1 hora antes enviado exitosamente. Cita programada: ${booking.timeSlot}`,
        });
        sentCount++;
        console.log(`🚀 [Aviso 1 Hora Antes] Recordatorio enviado a ${booking.name} (${booking.plate}) - Turno: ${booking.timeSlot}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(`❌ Error enviando recordatorio de 1 hora a ${booking.phone}:`, err);
      }
    }
  }

  return sentCount;
}

/**
 * 4. Enviar reporte diario a las 7:00 AM al número del CDA con las citas agendadas para el día
 */
export async function sendDailyAdminBookingSummary(provider: any, customDateStr?: string): Promise<boolean> {
  const targetPhone = '573184561999';
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = customDateStr || `${y}-${m}-${d}`;

  console.log(`📋 [Reporte 7:00 AM] Generando reporte diario de citas para hoy (${todayStr}) a +${targetPhone}...`);
  const bookings = getBookingsByDate(todayStr);

  // Ordenar citas cronológicamente por hora
  bookings.sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''));

  let message = '';
  if (bookings.length === 0) {
    message = [
      `📋 *REPORTE DIARIO DE CITAS DE HOY (${todayStr})* 🚗🏍️`,
      `🏢 *${cdaConfig.name}*`,
      '',
      `ℹ️ *No hay citas agendadas programadas en el sistema para el día de hoy.*`,
      '',
      `⏰ Horario de atención: ${cdaConfig.schedule.weekdays}`,
      `⏱️ Duración de revisión: ${cdaConfig.inspectionDurationMinutes} minutos por vehículo.`,
    ].join('\n');
  } else {
    const listText = bookings
      .map((b, index) => {
        const vehicle = [b.brand, b.model].filter(Boolean).join(' ') || b.vehicleType;
        return [
          `👉 *${index + 1}.* 🕒 *${b.timeSlot}* - 🚘 *${b.plate.toUpperCase()}* (${b.vehicleType})`,
          `   👤 *Cliente:* ${b.name}`,
          `   📞 *Teléfono:* +${b.phone}`,
          b.fuelType ? `   ⛽ *Combustible:* ${b.fuelType}` : '',
          vehicle ? `   🏷️ *Vehículo:* ${vehicle}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    message = [
      `📋 *REPORTE DIARIO DE CITAS AGENDADAS PARA HOY (${todayStr})* 🚗🏍️`,
      `🏢 *${cdaConfig.name}*`,
      '',
      `📊 *Total citas programadas:* *${bookings.length} vehículo(s)*`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      listText,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `⏱️ Duración de inspección: ${cdaConfig.inspectionDurationMinutes} minutos por vehículo.`,
      `📍 Sede: ${cdaConfig.address}`,
    ].join('\n');
  }

  try {
    await provider.sendMessage(targetPhone, message, {});
    addMessage({
      from: targetPhone,
      name: 'Control Autos De Girardot',
      text: message,
      sender: 'BOT',
    });
    console.log(`✅ [Reporte 7:00 AM] Enviado exitosamente al WhatsApp del CDA (+${targetPhone}) con ${bookings.length} cita(s).`);
    return true;
  } catch (err) {
    console.error(`❌ Error enviando reporte diario de 7:00 AM a +${targetPhone}:`, err);
    return false;
  }
}

/**
 * Inicializar el cron job y vigilante automático de clientes y citas
 */
export function initReminderCronJob(provider: any): void {
  // 1. Cron diario a las 7:00 AM para enviar el resumen de citas del día al propio WhatsApp del CDA
  cron.schedule('0 7 * * *', async () => {
    console.log(`⏰ [CRON 7:00 AM] Enviando reporte diario de citas agendadas de hoy (${new Date().toLocaleString()})...`);
    try {
      await sendDailyAdminBookingSummary(provider);
    } catch (error) {
      console.error('❌ Error enviando reporte matutino de citas:', error);
    }
  });

  // 2. Cron principal diario de recordatorios a clientes: '30 8 * * *' = Todos los días a las 08:30 AM
  const cronTime = process.env.REMINDERS_CRON || '30 8 * * *';

  cron.schedule(cronTime, async () => {
    console.log(`⏰ [CRON Diario] Ejecutando escaneo diario de recordatorios (${new Date().toLocaleString()})...`);
    try {
      await sendRtmExpirationReminders(provider);
      await sendTomorrowAppointmentReminders(provider);
    } catch (error) {
      console.error('❌ Error en ejecución de cron de recordatorios:', error);
    }
  });

  // 3. Chequeo periódico cada 5 minutos:
  // - Revisa si faltan clientes con RTM por vencer
  // - Revisa si hay citas para dentro de 1 hora y les envía su recordatorio inmediato
  cron.schedule('*/5 * * * *', async () => {
    try {
      await sendRtmExpirationReminders(provider);
      await sendUpcoming1HourAppointmentReminders(provider);
    } catch {}
  });

  // Observador de cambios en tiempo real en data/clientes.json y data/citas.json
  let fileDebounceTimer: NodeJS.Timeout | null = null;
  try {
    fs.watch(DATA_DIR, (eventType, filename) => {
      if (filename && (filename.includes('clientes.json') || filename.includes('clientes.csv') || filename.includes('citas.json'))) {
        if (fileDebounceTimer) clearTimeout(fileDebounceTimer);
        fileDebounceTimer = setTimeout(async () => {
          console.log(`📂 [Watcher] Cambio detectado en ${filename}, escaneando avisos pendientes...`);
          try {
            await sendRtmExpirationReminders(provider);
            await sendUpcoming1HourAppointmentReminders(provider);
          } catch (e) {
            console.error('Error enviando avisos tras cambio en archivos:', e);
          }
        }, 2000);
      }
    });
  } catch (err) {
    console.warn('No se pudo inicializar watcher de clientes:', err);
  }

  console.log(`⏰ Cron de recordatorios programado (7:00 AM Reporte Citas Diario a +573184561999 | ${cronTime} Recordatorios Clientes | Chequeo 1h antes activo)`);
}
