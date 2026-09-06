import 'dotenv/config';

export interface PriceRange {
  minYear?: number;
  maxYear?: number;
  price: string;
  neto?: string;
  iva?: string;
  runt?: string;
  sicov?: string;
  recaudo?: string;
  ansv?: string;
}

export interface VehicleCategoryConfig {
  category: string;
  name: string;
  description: string;
  fuels: string[];
  serviceType?: 'Particular' | 'Público';
  basePrice?: string;
  priceByModel?: PriceRange[];
  details: string[];
}

export interface CDAConfig {
  name: string;
  shortName: string;
  nit: string;
  city: string;
  address: string;
  mapsUrl: string;
  wazeUrl: string;
  phone: string;
  whatsappAdvisor: string;
  advisorUrl: string;
  inspectionDurationMinutes: number;
  schedule: {
    weekdays: string;
    weekdaysHours: { open: string; close: string }; // 07:00 - 19:00
    saturdays: string;
    saturdaysHours: { open: string; close: string }; // 07:00 - 17:00
    sundaysAndHolidays: string;
    sundaysHours: { open: string; close: string }; // 08:00 - 12:00
  };
  categories: Record<string, VehicleCategoryConfig>;
  rtmRequirements: string[];
  retestPolicy: {
    daysAllowed: number;
    description: string;
  };
  blacklist: { name: string; phone: string }[];
}

export function isBlacklisted(phoneOrJid: string): boolean {
  if (!phoneOrJid) return false;
  const clean = phoneOrJid.replace(/[^0-9]/g, '');
  const blacklisted = [
    // Revicar SAS SOAT (Teléfono + LID)
    '573112921709', '3112921709', '56109989646559',
    // Jefe Juan Pablo (Teléfonos + LIDs)
    '573125491389', '3125491389', '254017317953725',
    '573508496417', '3508496417',
    '573504896417', '3504896417',
    // Jefe Leonardo / Cardeñoza (Teléfonos + LIDs)
    '573023752035', '3023752035', '221281177878779',
    '573144130586', '3144130586',
    // Números Administrativos / CDA La Estación / Excluidos
    '573218352436', '3218352436',
  ];
  return blacklisted.some((b) => clean === b || clean.endsWith(b) || b.endsWith(clean));
}

