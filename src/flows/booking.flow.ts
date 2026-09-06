import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { getAvailableTimeSlots, createCalendarAppointment, TimeSlot } from '../services/calendar.service.js';
import { normalizePhoneNumber } from '../services/chat-history.service.js';
import { isBotPaused } from '../services/pause.service.js';

/**
 * Normalizar texto de fecha a formato YYYY-MM-DD
 */
function parseDateInput(input: string): string | null {
  const clean = input.trim().toLowerCase();
  const today = new Date();

  if (clean === 'hoy') {
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (clean === 'mañana' || clean === 'manana') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (clean === 'pasado mañana' || clean === 'pasado manana') {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const y = dayAfter.getFullYear();
    const m = String(dayAfter.getMonth() + 1).padStart(2, '0');
    const d = String(dayAfter.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Soporte formato DD/MM/YYYY o DD-MM-YYYY
  const ddmmyyyyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Soporte formato YYYY-MM-DD
  const yyyymmddMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

export const bookingFlow = addKeyword([
  'agendar',
  'agendar cita',
  'reservar cupo',
  'agendamiento',
])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
  })
  .addAnswer(
    [
      `📅 *AGENDAMIENTO DE CITA EN GOOGLE CALENDAR - ${cdaConfig.shortName.toUpperCase()}*`,
      `Agenda tu revisión de ${cdaConfig.inspectionDurationMinutes} minutos con verificación de disponibilidad en tiempo real.`,
      '',
      '👉 *Paso 1 de 5:* Por favor escribe la *PLACA* de tu vehículo (Ej: *ABC123* o *ABC12D*):',
    ],
    { capture: true },
    async (ctx, { state, fallBack }) => {
      const plate = ctx.body.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (plate.length < 5 || plate.length > 7) {
        return fallBack('⚠️ Por favor ingresa una placa válida colombiana (Ejemplo: *ABC123* o *XYZ45D*):');
      }
      await state.update({ plate });
    }
  )
  .addAnswer(
    [
      '👉 *Paso 2 de 5:* Selecciona el *TIPO DE VEHÍCULO Y COMBUSTIBLE*:',
      '1. 🏍️ Moto 4T (4 Tiempos)',
      '2. 🚗 Liviano - Gasolina',
      '3. 🚗 Liviano - Diésel',
      '4. 🚗 Liviano - Gas vehicular',
      '5. 🚛 Pesado - Diésel',
      '',
      'Escribe el número correspondiente (*1 al 5*):',
    ],
    { capture: true },
    async (ctx, { state, fallBack }) => {
      const option = ctx.body.trim();
      const map: Record<string, { type: string; fuel: string }> = {
        '1': { type: 'Moto 4T', fuel: 'Gasolina' },
        '2': { type: 'Liviano', fuel: 'Gasolina' },
        '3': { type: 'Liviano', fuel: 'Diésel' },
        '4': { type: 'Liviano', fuel: 'Gas Vehicular' },
        '5': { type: 'Pesado', fuel: 'Diésel' },
      };

      const selected = map[option];
      if (!selected) {
        return fallBack('⚠️ Opción inválida. Digita un número del *1 al 5*:');
      }

      await state.update({
        vehicleType: selected.type,
        fuelType: selected.fuel,
      });
    }
  )
  .addAnswer(
    [
      '👉 *Paso 3 de 5:* Escribe la *MARCA Y MODELO/AÑO* de tu vehículo:',
      '_(Ejemplo: Mazda 3 2020, Renault Duster 2018, Hino Dutro 2022, Yamaha FZ 2021)_',
    ],
    { capture: true },
    async (ctx, { state, fallBack }) => {
      const text = ctx.body.trim();
      if (text.length < 3) {
        return fallBack('⚠️ Por favor escribe la marca y modelo (Ejemplo: *Renault Logan 2019*):');
      }
      await state.update({ brandAndModel: text });
    }
  )
  .addAnswer(
    ['👉 *Paso 4 de 5:* ¿A nombre de quién registramos la cita? Escribe tu *Nombre y Apellido*:'],
    { capture: true },
    async (ctx, { state, fallBack }) => {
      const name = ctx.body.trim();
      if (name.length < 3) {
        return fallBack('⚠️ Por favor escribe tu nombre completo:');
      }
      await state.update({ name });
    }
  )
  .addAnswer(
    [
      '👉 *Paso 5 de 5:* ¿Para qué *FECHA* deseas tu cita?',
      'Puedes escribir:',
      '• *Hoy*',
      '• *Mañana*',
      '• O una fecha en formato *DD/MM/AAAA* (Ej: *15/09/2026*)',
    ],
    { capture: true },
    async (ctx, { state, flowDynamic, fallBack }) => {
      const parsedDate = parseDateInput(ctx.body);
      if (!parsedDate) {
        return fallBack('⚠️ Formato de fecha no reconocido. Por favor escribe *Hoy*, *Mañana* o *DD/MM/AAAA* (Ej: *10/09/2026*):');
      }

      await flowDynamic(`⏳ _Consultando disponibilidad en Google Calendar para el ${parsedDate}..._`);

      try {
        const slots = await getAvailableTimeSlots(parsedDate);
        const availableSlots = slots.filter((s) => s.available);

        if (availableSlots.length === 0) {
          return fallBack(`❌ No encontramos cupos disponibles para el *${parsedDate}*. Por favor indica otra fecha (Ej: *Mañana*):`);
        }

        // Guardamos los slots en el estado para el siguiente paso
        await state.update({
          bookingDate: parsedDate,
          availableSlots,
        });

        // Mostramos TODAS las opciones disponibles en UN SOLO MENSAJE
        const slotLines = availableSlots.map((s, idx) => `👉 *${idx + 1}.* 🕒 ${s.display}`).join('\n');

        const singleMsg = [
          `✅ *HORARIOS DISPONIBLES EN GOOGLE CALENDAR (${parsedDate})*`,
          `⏱️ Duración de inspección: ${cdaConfig.inspectionDurationMinutes} minutos`,
          '',
          slotLines,
          '',
          'Por favor escribe el *NÚMERO* del horario que prefieres (Ej: *1*, *2*, *3*):',
        ].join('\n');

        await flowDynamic(singleMsg);
      } catch (error) {
        console.error('Error obteniendo disponibilidad:', error);
        return fallBack('⚠️ Hubo un error consultando la agenda. Por favor intenta escribiendo la fecha nuevamente:');
      }
    }
  )
  .addAnswer(
    ['Elige tu horario escribiendo el número:'],
    { capture: true },
    async (ctx, { state, flowDynamic, fallBack }) => {
      const choice = ctx.body.trim();
      const myState = state.getMyState() || {};
      const availableSlots: TimeSlot[] = myState.availableSlots || [];

      const slotIdx = parseInt(choice, 10) - 1;
      const selectedSlot = availableSlots[slotIdx];

      if (!selectedSlot) {
        return fallBack(`⚠️ Selección no válida. Por favor digita un número entre *1* y *${availableSlots.length}*:`);
      }

      const phone = normalizePhoneNumber(ctx.from) || ctx.from || 'Sin teléfono';
      const bookingRecord = await createCalendarAppointment({
        phone,
        name: myState.name || 'Cliente',
        plate: myState.plate || 'N/A',
        vehicleType: myState.vehicleType || 'N/A',
        fuelType: myState.fuelType,
        brand: myState.brandAndModel,
        model: '',
        dateStr: myState.bookingDate,
        timeSlot: selectedSlot,
      });

      const confirmationMsg = [
        `🎉 *¡CITA AGENDADA EXITOSAMENTE EN GOOGLE CALENDAR!* 🎉`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🔖 *Código de Reserva:* \`${bookingRecord.id}\``,
        `🏢 *CDA:* ${cdaConfig.name}`,
        `👤 *Titular:* ${bookingRecord.name}`,
        `🚘 *Placa:* ${bookingRecord.plate}`,
        `🚗 *Tipo:* ${bookingRecord.vehicleType} (${bookingRecord.fuelType || ''})`,
        `🏷️ *Vehículo:* ${myState.brandAndModel}`,
        `📅 *Fecha:* ${bookingRecord.date}`,
        `⏰ *Hora:* ${bookingRecord.timeSlot} (Duración: ${cdaConfig.inspectionDurationMinutes} min)`,
        `📍 *Dirección:* ${cdaConfig.address} (${cdaConfig.city})`,
        `🗺️ *Google Maps:* ${cdaConfig.mapsUrl}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `ℹ️ *RECORDATORIOS IMPORTANTES:*`,
        `• 🟢 El SOAT vigente *NO es obligatorio* para la inspección técnico-mecánica.`,
        `• Presentar la Tarjeta de Propiedad (Licencia de Tránsito).`,
        `• Traer el vehículo limpio y el baúl desocupado.`,
        `• Llegar 10 minutos antes de tu hora asignada.`,
        '',
        `Si necesitas modificar tu cita, escribe *ASESOR* o escribe *MENU* para volver al inicio.`,
      ].join('\n');

      await flowDynamic(confirmationMsg);
    }
  );
