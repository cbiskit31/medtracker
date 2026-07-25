'use client';

import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { type Medication } from '@/lib/db';

const emptyForm = {
  name: '',
  dose: '',
  form: 'tablet',
  type: 'daily' as 'daily' | 'prn',
  timeOfDay: 'morning' as 'morning' | 'afternoon' | 'night',
  reminderTime: '08:00',
  doseQuantity: '1',
  notes: '',
  quantityOnHand: '',
  quantityPerRefill: '',
  repeatsRemaining: '',
};

function stripeColor(med: Medication) {
  if (med.type === 'prn') return 'border-l-amber-400';
  if (med.timeOfDay === 'night') return 'border-l-indigo-400';
  if (med.timeOfDay === 'afternoon') return 'border-l-orange-400';
  return 'border-l-sky-400';
}

export default function Home() {
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tab, setTab] = useState<'today' | 'manage'>('today');
  const [googleToken, setGoogleToken] = useState<string | null>(null);

  const medications = useLiveQuery(() => db.medications.toArray(), []) ?? [];

  const todaysLogs = useLiveQuery(async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const all = await db.doseLogs.toArray();
    return all.filter((log) => log.scheduledFor >= startOfToday);
  }, []) ?? [];

  const todaysPrnCounts: Record<number, number> = {};
  for (const log of todaysLogs) {
    if (log.status === 'taken') {
      todaysPrnCounts[log.medicationId] = (todaysPrnCounts[log.medicationId] ?? 0) + 1;
    }
  }

  const lowStockMeds = medications.filter(
    (m) =>
      (m.repeatsRemaining !== undefined && m.repeatsRemaining <= 1) ||
      (m.quantityOnHand !== undefined && m.quantityOnHand <= 5)
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_ACTION') {
        actionDose(event.data.medicationId, event.data.action);
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const checkReminders = async () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;

      const meds = await db.medications.where('type').equals('daily').toArray();
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);

      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      for (const med of meds) {
        if (!med.reminderTime || med.reminderTime !== currentTime) continue;
        if (med.id === undefined) continue;

        const alreadyLogged = await db.doseLogs
          .where('medicationId')
          .equals(med.id)
          .and((log) => log.scheduledFor >= startOfToday)
          .first();

        if (alreadyLogged) continue;

        const registration = await navigator.serviceWorker.ready;
        registration.showNotification(`Time for ${med.name}`, {
          body: med.dose ? `${med.dose}${med.notes ? ' — ' + med.notes : ''}` : 'Reminder',
          tag: `med-${med.id}-${currentTime}`,
          data: { medicationId: med.id },
          actions: [
            { action: 'taken', title: 'Taken' },
            { action: 'skipped', title: 'Skip' },
            { action: 'snoozed', title: 'Snooze' },
          ],
        } as NotificationOptions);

        await db.doseLogs.add({
          medicationId: med.id,
          scheduledFor: now,
          status: 'pending',
        });
      }
    };

    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, []);

  function updateField(field: keyof typeof emptyForm, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function connectGoogle() {
    // @ts-expect-error - google is loaded globally via the script tag
    const client = google.accounts.oauth2.initTokenClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets',
      callback: (response: { access_token: string }) => {
        setGoogleToken(response.access_token);
        console.log('Got Google token:', response.access_token);
      },
    });
    client.requestAccessToken();
  }
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const payload = {
      name: formData.name.trim(),
      dose: formData.dose.trim(),
      form: formData.form,
      type: formData.type,
      timeOfDay: formData.type === 'daily' ? formData.timeOfDay : undefined,
      reminderTime: formData.type === 'daily' ? formData.reminderTime : undefined,
      doseQuantity: Number(formData.doseQuantity) || 1,
      notes: formData.notes.trim() || undefined,
      quantityOnHand: formData.quantityOnHand ? Number(formData.quantityOnHand) : undefined,
      quantityPerRefill: formData.quantityPerRefill ? Number(formData.quantityPerRefill) : undefined,
      repeatsRemaining: formData.repeatsRemaining ? Number(formData.repeatsRemaining) : undefined,
    };

    if (editingId !== null) {
      await db.medications.update(editingId, payload);
      setEditingId(null);
    } else {
      await db.medications.add({ ...payload, createdAt: new Date() });
    }

    setFormData(emptyForm);
  }

  function startEdit(med: Medication) {
    setEditingId(med.id ?? null);
    setFormData({
      name: med.name,
      dose: med.dose,
      form: med.form,
      type: med.type,
      timeOfDay: med.timeOfDay ?? 'morning',
      reminderTime: med.reminderTime ?? '08:00',
      doseQuantity: med.doseQuantity?.toString() ?? '1',
      notes: med.notes ?? '',
      quantityOnHand: med.quantityOnHand?.toString() ?? '',
      quantityPerRefill: med.quantityPerRefill?.toString() ?? '',
      repeatsRemaining: med.repeatsRemaining?.toString() ?? '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setFormData(emptyForm);
  }

  async function deleteMedication(id?: number) {
    if (id === undefined) return;
    if (!confirm('Delete this medication?')) return;
    await db.medications.delete(id);
    if (editingId === id) cancelEdit();
  }

  async function actionDose(medicationId: number, status: 'taken' | 'skipped' | 'snoozed') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const existing = await db.doseLogs
      .where('medicationId')
      .equals(medicationId)
      .and((log) => log.scheduledFor >= startOfToday && log.status === 'pending')
      .first();

    if (existing?.id !== undefined) {
      await db.doseLogs.update(existing.id, { status, actionedAt: new Date() });
    } else {
      await db.doseLogs.add({
        medicationId,
        scheduledFor: new Date(),
        status,
        actionedAt: new Date(),
      });
    }

    function connectGoogle() {
    // @ts-expect-error - google is loaded globally via the script tag
    const client = google.accounts.oauth2.initTokenClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets',
      callback: (response: { access_token: string }) => {
        setGoogleToken(response.access_token);
        console.log('Got Google token:', response.access_token);
      },
    });
    client.requestAccessToken();
   }

    if (status === 'taken') {
      const med = await db.medications.get(medicationId);
      if (med?.quantityOnHand !== undefined && med.quantityOnHand > 0) {
        const used = med.doseQuantity ?? 1;
        await db.medications.update(medicationId, { quantityOnHand: Math.max(0, med.quantityOnHand - used) });
      }
    }

    if (status === 'snoozed') {
      setTimeout(async () => {
        await db.doseLogs.add({
          medicationId,
          scheduledFor: new Date(),
          status: 'pending',
        });
      }, 10 * 60 * 1000);
    }
  }

  return (
    <main className="max-w-md mx-auto p-6 min-h-screen bg-stone-50">
      <div className="mb-6 text-center bg-teal-600 rounded-2xl py-5 shadow-sm border-2 border-teal-700">
        <h1 className="text-3xl font-bold text-white tracking-tight">MedTracker</h1>
        <p className="text-teal-100 text-sm mt-1">Keeping on top of it, together</p>
      </div>

      {tab === 'manage' && (
        <button
          onClick={() => setTab('today')}
          className="text-sm font-medium text-slate-700 border border-stone-300 rounded-full px-4 py-2 mb-4"
        >
          ← Back to Today
        </button>
      )}

      {lowStockMeds.length > 0 && (
        <div className="mb-6 border border-rose-300 bg-rose-50 rounded-xl px-4 py-3 text-rose-800">
          <p className="font-semibold mb-1">⚠ Low supply warning</p>
          <ul className="text-sm space-y-1">
            {lowStockMeds.map((med) => (
              <li key={med.id}>
                <span className="font-medium">{med.name}</span>
                {med.repeatsRemaining !== undefined && med.repeatsRemaining <= 1 && (
                  <span> — {med.repeatsRemaining} repeat{med.repeatsRemaining === 1 ? '' : 's'} left</span>
                )}
                {med.quantityOnHand !== undefined && med.quantityOnHand <= 5 && (
                  <span> — {med.quantityOnHand} on hand</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

     {tab === 'today' && (
        <div className="mb-6">
          {medications.filter((m) => m.type === 'daily').length > 0 && (
            <h2 className="text-lg font-semibold mb-3 text-slate-800">Today</h2>
          )}
          {(['morning', 'afternoon', 'night'] as const).map((period) => {
            const periodMeds = medications.filter((m) => m.type === 'daily' && m.timeOfDay === period);
            if (periodMeds.length === 0) return null;

            return (
              <div key={period} className="mb-4">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {period === 'morning' ? 'Morning' : period === 'afternoon' ? 'Afternoon' : 'Night'}
                </h3>
                <ul className="space-y-2">
                  {periodMeds.map((med) => {
                    const logsForMed = todaysLogs
                      .filter((log) => log.medicationId === med.id)
                      .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());
                    const latest = logsForMed[0];
                    const actioned = latest && latest.status !== 'pending';

                    return (
                      <li
                        key={med.id}
                        className={`border border-stone-200 border-l-4 ${stripeColor(med)} bg-white rounded-xl shadow-sm px-4 py-3 text-slate-800`}
                      >
                        <p className="font-medium">{med.name}</p>
                        {med.dose && <p className="text-sm text-slate-500">{med.dose}</p>}
                        {actioned ? (
                          <span
                            className={`inline-block text-sm mt-2 px-3 py-1 rounded-full font-medium ${
                              latest.status === 'taken'
                                ? 'bg-teal-100 text-teal-700'
                                : latest.status === 'skipped'
                                ? 'bg-stone-200 text-stone-600'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {latest.status === 'taken' && 'Done'}
                            {latest.status === 'skipped' && 'Skipped'}
                            {latest.status === 'snoozed' && 'Snoozed (10m)'}
                          </span>
                        ) : (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => actionDose(med.id!, 'taken')}
                              className="text-sm bg-teal-600 text-white rounded-full px-4 py-1.5 font-medium"
                            >
                              Taken
                            </button>
                            <button
                              onClick={() => actionDose(med.id!, 'skipped')}
                              className="text-sm bg-stone-400 text-white rounded-full px-4 py-1.5 font-medium"
                            >
                              Skipped
                            </button>
                            <button
                              onClick={() => actionDose(med.id!, 'snoozed')}
                              className="text-sm bg-amber-500 text-white rounded-full px-4 py-1.5 font-medium"
                            >
                              Snooze 10m
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {medications.filter((m) => m.type === 'prn').length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">As Needed (PRN)</h3>
              <ul className="space-y-2">
                {medications
                  .filter((m) => m.type === 'prn')
                  .map((med) => (
                    <li
                      key={med.id}
                      className={`border border-stone-200 border-l-4 ${stripeColor(med)} bg-white rounded-xl shadow-sm px-4 py-3 text-slate-800 flex justify-between items-center`}
                    >
                      <div>
                        <p className="font-medium">{med.name}</p>
                        {med.dose && <p className="text-sm text-slate-500">{med.dose}</p>}
                        {todaysPrnCounts[med.id!] > 0 && (
                          <p className="text-sm text-slate-500">Taken {todaysPrnCounts[med.id!]}× today</p>
                        )}
                      </div>
                      <button
                        onClick={() => actionDose(med.id!, 'taken')}
                        className="text-sm bg-teal-600 text-white rounded-full px-4 py-1.5 font-medium"
                      >
                        Log dose
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end mt-8">
            <button
              onClick={() => setTab('manage')}
              className="text-sm font-medium text-white bg-slate-600 rounded-full px-5 py-2 shadow-sm"
            >
              Manage
            </button>
          </div>
        </div>
      )}

    {tab === 'manage' && (
        <>
          <div className="mb-4">
            {googleToken ? (
              <p className="text-sm text-teal-700 font-medium">✓ Google account connected</p>
            ) : (
              <button
                onClick={connectGoogle}
                className="text-sm font-medium text-white bg-teal-600 rounded-full px-4 py-2"
              >
                Connect Google Account
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-white rounded-xl shadow-sm p-4 border border-stone-200">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Medication name</label>
              <input
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Paracetamol"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Dose</label>
              <input
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.dose}
                onChange={(e) => updateField('dose', e.target.value)}
                placeholder="e.g. 500mg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Quantity per dose (e.g. 1, 0.5)</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.doseQuantity}
                onChange={(e) => updateField('doseQuantity', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Form</label>
              <select
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.form}
                onChange={(e) => updateField('form', e.target.value)}
              >
                <option value="tablet">Tablet</option>
                <option value="capsule">Capsule</option>
                <option value="liquid">Liquid</option>
                <option value="injection">Injection</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Schedule type</label>
              <select
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.type}
                onChange={(e) => updateField('type', e.target.value as 'daily' | 'prn')}
              >
                <option value="daily">Daily</option>
                <option value="prn">As needed (PRN)</option>
              </select>
            </div>

            {formData.type === 'daily' && (
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Time of day</label>
                <select
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={formData.timeOfDay}
                  onChange={(e) => updateField('timeOfDay', e.target.value as 'morning' | 'afternoon' | 'night')}
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="night">Night</option>
                </select>
              </div>
            )}

            {formData.type === 'daily' && (
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Reminder time</label>
                <input
                  type="time"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={formData.reminderTime}
                  onChange={(e) => updateField('reminderTime', e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Notes</label>
              <textarea
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="e.g. take with food"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Qty on hand</label>
                <input
                  type="number"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={formData.quantityOnHand}
                  onChange={(e) => updateField('quantityOnHand', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">Qty per refill</label>
                <input
                  type="number"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={formData.quantityPerRefill}
                  onChange={(e) => updateField('quantityPerRefill', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">Repeats remaining</label>
              <input
                type="number"
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={formData.repeatsRemaining}
                onChange={(e) => updateField('repeatsRemaining', e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-teal-600 text-white rounded-full px-3 py-2 font-medium"
              >
                {editingId !== null ? 'Save changes' : 'Add Medication'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-3 py-2 rounded-full border border-stone-300 text-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {['daily', 'prn'].map((section) => {
            const list = medications.filter((m) => m.type === section);
            if (list.length === 0) return null;
            return (
              <div key={section} className="mb-6">
                <h2 className="text-lg font-semibold mb-3 text-slate-800">
                  {section === 'daily' ? 'Daily Medications' : 'As Needed (PRN)'}
                </h2>
                <ul className="space-y-2">
                  {list.map((med) => {
                    const lowRepeats = med.repeatsRemaining !== undefined && med.repeatsRemaining <= 1;
                    const lowQty = med.quantityOnHand !== undefined && med.quantityOnHand <= 5;
                    return (
                      <li
                        key={med.id}
                        className={`border border-stone-200 border-l-4 ${stripeColor(med)} rounded-xl shadow-sm px-4 py-3 text-slate-800 ${
                          lowRepeats || lowQty ? 'bg-rose-50' : 'bg-white'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-medium">{med.name}</span>
                            {med.dose && <span className="text-slate-500"> — {med.dose}</span>}
                            <span className="text-slate-400 text-sm"> ({med.form})</span>
                            {section === 'prn' && todaysPrnCounts[med.id!] > 0 && (
                              <span className="text-slate-500 text-sm"> — taken {todaysPrnCounts[med.id!]}× today</span>
                            )}
                            {med.timeOfDay && (
                              <span className="text-slate-400 text-sm">
                                {' '}
                                · {med.timeOfDay === 'morning' ? 'Morning' : med.timeOfDay === 'afternoon' ? 'Afternoon' : 'Night'}
                              </span>
                            )}
                            {med.notes && <p className="text-sm text-slate-500 mt-1">{med.notes}</p>}
                            {(med.quantityOnHand !== undefined || med.quantityPerRefill !== undefined) && (
                              <p className="text-sm text-slate-500">
                                On hand: {med.quantityOnHand ?? '—'} · Per refill: {med.quantityPerRefill ?? '—'}
                              </p>
                            )}
                            {med.repeatsRemaining !== undefined && (
                              <p className={`text-sm ${lowRepeats ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>
                                {lowRepeats ? '⚠ ' : ''}Repeats remaining: {med.repeatsRemaining}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0 ml-2">
                            <button onClick={() => startEdit(med)} className="text-sm text-sky-600 font-medium">
                              Edit
                            </button>
                            <button onClick={() => deleteMedication(med.id)} className="text-sm text-rose-500 font-medium">
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}