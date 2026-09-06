import 'dotenv/config';
import { getAiResponse } from '../services/ai.service.js';

async function test() {
  console.log('--- TEST CONTEXTO DIFERENTE AL CDA ---');
  const res = await getAiResponse('573009999999', 'Buenas tardes, ustedes venden repuestos para caja de cambios o hacen peritajes judiciales?');
  console.log(res);
}

test();
