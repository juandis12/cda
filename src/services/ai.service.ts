import fs from 'fs';
import path from 'path';
import { cdaConfig } from '../config/cda.config.js';
import { getAllCustomers, CustomerRecord } from './customers.service.js';
import { getConversation, ChatMessage } from './chat-history.service.js';
import { createCalendarAppointment } from './calendar.service.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';

/**
 * Buscar datos del cliente por su número de teléfono
 */
function findCustomerByPhone(phone: string): CustomerRecord | null {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const all = getAllCustomers();
  return (
    all.find((c) => {
      const cClean = (c.phone || '').replace(/[^0-9]/g, '');
      return cClean === cleanPhone || cleanPhone.endsWith(cClean) || cClean.endsWith(cleanPhone);
    }) || null
  );
}

/**
 * Detectar si la conversación define y confirma una cita y registrarla automáticamente
 */
async function detectAndRegisterAppointment(
  userPhone: string,
  customer: CustomerRecord | null,
  chatText: string
): Promise<void> {
  try {
    const cleanPhone = userPhone.replace(/[^0-9]/g, '');
    const prompt = `
Analiza la siguiente conversación de WhatsApp entre un cliente y el CDA en Girardot, Colombia.
Fecha de referencia actual: 2026-09-05.

CONVERSACIÓN:
${chatText}

Determina si se ha acordado y confirmado una cita para la Revisión Técnico-Mecánica (debe tener fecha y hora).
Si NO hay fecha y hora confirmada, responde exactamente: NO_BOOKING

Si SÍ hay fecha y hora confirmada, responde ÚNICAMENTE con este JSON (sin markdown ni texto extra):
{
  "confirmed": true,
  "date": "YYYY-MM-DD",
  "time": "H:MM AM/PM",
  "plate": "PLACA",
  "vehicleType": "Moto 4T" | "Liviano" | "Pesado"
}
    `.trim();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150,
      }),
    });

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (content && content.includes('{') && content.includes('confirmed')) {
      const cleanJson = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed.confirmed && parsed.date && parsed.time) {
        const rawCitas = fs.readFileSync(path.resolve(process.cwd(), 'data', 'citas.json'), 'utf-8');
        const citas = JSON.parse(rawCitas || '[]');
        const alreadyExists = citas.some((c: any) => c.phone === cleanPhone && c.date === parsed.date);

        if (!alreadyExists) {
          const [hourStr, minuteAndPeriod] = parsed.time.split(':');
          const [minStr, period] = (minuteAndPeriod || '00 PM').trim().split(' ');
          let hour = parseInt(hourStr, 10);
          if (period?.toUpperCase() === 'PM' && hour < 12) hour += 12;
          if (period?.toUpperCase() === 'AM' && hour === 12) hour = 0;

          const [y, m, d] = parsed.date.split('-').map(Number);
          const start = new Date(Date.UTC(y, m - 1, d, hour + 5, parseInt(minStr || '0', 10), 0));
          const end = new Date(start.getTime() + 30 * 60 * 1000);

          await createCalendarAppointment({
            phone: cleanPhone,
            name: customer?.name || 'Cliente CDA',
            plate: parsed.plate || customer?.plate || 'PARTICULAR',
            vehicleType: parsed.vehicleType || customer?.vehicleType || 'Liviano',
            fuelType: customer?.fuel || 'Gasolina',
            brand: customer?.brand || '',
            model: customer?.model || '',
            dateStr: parsed.date,
            timeSlot: {
              time: `${hour}:${minStr || '00'}`,
              display: parsed.time,
              isoStart: start.toISOString(),
              isoEnd: end.toISOString(),
              available: true,
            },
          });
          console.log(`🎉 [Cita Conversacional Agendada con Éxito] +${cleanPhone} para el ${parsed.date} a las ${parsed.time}`);
        }
      }
    }
  } catch (err) {
    console.error('Error detectando agendamiento conversacional:', err);
  }
}

/**
 * Generar respuesta inteligente con IA para el cliente
 */
