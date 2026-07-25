import Dexie, { type EntityTable } from 'dexie';

export interface Medication {
  id?: number;
  name: string;
  dose: string;
  form: string;
  type: 'daily' | 'prn';
  timeOfDay?: 'morning' | 'afternoon' | 'night';
  reminderTime?: string;
  doseQuantity?: number;
  notes?: string;
  quantityOnHand?: number;
  quantityPerRefill?: number;
  repeatsRemaining?: number;
  createdAt: Date;
}

export interface Schedule {
  id?: number;
  medicationId: number;
  time: string; // "HH:MM" e.g. "08:00"
  daysOfWeek: number[]; // 0=Sunday .. 6=Saturday, empty array = every day
}

export interface DoseLog {
  id?: number;
  medicationId: number;
  scheduledFor: Date;
  status: 'taken' | 'skipped' | 'snoozed' | 'pending';
  actionedAt?: Date;
}

const db = new Dexie('MedTrackerDB') as Dexie & {
  medications: EntityTable<Medication, 'id'>;
  schedules: EntityTable<Schedule, 'id'>;
  doseLogs: EntityTable<DoseLog, 'id'>;
};

db.version(1).stores({
  medications: '++id, name, createdAt',
  schedules: '++id, medicationId, time',
  doseLogs: '++id, medicationId, scheduledFor, status',
});

db.version(2).stores({
  medications: '++id, name, createdAt, type',
  schedules: '++id, medicationId, time',
  doseLogs: '++id, medicationId, scheduledFor, status',
});

export default db;