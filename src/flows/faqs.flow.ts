import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { isBotPaused } from '../services/pause.service.js';

export const faqsFlow = addKeyword(['faq', 'preguntas', 'dudas', 'ayuda', 'segunda revision', 'garantia'])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
  })
  .addAnswer(
    [
      `❓ *PREGUNTAS FRECUENTES (CDA COLOMBIA)* ❓`,
      '',
      '📌 *1. ¿Qué vigencia tiene el certificado de Revisión Técnico-Mecánica?*',
      '• Particulares nuevos: Primera revisión a los 5 años (a partir de la fecha de matrícula). Luego cada año.',
      '• Motos nuevas: Primera revisión a los 2 años. Luego cada año.',
      '• Servicio Público: Primera revisión a los 2 años. Luego cada año.',
      '',
      '📌 *2. ¿Cuánto tiempo tarda la revisión?*',
      'El proceso dura entre 30 y 45 minutos en pista.',
      '',
      '📌 *3. ¿Qué pasa si el vehículo es rechazado?*',
      `Según la normatividad colombiana, tienes *${cdaConfig.retestPolicy.daysAllowed} días hábiles* contados a partir de la fecha de expedición del Formato Uniforme de Resultados (FUR) para corregir los defectos y presentarlo a una *segunda revisión sin costo adicional*.`,
      '',
      '📌 *4. ¿El certificado de Revisión Técnico-Mecánica queda en el RUNT inmediatamente?*',
      'Sí, una vez aprobado, el certificado es firmado digitalmente y cargado en tiempo real en la plataforma RUNT y MinTransporte.',
      '',
      'Escribe *AGENDAR* para reservar tu cupo o *MENU* para volver.',
    ]
  );
