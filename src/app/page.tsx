'use client';

import { useState, useEffect, useCallback } from 'react';

const CURRENT_USER_ID = 1; // hardcoded for now — real login comes later

interface Medication {
  id: number;
  userId: number;
  name: string;
  dose: string | null;
  doseQuantity: number;
  form: string;
  type: 'daily' | 'prn';
  timeOfDay: 'morning' | 'afternoon' | 'night' | null;
  reminderTime: string | null;
  notes: string | null;
  quantityOnHand: number | null;
  quantityPerRefill: number | null;
  repeatsRemaining: number | null;
}

interface DoseLog {
  id: number;
  medicationId: number;
  scheduledFor: string;
  status: 'taken' | 'skipped' | 'snoozed' | 'pending';
  actionedAt: string | null;
}

const emptyForm = {
  name: '',
  dose: '',
  doseQuantity: '1',
  form: 'tablet',
  type: 'daily' as 'daily' | 'prn',
  timeOfDay: 'morning' as 'morning' | 'afternoon' | 'night',
  reminderTime: '08:00',
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
  const [medications, setMedications] = useState<Medication[]>([]);
  const [todaysLogs, setTodaysLogs] = useState<DoseLog[]>([]);

  const fetchMedications = useCallback(async () => {
    const res = await fetch(`/api/medications?userId=${CURRENT_USER_ID}`);
    const data = await res.json();
    setMedications(data);
  }, []);

  const fetchTodaysLogs = useCallback(async () => {
    const res = await fetch(`/api/doselogs?userId=${CURRENT_USER_ID}`);
    const data = await res.json();
    setTodaysLogs(data);
  }, []);

  useEffect(() => {
    fetchMedications();
    fetchTodaysLogs();
  }, [fetchMedications, fetchTodaysLogs]);

  const todaysPrnCounts: Record<number, number> = {};
  for (const log of todaysLogs) {
    if (log.status === 'taken') {
      todaysPrnCounts[log.medicationId] = (todaysPrnCounts[log.medicationId] ?? 0) + 1;
    }
  }

  const lowStockMeds = medications.filter(
    (m) =>
      (m.repeatsRemaining !== null && m.repeatsRemaining <= 1) ||
      (m.quantityOnHand !== null && m.quantityOnHand <= 5)
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

      const medsRes = await fetch(`/api/medications?userId=${CURRENT_USER_ID}`);
      const meds: Medication[] = await medsRes.json();
      const logsRes = await fetch(`/api/doselogs?userId=${CURRENT_USER_ID}`);
      const logs: DoseLog[] = await logsRes.json();

      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);

      for (const med of meds) {
        if (med.type !== 'daily') continue;
        if (!med.reminderTime || med.reminderTime !== currentTime) continue;

        const alreadyLogged = logs.some((log) => log.medicationId === med.id);
        if (alreadyLogged) continue;

        const registration = await navigator.serviceWorker.ready;
        registration.showNotification(`Time for ${med.name}`, {
          body: med.dose ? `${med.dose}${med.notes ? ' — ' + med.notes : ''}` : 'Reminder',
          tag: `med-${med.id}-${currentTime}`,
          data: { medicationId: med.id },
          actions: [
            { action: 'taken', title: '✅ Taken' },
            { action: 'skipped', title: '⏭ Skip' },
            { action: 'snoozed', title: '⏰ Snooze' },
          ],
        } as NotificationOptions);

        await fetch('/api/doselogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            medicationId: med.id,
            scheduledFor: now.toISOString(),
            status: 'pending',
          }),
        });

        fetchTodaysLogs();
      }
    };

    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [fetchTodaysLogs]);

  function updateField(field: keyof typeof emptyForm, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const payload = {
      userId: CURRENT_USER_ID,
      name: formData.name.trim(),
      dose: formData.dose.trim(),
      doseQuantity: Number(formData.doseQuantity) || 1,
      form: formData.form,
      type: formData.type,
      timeOfDay: formData.type === 'daily' ? formData.timeOfDay : undefined,
      reminderTime: formData.type === 'daily' ? formData.reminderTime : undefined,
      notes: formData.notes.trim() || undefined,
      quantityOnHand: formData.quantityOnHand ? Number(formData.quantityOnHand) : undefined,
      quantityPerRefill: formData.quantityPerRefill ? Number(formData.quantityPerRefill) : undefined,
      repeatsRemaining: formData.repeatsRemaining ? Number(formData.repeatsRemaining) : undefined,
    };

    if (editingId !== null) {
      await fetch(`/api/medications/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setEditingId(null);
    } else {
      await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    setFormData(emptyForm);
    fetchMedications();
  }

  function startEdit(med: Medication) {
    setEditingId(med.id);
    setFormData({
      name: med.name,
      dose: med.dose ?? '',
      doseQuantity: med.doseQuantity?.toString() ?? '1',
      form: med.form,
      type: med.type,
      timeOfDay: med.timeOfDay ?? 'morning',
      reminderTime: med.reminderTime ?? '08:00',
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

  async function deleteMedication(id: number) {
    if (!confirm('Delete this medication?')) return;
    await fetch(`/api/medications/${id}`, { method: 'DELETE' });
    if (editingId === id) cancelEdit();
    fetchMedications();
  }

  async function actionDose(medicationId: number, status: 'taken' | 'skipped' | 'snoozed') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const existing = todaysLogs.find(
      (log) => log.medicationId === medicationId && log.status === 'pending'
    );

    if (existing) {
      await fetch(`/api/doselogs/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, actionedAt: new Date().toISOString() }),
      });
    } else {
      await fetch('/api/doselogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId,
          scheduledFor: new Date().toISOString(),
          status,
          actionedAt: new Date().toISOString(),
        }),
      });
    }

    if (status === 'taken') {
      const med = medications.find((m) => m.id === medicationId);
      if (med?.quantityOnHand !== null && med?.quantityOnHand !== undefined && med.quantityOnHand > 0) {
        const used = med.doseQuantity ?? 1;
        await fetch(`/api/medications/${medicationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...med, quantityOnHand: Math.max(0, med.quantityOnHand - used) }),
        });
      }
    }

    if (status === 'snoozed') {
      setTimeout(async () => {
        await fetch('/api/doselogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            medicationId,
            scheduledFor: new Date().toISOString(),
            status: 'pending',
          }),
        });
        fetchTodaysLogs();
      }, 10 * 60 * 1000);
    }

    fetchMedications();
    fetchTodaysLogs();
  }

  return (
    <main className="max-w-md mx-auto p-6 min-h-screen bg-stone-50">
      <div className="mb-6 text-center bg-teal-600 rounded-2xl py-5 shadow-sm border-2 border-teal-700">
        <h1 className="text-3xl font-bold text-white tracking-tight">MedTracker</h1>
        <p className="text-teal-100 text-sm mt-1">Keeping on top of it, together</p>
      </div>

      <div className="flex gap-1 mb-6 bg-stone-200 rounded-full p-1">
        <button
          onClick={() => setTab('today')}
          className={`flex-1 py-2 rounded-full font-medium text-sm transition-colors ${
            tab === 'today' ? 'bg-rose-400 text-white shadow-sm' : 'text-slate-600'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setTab('manage')}
          className={`flex-1 py-2 rounded-full font-medium text-sm transition-colors ${
            tab === 'manage' ? 'bg-amber-400 text-white shadow-sm' : 'text-slate-600'
          }`}
        >
          Manage
        </button>
      </div>

      {lowStockMeds.length > 0 && (
        <div className="mb-6 border border-rose-300 bg-rose-50 rounded-xl px-4 py-3 text-rose-800">
          <p className="font-semibold mb-1">⚠ Low supply warning</p>
          <ul className="text-sm space-y-1">
            {lowStockMeds.map((med) => (
              <li key={med.id}>
                <span className="font-medium">{med.name}</span>
                {med.repeatsRemaining !== null && med.repeatsRemaining <= 1 && (
                  <span> — {med.repeatsRemaining} repeat{med.repeatsRemaining === 1 ? '' : 's'} left</span>
                )}
                {med.quantityOnHand !== null && med.quantityOnHand <= 5 && (
                  <span> — {med.quantityOnHand} on hand</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'today' && medications.filter((m) => m.type === 'daily').length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-slate-800">Today</h2>
          <ul className="space-y-2">
            {medications
              .filter((m) => m.type === 'daily')
              .map((med) => {
                const logsForMed = todaysLogs
                  .filter((log) => log.medicationId === med.id)
                  .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());
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
                        {latest.status === 'taken' && 'Taken'}
                        {latest.status === 'skipped' && 'Skipped'}
                        {latest.status === 'snoozed' && 'Snoozed (10m)'}
                      </span>
                    ) : (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => actionDose(med.id, 'taken')}
                          className="text-sm bg-teal-600 text-white rounded-full px-4 py-1.5 font-medium"
                        >
                          Taken
                        </button>
                        <button
                          onClick={() => actionDose(med.id, 'skipped')}
                          className="text-sm bg-stone-400 text-white rounded-full px-4 py-1.5 font-medium"
                        >
                          Skipped
                        </button>
                        <button
                          onClick={() => actionDose(med.id, 'snoozed')}
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
      )}

      {tab === 'manage' && (
        <>
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
                    const lowRepeats = med.repeatsRemaining !== null && med.repeatsRemaining <= 1;
                    const lowQty = med.quantityOnHand !== null && med.quantityOnHand <= 5;
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
                            {section === 'prn' && todaysPrnCounts[med.id] > 0 && (
                              <span className="text-slate-500 text-sm"> — taken {todaysPrnCounts[med.id]}× today</span>
                            )}
                            {med.timeOfDay && (
                              <span className="text-slate-400 text-sm"> · {med.timeOfDay === 'morning' ? 'Morning' : 'Night'}</span>
                            )}
                            {med.notes && <p className="text-sm text-slate-500 mt-1">{med.notes}</p>}
                            {(med.quantityOnHand !== null || med.quantityPerRefill !== null) && (
                              <p className="text-sm text-slate-500">
                                On hand: {med.quantityOnHand ?? '—'} · Per refill: {med.quantityPerRefill ?? '—'}
                              </p>
                            )}
                            {med.repeatsRemaining !== null && (
                              <p className={`text-sm ${lowRepeats ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>
                                {lowRepeats ? '⚠ ' : ''}Repeats remaining: {med.repeatsRemaining}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0 ml-2">
                            {section === 'prn' && (
                              <button
                                onClick={() => actionDose(med.id, 'taken')}
                                className="text-sm text-teal-600 font-medium"
                              >
                                Log dose
                              </button>
                            )}
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