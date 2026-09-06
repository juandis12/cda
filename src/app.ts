import 'dotenv/config';
import { createBot, createProvider, createFlow } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import { JsonFileDB } from '@builderbot/database-json';
import { fetchLatestBaileysVersion, Browsers } from 'baileys';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

import { welcomeFlow } from './flows/welcome.flow.js';
import { ratesFlow } from './flows/rates.flow.js';
import { bookingFlow } from './flows/booking.flow.js';
import { requirementsFlow } from './flows/requirements.flow.js';
import { locationFlow } from './flows/location.flow.js';
import { faqsFlow } from './flows/faqs.flow.js';
import { humanAgentFlow } from './flows/human-agent.flow.js';
import { cdaConfig, isBlacklisted } from './config/cda.config.js';
import { initReminderCronJob, sendRtmExpirationReminders, sendTomorrowAppointmentReminders, sendDailyAdminBookingSummary } from './services/reminder.service.js';
import { resumePendingConversations } from './services/recovery.service.js';
import { getAiResponse } from './services/ai.service.js';
import { getAllCustomers } from './services/customers.service.js';
import { addMessage, getConversation, getAllConversations, normalizePhoneNumber } from './services/chat-history.service.js';
import { pauseBotForPhone } from './services/pause.service.js';

const PORT = parseInt(process.env.PORT || '3008', 10);
const DASHBOARD_HTML_PATH = path.resolve(process.cwd(), 'src', 'views', 'dashboard.html');

// Estado global de la conexión
let currentQrBase64 = '';
let currentQrRaw = '';
let currentPairingCode = '';
let isBotReady = false;
let connectedUser = '';

process.on('uncaughtException', (err) => {
  console.error('⚠️ [Uncaught Exception]:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Unhandled Rejection]:', reason);
});

