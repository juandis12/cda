import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { isBotPaused } from '../services/pause.service.js';

export const requirementsFlow = addKeyword([
  'requisitos',
  'requisito',
  'documentos',
  'que necesito',
  'papeles',
  'soat',
])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
  })
  .addAnswer(
    [
      `📋 *REQUISITOS PARA LA REVISIÓN TÉCNICO-MECÁNICA* 📋`,
      `En *${cdaConfig.shortName}* te facilitamos el proceso:`,
      '',
      ...cdaConfig.rtmRequirements,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '⚖️ *GARANTÍA DE LEY (15 DÍAS HÁBILES)*',
      cdaConfig.retestPolicy.description,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `⏱️ *Duración de la inspección:* Solo ${cdaConfig.inspectionDurationMinutes} minutos.`,
      '',
      '¿Deseas agendar tu turno en Google Calendar? Escribe *AGENDAR* o escribe *MENU* para volver.',
    ]
  );
