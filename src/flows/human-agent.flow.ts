import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { pauseBotForPhone } from '../services/pause.service.js';

export const humanAgentFlow = addKeyword([
  'asesor',
  'humano',
  'persona',
  'agente',
  'hablar con alguien',
  'operador',
  '6',
])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
    // Pausar respuestas automáticas del bot para que el asesor pueda responder
    pauseBotForPhone(ctx.from, 3);
  })
  .addAnswer(
    [
      `👨‍💼 *ATENCIÓN CON ASESOR* 👨‍💼`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `¡Con gusto! En breve uno de nuestros asesores de *${cdaConfig.name}* se comunicará contigo para colaborarte.`,
      '',
      `📞 Teléfono directo: *${cdaConfig.phone}*`,
    ].join('\n')
  );
