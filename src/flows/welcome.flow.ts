import { addKeyword, EVENTS } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { isBotPaused, unpauseBotForPhone } from '../services/pause.service.js';
import { getAiResponse } from '../services/ai.service.js';
import { ratesFlow } from './rates.flow.js';
import { bookingFlow } from './booking.flow.js';
import { requirementsFlow } from './requirements.flow.js';
import { locationFlow } from './location.flow.js';
import { faqsFlow } from './faqs.flow.js';
import { humanAgentFlow } from './human-agent.flow.js';

export const welcomeFlow = addKeyword([
  EVENTS.WELCOME,
  EVENTS.ACTION,
])
  .addAction(async (ctx, { flowDynamic, gotoFlow, endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      console.log(`🔇 [Lista Negra] Mensaje ignorado de contacto excluido: ${ctx.from}`);
      return endFlow();
    }

    const rawText = (ctx.body || '').trim();
    const cleanText = rawText.toLowerCase();

    // Comandos directos y rápidos
    if (cleanText === '1') return gotoFlow(ratesFlow);
    if (cleanText === '2' || cleanText === 'agendar' || cleanText === 'agendar cita') return gotoFlow(bookingFlow);
    if (cleanText === '3') return gotoFlow(requirementsFlow);
    if (cleanText === '4') return gotoFlow(locationFlow);
    if (cleanText === '5') return gotoFlow(faqsFlow);
    if (cleanText === '6' || cleanText === 'asesor' || cleanText === 'humano') return gotoFlow(humanAgentFlow);

    // Si el usuario pide ver el menú estructurado
    if (['menu', 'menú', 'opciones', 'inicio', 'empezar'].includes(cleanText)) {
      await flowDynamic([
        `👋 Bienvenido al menú interactivo de *${cdaConfig.name}* 🚗🏍️`,
        `⏱️ _Revisión Técnico-Mecánica en solo ${cdaConfig.inspectionDurationMinutes} minutos._`,
        '',
        'Selecciona el *NÚMERO* de la opción que deseas:',
        '👉 *1.* 💰 *Precios de la Revisión Técnico-Mecánica*',
        '👉 *2.* 📅 *Agendar Cita* en Google Calendar (En tiempo real)',
        '👉 *3.* 📋 *Requisitos* (¡SOAT no obligatorio!)',
        '👉 *4.* 📍 *Ubicación* y Horarios de Atención',
        '👉 *5.* ❓ *Preguntas Frecuentes* (Garantía 15 días)',
        '👉 *6.* 👨‍💼 Hablar con un *Asesor Humano*',
        '',
        '_O simplemente escríbeme tu duda o comentario con tus propias palabras._',
      ].join('\n'));
      return;
    }

    // Para cualquier mensaje conversacional en lenguaje natural: Respuesta Inteligente con IA
    console.log(`🧠 [IA Generando Respuesta] para +${ctx.from}: "${rawText}"`);
    const aiReply = await getAiResponse(ctx.from, rawText);
    await flowDynamic(aiReply);
  });