const main = async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🤖 Iniciando Chatbot para: ${cdaConfig.name}`);
  console.log(`📍 Sede: ${cdaConfig.city} - ${cdaConfig.address}`);
  console.log(`⏰ Horarios: L-V 7am-7pm | Sáb 7am-5pm | Dom/Fest 8am-12pm`);
  console.log(`🚀 Puerto Web: ${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Obtener última versión compatible de WhatsApp Web
  let waVersion: [number, number, number] = [2, 3000, 1043857760];
  try {
    const versionData = await fetchLatestBaileysVersion();
    if (versionData?.version) {
      waVersion = versionData.version as [number, number, number];
      console.log(`📡 Versión WhatsApp Web: [${waVersion.join(', ')}]`);
    }
  } catch (err) {
    console.warn('Usando versión por defecto:', waVersion);
  }

  const adapterFlow = createFlow([
    welcomeFlow,
    ratesFlow,
    bookingFlow,
    requirementsFlow,
    locationFlow,
    faqsFlow,
    humanAgentFlow,
  ]);

  const providerArgs: any = {
    name: 'bot',
    version: waVersion,
    browser: Browsers.macOS('Desktop'),
  };

  if (process.env.BOT_PHONE_NUMBER) {
    providerArgs.usePairingCode = true;
    providerArgs.phoneNumber = process.env.BOT_PHONE_NUMBER.replace(/[^0-9]/g, '');
  }

  const adapterProvider = createProvider(BaileysProvider, providerArgs);
  const adapterDB = new JsonFileDB({ filename: 'data/db.json' });

  // 1. Monitoreo de Acciones (QR o Pairing Code)
  adapterProvider.on('require_action', async ({ payload, instructions }) => {
    if (payload?.code) {
      currentPairingCode = payload.code;
      console.log('\n🔑 ━━━━━━━━━━ CÓDIGO DE VINCULACIÓN DE 8 DÍGITOS ━━━━━━━━━━');
      console.log(`👉 CÓDIGO: ${payload.code}`);
      console.log('Ingresa a WhatsApp > Dispositivos Vinculados > Vincular con número de teléfono y escribe este código.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    if (payload?.qr) {
      currentQrRaw = payload.qr;
      isBotReady = false;

      console.log('\n📲 ━━━━━━━━━━ ESCANEA ESTE CÓDIGO QR EN WHATSAPP ━━━━━━━━━━');
      try {
        qrcodeTerminal.generate(payload.qr, { small: true });
      } catch {}
      console.log(`🌐 O abre el panel web en: http://localhost:${PORT}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      try {
        currentQrBase64 = await QRCode.toDataURL(payload.qr, {
          width: 320,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });

        const qrPath = path.resolve(process.cwd(), 'bot.qr.png');
        const base64Data = currentQrBase64.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(qrPath, base64Data, 'base64');
      } catch (err) {
        console.error('Error generando QR image:', err);
      }
    }
  });

  // 2. Monitoreo de Conexión Exitosa
  adapterProvider.on('ready', () => {
    isBotReady = true;
    currentQrBase64 = '';
    currentPairingCode = '';
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ¡WHATSAPP CONECTADO EXITOSAMENTE!');
    console.log(`🤖 El bot de ${cdaConfig.name} está activo y atendiendo.`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Escanear y reanudar conversaciones pendientes + enviar recordatorios automáticamente
    setTimeout(async () => {
      try {
        await resumePendingConversations(adapterProvider);
        await sendRtmExpirationReminders(adapterProvider);
        await sendTomorrowAppointmentReminders(adapterProvider);
      } catch (e) {
        console.error('Error reanudando chats o enviando recordatorios al conectar:', e);
      }
    }, 4000);
  });

  adapterProvider.on('host', (host) => {
    connectedUser = host?.phone || host?.id || '';
    if (connectedUser) {
      console.log(`📞 Número de WhatsApp vinculado: +${connectedUser}`);
    }
  });

  // Interceptar todos los envíos de mensajes para asegurar que queden en el historial
  // y BLOQUEAR automáticamente cualquier respuesta a contactos excluidos (Jefes, Revicar)
  const rawSendMessage = adapterProvider.sendMessage.bind(adapterProvider);
  adapterProvider.sendMessage = async (numberIn: string, message: any, options: any) => {
    const cleanPhone = (numberIn || '').replace(/[^0-9]/g, '');
    if (isBlacklisted(cleanPhone)) {
      console.log(`🔇 [Envío Cancelado] El número +${cleanPhone} está en la Lista de Exclusión. No se enviará mensaje automático.`);
      return null;
    }
    const res = await rawSendMessage(numberIn, message, options);
    const text = typeof message === 'string' ? message : (message?.text || message?.caption || '');
    if (cleanPhone && text) {
      addMessage({
        from: cleanPhone,
        text,
        sender: 'BOT',
      });
    }
    return res;
  };

  // 3. Captura en tiempo real de Mensajes ENTRANTES de clientes
  adapterProvider.on('message', (payload: any) => {
    const from = (payload.from || '').replace(/[^0-9]/g, '');
    const body = payload.body || payload.text || '';
    const name = payload.name || payload.pushName || 'Cliente';

    if (from && body) {
      addMessage({
        from,
        name,
        text: body,
        sender: 'CLIENT',
      });
      console.log(`📥 [WhatsApp de +${from} (${name})]: ${body}`);
    }
  });

  // 4. Captura en tiempo real de Respuestas SALIENTES del Bot
  adapterProvider.on('send_message', (payload: any) => {
    const to = (payload.from || payload.to || '').replace(/[^0-9]/g, '');
    const answer = payload.answer || payload.message || '';

    if (to && answer) {
      addMessage({
        from: to,
        text: answer,
        sender: 'BOT',
      });
      console.log(`🤖 [Bot a +${to}]: ${typeof answer === 'string' ? answer.slice(0, 60) : ''}...`);
    }
  });

  // 5. Captura en tiempo real de Mensajes ENVIADOS DESDE EL CELULAR (Asesor Humano)
  let isHookAttached = false;
  const hookPhoneOutgoingMessages = () => {
    if (isHookAttached) return;
    try {
      const vendor = (adapterProvider as any).vendor;
      if (vendor?.ev) {
        isHookAttached = true;
        vendor.ev.on('messages.upsert', async (data: any) => {
          const { messages } = data || {};
          if (!Array.isArray(messages)) return;
          for (const msg of messages) {
            // Solo capturar mensajes salientes desde el teléfono (fromMe = true)
            if (!msg?.key?.fromMe) continue;

            const remoteJid = msg.key?.remoteJid || '';
            if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@g.us')) continue;

            const cleanPhone = normalizePhoneNumber(remoteJid);
            if (!cleanPhone || cleanPhone === connectedUser) continue;

            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         msg.message?.imageMessage?.caption ||
                         msg.message?.videoMessage?.caption ||
                         msg.message?.documentMessage?.caption ||
                         '';

            if (text && text.trim()) {
              // Pausar el bot para este cliente por 3 horas para que el asesor pueda atender sin que el bot interrumpa
              pauseBotForPhone(cleanPhone, 3);

              addMessage({
                from: cleanPhone,
                text: text.trim(),
                sender: 'AGENT',
              });
              console.log(`📱 [Asesor desde Celular a +${cleanPhone}]: ${text.trim().slice(0, 60)}...`);
            }
          }
        });
        console.log('📱 [Monitor Celular] Captura de mensajes del asesor desde WhatsApp móvil activa.');
      }
    } catch (err) {
      console.warn('No se pudo enganchar vendor.ev messages.upsert:', err);
    }
  };

  // Enganchar captura al iniciar y cuando el proveedor esté listo
  setTimeout(hookPhoneOutgoingMessages, 3000);
  adapterProvider.on('ready', () => {
    setTimeout(hookPhoneOutgoingMessages, 1500);
  });

  // Helper para leer el body JSON de las peticiones POST en Polka
  const parseJsonBody = (req: any): Promise<any> => {
    return new Promise((resolve) => {
      if (req.body && typeof req.body === 'object') {
        return resolve(req.body);
      }
      let raw = '';
      req.on('data', (chunk: any) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', () => {
        resolve({});
      });
    });
  };

  // 5. Middleware global en el servidor Polka para interceptar la web y las APIs
  adapterProvider.server.use(async (req: any, res: any, next: any) => {
    const url = req.url.split('?')[0];

    // Ruta Principal: Servir el Panel de Control Web
    if (url === '/' || url === '/index.html') {
      try {
        if (fs.existsSync(DASHBOARD_HTML_PATH)) {
          const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Cargando panel de control...</h2>');
      return;
    }

    // API: Estado de la conexión
    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          isReady: isBotReady,
          connectedUser,
          qrCode: currentQrBase64,
          pairingCode: currentPairingCode,
        })
      );
      return;
    }

    // API: Solicitar Pairing Code con número de teléfono
    if (url === '/api/pair' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { phone } = body || {};
        if (phone) {
          const cleanPhone = phone.replace(/[^0-9]/g, '');
          const vendor = (adapterProvider as any).vendor;
          if (vendor?.requestPairingCode) {
            const code = await vendor.requestPairingCode(cleanPhone);
            currentPairingCode = code;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, code }));
            return;
          }
        }
      } catch (err: any) {
        console.error('Error solicitando pairing code:', err);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Intentando generar código...' }));
      return;
    }

    // API: Enviar mensaje manual de asesor desde la web
    if (url === '/api/chats/send' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { phone, message } = body || {};
        if (phone && message) {
          const cleanPhone = phone.replace(/[^0-9]/g, '');
          await adapterProvider.sendMessage(cleanPhone, message, {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }
      } catch (err: any) {
        console.error('Error enviando mensaje manual:', err);
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Datos incompletos' }));
      return;
    }

    // API: Escanear el chat y generar/enviar respuesta con IA
    if (url === '/api/chats/ai-reply' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { phone, autoSend } = body || {};
        if (phone) {
          const cleanPhone = phone.replace(/[^0-9]/g, '');
          const messages = getConversation(cleanPhone);
          const validMsgs = messages.filter((m) => !m.text.startsWith('_event_'));
          const clientMsgs = validMsgs.filter((m) => m.sender === 'CLIENT');
          const lastMsg = clientMsgs.length > 0 ? clientMsgs[clientMsgs.length - 1].text : 'Hola';

          const reply = await getAiResponse(cleanPhone, lastMsg);
          if (autoSend && reply) {
            await adapterProvider.sendMessage(cleanPhone, reply, {});
            addMessage({
              from: cleanPhone,
              text: reply,
              sender: 'BOT',
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, reply, sent: !!autoSend }));
          return;
        }
      } catch (err: any) {
        console.error('Error generando respuesta IA:', err);
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No se pudo generar respuesta' }));
      return;
    }

    // API: Escanear y reanudar todas las conversaciones pendientes
    if (url === '/api/chats/scan-recover' && req.method === 'POST') {
      try {
        const count = await resumePendingConversations(adapterProvider);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
        return;
      }
    }

    // API: Listar todas las conversaciones activas
    if (url === '/api/chats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAllConversations()));
      return;
    }

    // API: Mensajes de un cliente específico (/api/chats/573001234567)
    if (url.startsWith('/api/chats/')) {
      const phone = url.replace('/api/chats/', '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getConversation(phone)));
      return;
    }

    // API: Listar Citas
    if (url === '/api/bookings') {
      try {
        const raw = fs.readFileSync(path.resolve(process.cwd(), 'data', 'citas.json'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw || '[]');
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    // API: Listar Clientes
    if (url === '/api/customers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAllCustomers()));
      return;
    }

    // API: Disparar recordatorios
    if (url === '/api/reminders/trigger' && req.method === 'POST') {
      try {
        const sentRtm = await sendRtmExpirationReminders(adapterProvider);
        const sentApp = await sendTomorrowAppointmentReminders(adapterProvider);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sentCount: sentRtm + sentApp }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
      return;
    }

    // API: Enviar Reporte Matutino de Citas de Hoy a WhatsApp del CDA (+573184561999)
    if (url === '/api/reminders/send-daily-summary' && req.method === 'POST') {
      try {
        const success = await sendDailyAdminBookingSummary(adapterProvider);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
      return;
    }

    next();
  });

  const botInstance = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });

  if ((botInstance as any)?.on) {
    (botInstance as any).on('send_message', (payload: any) => {
      const to = (payload.from || payload.to || '').replace(/[^0-9]/g, '');
      const answer = payload.answer || payload.message || '';
      if (to && answer) {
        addMessage({
          from: to,
          text: typeof answer === 'string' ? answer : JSON.stringify(answer),
          sender: 'BOT',
        });
      }
    });
  }

  // Inicializar cron de recordatorios
  initReminderCronJob(adapterProvider);

  // Iniciar servidor web en el puerto configurado
  botInstance.httpServer(PORT);

  console.log(`✅ Servidor Web y Monitor de Chats activo en: http://localhost:${PORT}`);
  console.log(`🔔 Base de datos de clientes cargada: ${getAllCustomers().length} clientes.`);

  // Proceso continuo 24/7
  setInterval(() => {}, 1000 * 60 * 60);
};

main().catch((err) => {
  console.error('❌ Error al iniciar el bot:', err);
});
