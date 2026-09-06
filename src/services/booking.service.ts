import fs from 'fs';
import path from 'path';

export interface BookingData {
  id: string;
  phone: string;
  name: string;
  plate: string;
  vehicleType: string;
  fuelType?: string;
  brand?: string;
  model?: string;
  date: string;
  timeSlot: string;
  isoStart?: string;
  isoEnd?: string;
  googleEventId?: string;
  googleHtmlLink?: string;
  createdAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'citas.json');

// Asegurar existencia del directorio de datos y archivo de citas
const initStorage = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
};

export const saveBooking = (booking: Omit<BookingData, 'id' | 'createdAt' | 'status'>): BookingData => {
  initStorage();
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, 'utf-8');
    const bookings: BookingData[] = JSON.parse(raw || '[]');

    const newBooking: BookingData = {
      id: `CITA-${Date.now().toString().slice(-6)}`,
      ...booking,
      createdAt: new Date().toISOString(),
      status: 'CONFIRMED',
    };

    bookings.push(newBooking);
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
    return newBooking;
  } catch (error) {
    console.error('Error guardando cita local:', error);
    throw error;
  }
};

export const getBookingsByDate = (dateStr: string): BookingData[] => {
  initStorage();
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, 'utf-8');
    const bookings: BookingData[] = JSON.parse(raw || '[]');
    return bookings.filter((b) => b.date === dateStr || (b.isoStart && b.isoStart.startsWith(dateStr)));
  } catch {
    return [];
  }
};

export const getAllBookings = (): BookingData[] => {
  initStorage();
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
};

export const updateAllBookings = (bookings: BookingData[]): void => {
  initStorage();
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error actualizando citas:', err);
  }
};