export const cdaConfig: CDAConfig = {
  name: process.env.CDA_NAME || "Control Autos De Girardot",
  shortName: process.env.CDA_SHORT_NAME || "Control Autos Girardot",
  nit: process.env.CDA_NIT || "900.554.151-6",
  city: process.env.CDA_CITY || "Girardot, Cundinamarca",
  address: process.env.CDA_ADDRESS || "Girardot, Cundinamarca",
  mapsUrl: process.env.CDA_MAPS_URL || "https://maps.app.goo.gl/1NCPcLwNEUKWadjQ6",
  wazeUrl: process.env.CDA_WAZE_URL || "https://waze.com/ul",
  phone: process.env.CDA_PHONE || "+57 318 456 1999",
  whatsappAdvisor: process.env.CDA_ADVISOR_PHONE || "573184561999",
  advisorUrl: process.env.CDA_ADVISOR_URL || "https://wa.me/573184561999?text=Hola,%20deseo%20asesoria%20en%20Control%20Autos%20De%20Girardot",
  inspectionDurationMinutes: 30,
  schedule: {
    weekdays: "Lunes a Viernes: 7:00 AM a 7:00 PM (Jornada continua)",
    weekdaysHours: { open: "07:00", close: "19:00" },
    saturdays: "Sábados: 7:00 AM a 7:00 PM (Jornada continua)",
    saturdaysHours: { open: "07:00", close: "19:00" },
    sundaysAndHolidays: "Domingos y Festivos: 8:00 AM a 1:00 PM (Medio día)",
    sundaysHours: { open: "08:00", close: "13:00" },
  },
  categories: {
    "1": {
      category: "Motos",
      name: "Motocicletas (4 Tiempos / Motocarros)",
      description: "Motos de 4 tiempos y motocarros.",
      fuels: ["Gasolina"],
      basePrice: "$247.274",
      priceByModel: [
        { minYear: 2024, maxYear: 2026, price: "$246.974", neto: "$157.187", iva: "$29.866", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.500" },
        { minYear: 2019, maxYear: 2023, price: "$247.274", neto: "$157.187", iva: "$29.866", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.800" },
        { minYear: 2010, maxYear: 2018, price: "$247.574", neto: "$157.187", iva: "$29.866", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.100" },
        { maxYear: 2009, price: "$247.274", neto: "$157.187", iva: "$29.866", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.800" },
      ],
      details: [
        "Prueba computarizada en frenómetro de moto",
        "Análisis de emisión de gases y opacidad",
        "Inspección sensorial, luces, suspensión y chasis",
        "Tiempo de revisión estimado: 30 minutos",
      ],
    },
    "2": {
      category: "Livianos Particular",
      name: "Vehículos Livianos Particular / Ordinario",
      description: "Automóviles, camperos, camionetas particulares (Gasolina, Diésel, Gas).",
      fuels: ["Gasolina", "Diésel", "Gas vehicular"],
      serviceType: "Particular",
      basePrice: "$368.537",
      priceByModel: [
        { minYear: 2024, maxYear: 2026, price: "$368.237", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.000" },
        { minYear: 2019, maxYear: 2023, price: "$368.537", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.300" },
        { minYear: 2010, maxYear: 2018, price: "$368.937", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.700" },
        { maxYear: 2009, price: "$368.537", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.300" },
      ],
      details: [
        "Inspección sensorial, carrocería y chasis",
        "Detector de holguras y prueba de suspensión",
        "Frenómetro de alta precisión en las 4 ruedas",
        "Análisis de gases contaminantes según combustible (Gasolina/Diésel/Gas)",
        "Tiempo de revisión estimado: 30 minutos",
      ],
    },
    "3": {
      category: "Livianos Público",
      name: "Vehículos Livianos Público (Taxis / Servicio Público)",
      description: "Taxis, camperos y vans de servicio público.",
      fuels: ["Gasolina", "Diésel", "Gas vehicular"],
      serviceType: "Público",
      basePrice: "$367.937",
      priceByModel: [
        { minYear: 2024, maxYear: 2026, price: "$367.637", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.400" },
        { minYear: 2019, maxYear: 2023, price: "$367.937", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.700" },
        { minYear: 2010, maxYear: 2018, price: "$368.237", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.000" },
        { maxYear: 2009, price: "$367.937", neto: "$258.669", iva: "$49.147", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.700" },
      ],
      details: [
        "Inspección sensorial, carrocería y chasis",
        "Detector de holguras y prueba de suspensión",
        "Frenómetro de alta precisión en las 4 ruedas",
        "Análisis de gases contaminantes (Gasolina/Diésel/Gas)",
        "Tiempo de revisión estimado: 30 minutos",
      ],
    },
    "4": {
      category: "Pesados Particular",
      name: "Vehículos Pesados Particular (Diésel)",
      description: "Camiones, furgones y camperos pesados particulares (+3.5 ton).",
      fuels: ["Diésel"],
      serviceType: "Particular",
      basePrice: "$562.584",
      priceByModel: [
        { minYear: 2024, maxYear: 2026, price: "$562.284", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.500" },
        { minYear: 2019, maxYear: 2023, price: "$562.584", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.800" },
        { minYear: 2010, maxYear: 2018, price: "$562.884", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$9.100" },
        { maxYear: 2009, price: "$562.584", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.800" },
      ],
      details: [
        "Pista de inspección pesada",
        "Prueba de frenos con medición de carga por eje",
        "Opacímetro certificado para Diésel",
        "Revisión de dirección, quinta rueda y tren motriz",
        "Tiempo de revisión estimado: 30 minutos",
      ],
    },
    "5": {
      category: "Pesados Público",
      name: "Vehículos Pesados Público (Buses / Camiones / Volquetas)",
      description: "Buses, microbuses, volquetas, camiones de servicio público.",
      fuels: ["Diésel"],
      serviceType: "Público",
      basePrice: "$562.084",
      priceByModel: [
        { minYear: 2024, maxYear: 2026, price: "$561.884", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.100" },
        { minYear: 2019, maxYear: 2023, price: "$562.084", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.300" },
        { minYear: 2010, maxYear: 2018, price: "$562.284", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.500" },
        { maxYear: 2009, price: "$562.084", neto: "$422.154", iva: "$80.209", runt: "$5.600", sicov: "$35.492", recaudo: "$10.329", ansv: "$8.300" },
      ],
      details: [
        "Pista de inspección pesada",
        "Prueba de frenos con medición de carga por eje",
        "Opacímetro certificado para Diésel",
        "Revisión de dirección, chasis y tren motriz",
        "Tiempo de revisión estimado: 30 minutos",
      ],
    },
  },
  rtmRequirements: [
    "📄 *Licencia de Tránsito* (Tarjeta de propiedad física o digital RUNT).",
    "ℹ️ *IMPORTANTE:* El SOAT vigente *NO es obligatorio* para realizar la inspección técnico-mecánica en nuestro CDA.",
    "🚗 *Vehículo limpio:* carrocería y chasis en óptimas condiciones de aseo para la inspección visual.",
    "📦 *Baúl y habitáculo desocupados* (sin cargas u objetos que impidan la revisión).",
    "🔩 *Perno de seguridad:* si las llantas poseen perno de seguridad, por favor déjalo a la mano.",
    "⛽ *Nivel de combustible suficiente* para las pruebas dinámicas y de gases en pista.",
  ],
  retestPolicy: {
    daysAllowed: 15,
    description: "Si tu vehículo no aprueba algún ítem en la primera inspección, por ley tienes *15 días hábiles* para corregir la falla y presentarlo a una *segunda revisión totalmente GRATIS* en nuestra pista.",
  },
  blacklist: [
    { name: "Revicar SAS SOAT", phone: "573112921709" },
    { name: "Jefe Juan Pablo", phone: "573125491389" },
    { name: "Jefe Juan Pablo (2)", phone: "573508496417" },
    { name: "Jefe Juan Pablo (3)", phone: "573504896417" },
    { name: "Jefe Leonardo", phone: "573023752035" },
    { name: "Jefe Leonardo (2)", phone: "573144130586" },
  ],
};
