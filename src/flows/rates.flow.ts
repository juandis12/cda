import { addKeyword } from '@builderbot/bot';
import { cdaConfig, isBlacklisted } from '../config/cda.config.js';
import { isBotPaused } from '../services/pause.service.js';
import { getAllCustomers, getVehiclePrice } from '../services/customers.service.js';

export const ratesFlow = addKeyword([
  'tarifa',
  'tarifas',
  'precio',
  'precios',
  'cuanto vale',
  'cuánto vale',
  'costo',
  'costos',
  'cotizar',
  'cotizacion',
  'cotización',
  'valor',
  'valores',
  'tecno',
  'tecnomecanica',
  'tecnicomecanica',
  'técnicomecánica',
  'tecnico mecanica',
  'técnico mecánica',
])
  .addAction(async (ctx, { endFlow }) => {
    if (isBlacklisted(ctx.from)) {
      return endFlow();
    }
  })
  .addAnswer(
    [
      `💰 *CONSULTA DE TARIFA OFICIAL - ${cdaConfig.shortName.toUpperCase()}*`,
      `Para darte el valor exacto de tu Revisión Técnico-Mecánica:`,
      '',
      '👉 *Paso 1:* Por favor escribe la *PLACA* de tu vehículo (Ej: *ABC123* o *ABC12D*):',
    ].join('\n'),
    { capture: true },
    async (ctx, { state, flowDynamic, fallBack }) => {
      const plate = ctx.body.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (plate.length < 5 || plate.length > 7) {
        return fallBack('⚠️ Por favor ingresa una placa válida colombiana (Ejemplo: *ABC123* o *XYZ45D*):');
      }

      await state.update({ ratePlate: plate });

      // Verificar si la placa ya existe en la base de datos del CDA
      const allCustomers = getAllCustomers();
      const match = allCustomers.find((c) => c.plate === plate);

      if (match) {
        const vehicleDesc = [match.brand, match.model].filter(Boolean).join(' ') || 'tu vehículo';
        const price = match.price || getVehiclePrice(match.vehicleType, match.serviceType);

        await state.update({ foundInDb: true });

        await flowDynamic([
          `✅ *TARIFA REVISIÓN TÉCNICO-MECÁNICA 2026*`,
          `🏢 *${cdaConfig.name}*`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🚘 *Placa:* ${plate}`,
          `🚗 *Vehículo:* ${vehicleDesc}`,
          `📌 *Tipo:* ${match.vehicleType || 'Liviano'} (${match.serviceType || 'Particular'})`,
          `💵 *Valor Oficial:* *${price}*`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `⏱️ *¡La revisión se realiza en solo ${cdaConfig.inspectionDurationMinutes} minutos!*`,
          `🟢 *El SOAT vigente NO es obligatorio para la inspección.*`,
          '',
          `¿Deseas agendar tu turno ahora? Escribe *AGENDAR* o escribe *MENU* para volver al inicio.`,
        ].join('\n'));
      }
    }
  )
  .addAnswer(
    [
      '👉 *Paso 2:* Escribe el *MODELO / AÑO* de tu vehículo:',
      '_(Ejemplo: 2018, 2022, 2015)_',
    ].join('\n'),
    { capture: true },
    async (ctx, { state, flowDynamic, fallBack, endFlow }) => {
      const myState = state.getMyState() || {};
      if (myState.foundInDb) {
        // Ya se le dio el precio porque estaba en la base de datos
        return;
      }

      const modelInput = ctx.body.trim();
      const modelYear = parseInt(modelInput.replace(/[^0-9]/g, ''), 10);
      if (isNaN(modelYear) || modelYear < 1950 || modelYear > 2030) {
        return fallBack('⚠️ Por favor escribe un año de modelo válido de 4 dígitos (Ejemplo: *2020*):');
      }

      await state.update({ rateModel: modelYear });
    }
  )
  .addAnswer(
    [
      '👉 *Paso 3:* Selecciona el *TIPO DE VEHÍCULO*:',
      '1. 🏍️ Moto (4 Tiempos)',
      '2. 🚗 Liviano Particular (Automóvil, Campero, Camioneta)',
      '3. 🚕 Liviano Público (Taxi, Servicio Especial, Van)',
      '4. 🚛 Pesado Particular (Camión, Furgón Diésel)',
      '5. 🚌 Pesado Público (Bus, Volqueta, Camión Diésel)',
      '',
      'Escribe el número (*1 al 5*):',
    ].join('\n'),
    { capture: true },
    async (ctx, { state, flowDynamic, fallBack }) => {
      const myState = state.getMyState() || {};
      if (myState.foundInDb) return;

      const opt = ctx.body.trim();
      const map: Record<string, { desc: string; price: string }> = {
        '1': { desc: 'Moto 4T', price: '$247.274' },
        '2': { desc: 'Liviano Particular', price: '$368.537' },
        '3': { desc: 'Liviano Público', price: '$367.937' },
        '4': { desc: 'Pesado Particular (Diésel)', price: '$562.584' },
        '5': { desc: 'Pesado Público (Diésel)', price: '$562.084' },
      };

      const selected = map[opt];
      if (!selected) {
        return fallBack('⚠️ Opción no válida. Por favor digita un número del *1 al 5*:');
      }

      const plate = myState.ratePlate || 'Tu vehículo';
      const year = myState.rateModel || '';

      await flowDynamic([
        `✅ *TARIFA REVISIÓN TÉCNICO-MECÁNICA 2026*`,
        `🏢 *${cdaConfig.name}*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🚘 *Placa:* ${plate}`,
        `🚗 *Tipo:* ${selected.desc} ${year ? `(Modelo ${year})` : ''}`,
        `💵 *Valor Oficial:* *${selected.price}*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `⏱️ *¡La revisión se realiza en solo ${cdaConfig.inspectionDurationMinutes} minutos!*`,
        `🟢 *El SOAT vigente NO es obligatorio para la inspección.*`,
        '',
        `¿Deseas agendar tu turno ahora? Escribe *AGENDAR* o escribe *MENU* para volver al inicio.`,
      ].join('\n'));
    }
  );
