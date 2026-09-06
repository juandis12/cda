import 'dotenv/config';
import { getAllCustomers, getCustomersExpiringInDays } from '../services/customers.service.js';
import { getBookingsByDate } from '../services/booking.service.js';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 REPORTE DE VENCIMIENTOS Y CITAS - CONTROL AUTOS DE GIRARDOT');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const all = getAllCustomers();
console.log(`📁 Total clientes en base de datos: ${all.length}`);

console.log('\n🔍 Vencimientos en los próximos 15 días:');
for (const days of [1, 3, 7, 15]) {
  const expiring = getCustomersExpiringInDays(days);
  console.log(`• En ${days} día(s): ${expiring.length} vehículo(s)`);
  for (const c of expiring) {
    console.log(`   - [${c.plate}] ${c.name} (${c.brand || ''} ${c.model || ''}) | Tel: ${c.phone} | Vence: ${c.rtmExpirationDate}`);
  }
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().split('T')[0];
const tomorrowBookings = getBookingsByDate(tomorrowStr);

console.log(`\n📅 Citas agendadas para mañana (${tomorrowStr}): ${tomorrowBookings.length}`);
for (const b of tomorrowBookings) {
  console.log(`   - [${b.plate}] ${b.name} | Hora: ${b.timeSlot} | Tel: ${b.phone}`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
