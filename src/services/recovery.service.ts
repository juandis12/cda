import { getAllConversations, getConversation, addMessage } from './chat-history.service.js';
import { isBlacklisted } from '../config/cda.config.js';
import { isBotPaused } from './pause.service.js';
import { getAiResponse } from './ai.service.js';

/**
 * Revisar y reanudar conversaciones pendientes tras el reinicio del bot
 */
export async function resumePendingConversations(provider: any): Promise<number> {
  console.log('🔄 [Recuperación] Verificando si quedaron mensajes de clientes sin responder tras el reinicio...');
  const conversations = getAllConversations();
  let recoveredCount = 0;
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000; // Solo mensajes de las últimas 24 horas

  for (const conv of conversations) {
    if (!conv.phone || isBlacklisted(conv.phone) || isBotPaused(conv.phone)) {
      continue;
    }

    const messages = getConversation(conv.phone);
    if (!messages || messages.length === 0) continue;

    const lastMsg = messages[messages.length - 1];

    // Si el último mensaje es del CLIENTE y está dentro de las últimas 24h
    if (lastMsg.sender === 'CLIENT' && lastMsg.text && lastMsg.text.trim().length > 0) {
      const msgTime = new Date(lastMsg.timestamp).getTime();
      if (isNaN(msgTime) || (now - msgTime) > maxAgeMs) {
        continue;
      }

      // Ignorar eventos automáticos del sistema (ej: llamadas perdidas o notas de voz no procesadas)
      if (lastMsg.text.startsWith('_event_')) {
        continue;
      }

      console.log(`💬 [Reanudando Conversación] Cliente: ${conv.name || conv.phone} (${conv.phone}) | Mensaje pendiente: "${lastMsg.text}"`);

      try {
        const aiReply = await getAiResponse(conv.phone, lastMsg.text);
        if (aiReply && aiReply.trim().length > 0) {
          await provider.sendMessage(conv.phone, aiReply, {});
          addMessage({
            from: conv.phone,
            name: conv.name,
            text: aiReply,
            sender: 'BOT',
          });
          recoveredCount++;
          console.log(`✅ [Conversación Reanudada] Respondido a +${conv.phone}: "${aiReply.slice(0, 60)}..."`);
          // Pausa breve entre mensajes para evitar saturación
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.error(`❌ Error reanudando conversación con +${conv.phone}:`, err);
      }
    }
  }

  if (recoveredCount > 0) {
    console.log(`🎉 [Recuperación Completa] Se reanudaron y respondieron ${recoveredCount} conversación(es) pendiente(s).`);
  } else {
    console.log('✨ [Recuperación] No había conversaciones pendientes por responder.');
  }

  return recoveredCount;
}