export async function getAiResponse(userPhone: string, userMessage: string): Promise<string> {
  const customer = findCustomerByPhone(userPhone);
  const conversation = getConversation(userPhone);
  const msgList: ChatMessage[] = Array.isArray(conversation) ? conversation : [];

  // Obtener los últimos 10 mensajes del historial para dar memoria contextual (excluyendo eventos del sistema)
  const cleanMsgs = msgList
    .filter((m) => m && m.text && !m.text.startsWith('_event_'))
    .slice(-10);

  const recentHistory = cleanMsgs.map((m) => ({
    role: m.sender === 'CLIENT' ? 'user' : 'assistant',
    content: m.text,
  }));

  // Contexto del cliente si existe en base de datos
  let customerContext = 'Cliente nuevo o no registrado en la base de datos.';
  if (customer) {
    customerContext = `
DATOS DEL CLIENTE REGISTRADO:
- Nombre del Cliente: ${customer.name}
- Placa: ${customer.plate}
- Vehículo: ${customer.brand || ''} ${customer.model || ''} (${customer.vehicleType || ''} - ${customer.serviceType || ''})
- Combustible: ${customer.fuel || 'Gasolina'}
- Fecha de Vencimiento de Revisión Técnico-Mecánica: ${customer.rtmExpirationDate || 'N/A'}
- Tarifa oficial asignada: ${customer.price || '$368.537'}
    `.trim();
  }

  const systemPrompt = `
Eres el Asistente Virtual Inteligente y Oficial de "${cdaConfig.name}" (Centro de Diagnóstico Automotor en ${cdaConfig.city}).
Tu personalidad es muy amable, profesional, empática, servicial, cálida y natural (estilo colombiano educado, cercano y respetuoso).

INFORMACIÓN DEL CDA:
- Nombre: ${cdaConfig.name}
- Dirección: ${cdaConfig.address}
- Enlace de Ubicación Google Maps: ${cdaConfig.mapsUrl}
- Teléfono / WhatsApp: ${cdaConfig.phone}
- Horarios de Atención:
  * Lunes a Viernes: 7:00 AM a 7:00 PM (Jornada continua)
  * Sábados: 7:00 AM a 5:00 PM (Jornada continua)
  * Domingos y Festivos: 8:00 AM a 12:00 PM (Medio día)
- Duración de la Revisión Técnico-Mecánica: ¡En nuestra pista dura tan solo 30 minutos!
- Requisitos: Presentar Licencia de Tránsito (Tarjeta de propiedad física o digital RUNT), vehículo limpio.
- 🟢 IMPORTANTE: El SOAT vigente NO es obligatorio para realizar la inspección técnico-mecánica en el CDA.
- Garantía de ley: Si el vehículo es rechazado, tiene 15 días hábiles para corregir y presentarse a segunda revisión GRATIS.

TARIFAS OFICIALES REVISIÓN TÉCNICO-MECÁNICA 2026:
- Motos (4 Tiempos): $247.274
- Livianos Particular: $368.537
- Livianos Público (Taxis / Especial): $367.937
- Pesados Particular (Diésel): $562.584
- Pesados Público (Diésel): $562.084

CONTEXTO DEL INTERLOCUTOR:
${customerContext}

INSTRUCCIONES CLAVE DE RESPUESTA:
1. Responde de forma CONCISA, NATURAL, HUMANA y PERSONALIZADA en un solo mensaje de WhatsApp (máximo 1 o 2 párrafos cortos).
2. Si el cliente te avisa que está de viaje, que luego agenda, o que no puede en este momento:
   - Sé muy amable y comprensivo.
   - Deséale un buen viaje o buen día dirigiéndote a él/ella por su nombre con respeto (ej: "Sra. Martha", "Don Javier", etc.).
   - Dile que con mucho gusto los esperan cuando regresen y que recuerde que la revisión solo toma 30 minutos.
3. Si el cliente pregunta por el precio de la revisión técnico-mecánica de forma general o no sabemos qué vehículo tiene:
   - Pídele amablemente la *PLACA* y el *MODELO/AÑO* de su vehículo para cotizarle el valor exacto.
   - Si ya sabemos qué vehículo tiene (porque está en los DATOS DEL CLIENTE REGISTRADO o porque ya lo mencionó en el chat), dale de inmediato el valor exacto de su vehículo.
4. Si el cliente quiere agendar una cita:
   - Dile con entusiasmo que con gusto lo agendamos y pregúntale para qué fecha u horario prefiere, o indícale que escriba "AGENDAR" para elegir el horario en tiempo real.
5. Si el cliente te habla con un contexto diferente al CDA (temas ajenos, repuestos, trámites externos, consultas especializadas no relacionadas con la Revisión Técnico-Mecánica) o solicita hablar con una persona:
   - Dile con mucha amabilidad que en breve un asesor se pondrá en contacto con ellos para colaborarles.
   - NUNCA menciones que el chatbot se pausa por 3 horas ni nada técnico, solo dile con naturalidad que ya un asesor se comunica con ellos.
6. NUNCA respondas con menús robóticos rígidos cuando el cliente está hablando en lenguaje natural. Sé un asesor real, empático y atento.
  `.trim();

  try {
    const messages: any[] = [{ role: 'system', content: systemPrompt }, ...recentHistory];
    if (recentHistory.length === 0 || recentHistory[recentHistory.length - 1].content !== userMessage) {
      if (userMessage && !userMessage.startsWith('_event_')) {
        messages.push({ role: 'user', content: userMessage });
      }
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 350,
      }),
    });

    const data: any = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (reply && reply.trim().length > 0) {
      const trimmedReply = reply.trim();
      // Ejecutar detección en segundo plano para registrar en Calendar si se confirmó cita
      const fullChat = [...cleanMsgs.map((m) => `${m.sender}: ${m.text}`), `USER: ${userMessage}`, `ASSISTANT: ${trimmedReply}`].join('\n');
      detectAndRegisterAppointment(userPhone, customer, fullChat).catch(() => {});
      return trimmedReply;
    }
  } catch (error) {
    console.error('Error generando respuesta de IA:', error);
  }

  // Fallback si la API de IA no responde
  return `¡Hola! Gracias por comunicarte con ${cdaConfig.name}. ¿En qué podemos colaborarte hoy con la Revisión Técnico-Mecánica de tu vehículo?`;
}
