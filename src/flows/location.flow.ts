import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { isBotPaused } from '../services/pause.service.js';

export const locationFlow = addKeyword([
  'ubicacion',
  'ubicación',
  'donde estan',
  'direccion',
  'dirección',
  'horarios',
  'horario',
  'como llegar',
  'sede',
])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
  })
  .addAnswer(
    [
      `📍 *SEDE, HORARIOS Y LÍNEAS DE REVISIÓN* 📍`,
      `🏢 *${cdaConfig.name}*`,
      `NIT: ${cdaConfig.nit}`,
      '',
      `🗺️ *Dirección:* ${cdaConfig.address}`,
      `📞 *Teléfono / WhatsApp:* ${cdaConfig.phone}`,
      '',
      `⏰ *Horarios de Atención:*`,
      `• ${cdaConfig.schedule.weekdays}`,
      `• ${cdaConfig.schedule.saturdays}`,
      `• ${cdaConfig.schedule.sundaysAndHolidays}`,
      '',
      `🚗 *Líneas de Inspección Disponibles:*`,
      `• 🏍️ Motos 4T (4 Tiempos)`,
      `• 🚗 Vehículos Livianos: Diésel, Gasolina y Gas`,
      `• 🚛 Vehículos Pesados: Diésel`,
      `⏱️ *Tiempo de revisión en pista:* ${cdaConfig.inspectionDurationMinutes} minutos por vehículo`,
      '',
      `🗺️ *¿Cómo llegar?*`,
      `• Google Maps: ${cdaConfig.mapsUrl}`,
      `• Waze: ${cdaConfig.wazeUrl}`,
      '',
      'Escribe *AGENDAR* para reservar tu cupo o *MENU* para volver al inicio.',
    ]
  );
