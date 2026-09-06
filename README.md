# 🚗 Control Autos De Girardot - WhatsApp Bot 🏍️
### Chatbot Oficial de WhatsApp con BuilderBot, Google Calendar & Sistema de Recordatorios Proactivos

Bot interactivo de WhatsApp desarrollado con **[BuilderBot](https://www.builderbot.app/es)** (Node.js & TypeScript), personalizado para **Control Autos De Girardot**.

---

## ✨ Nuevas Funcionalidades: Recordatorios y Base de Datos de Clientes

### 1. 🔔 Aviso Automático de Vencimiento de RTM:
- El sistema escanea la base de datos de clientes y detecta automáticamente los vehículos que están por vencer su revisión (15, 7, 3 y 1 día antes).
- Les envía un mensaje personalizado a su WhatsApp indicando placa, marca, modelo y fecha de vencimiento.
- **Llamado a la acción:** Invita al cliente a responder *"AGENDAR"* para apartar su turno de 30 minutos sin filas.

### 2. ⏰ Recordatorio de Cita (1 Día Antes):
- Faltando 1 día para la cita agendada en Google Calendar, el bot envía automáticamente un recordatorio al cliente confirmando la hora exacta, sede, vehículo y recordándole que el SOAT no es obligatorio.

### 3. 📁 Cómo Cargar tu Base de Datos de Clientes:
Puedes cargar la información de tus clientes en cualquiera de estos dos formatos en la carpeta `data/`:

- **Opción A (Archivo CSV):** `data/clientes.csv`
  ```csv
  nombre,telefono,placa,tipo_vehiculo,marca,modelo,fecha_vencimiento_rtm,notas
  Juan Perez,573001234567,ABC123,Liviano Gasolina,Chevrolet,Sail 2018,2026-09-15,Particular
  Andres Gutierrez,573105554433,KLR45E,Moto 4T,Kawasaki,Versys 2021,2026-09-11,Motos
  ```
- **Opción B (Archivo JSON):** `data/clientes.json`
  *(Ya tienes una plantilla de ejemplo en `data/clientes.json` y `data/clientes.example.csv`).*

---

## 🚀 Inicio Rápido

```bash
npm run dev
```
Escanea el código QR que se mostrará en pantalla o en `http://localhost:3008` desde tu WhatsApp (Dispositivos vinculados > Vincular un dispositivo).

### 🔍 Comprobar Vencimientos y Citas de Mañana Manualmente:
```bash
npm run reminders
```

---

## 📅 Conexión con Google Calendar

1. Coloca tu archivo `google-credentials.json` (Service Account de Google Cloud con permisos en Google Calendar) en la raíz del proyecto.
2. Configura el ID de tu calendario en el archivo `.env`:
   ```env
   GOOGLE_CALENDAR_ID="primary"
   ```
*(Si aún no configuras Google Calendar, el bot opera automáticamente guardando las citas de forma local en `data/citas.json`).*

---

## 🕒 Horarios de Atención Oficiales
- **Lunes a Viernes:** 7:00 AM a 7:00 PM (Jornada continua)
- **Sábados:** 7:00 AM a 5:00 PM (Jornada continua)
- **Domingos y Festivos:** 8:00 AM a 12:00 PM (Medio día)
- **Tiempo de Inspección:** 30 minutos
