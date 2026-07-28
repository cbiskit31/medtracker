'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

interface AppUser {
  id: number;
  name: string;
  role: 'client' | 'manager' | 'guardian';
  managedByUserId: number | null;
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

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush(userId: number) {
  const registration = await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
  });

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, subscription }),
  });
}

export default function Home() {
  // ----- Who's logged in -----
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'client' | 'manager' | 'guardian'>('client');

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingUserName, setEditingUserName] = useState('');

  const isManager = currentUser?.role === 'manager';
  const canAct = currentUser?.role === 'manager' || currentUser?.role === 'client';
  // The person whose medications we actually show: managers see their own, others see who manages them
  const patientId = currentUser?.role === 'manager' ? currentUser.id : currentUser?.managedByUserId ?? null;

  // ----- Core app state -----
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tab, setTab] = useState<'today' | 'manage' | 'stats'>('today');
  const [medications, setMedications] = useState<Medication[]>([]);
  const [todaysLogs, setTodaysLogs] = useState<DoseLog[]>([]);
  const [allLogs, setAllLogs] = useState<DoseLog[]>([]);
  const [showAddMedication, setShowAddMedication] = useState(false);

  // ----- Load saved login on start -----
  useEffect(() => {
    const saved = localStorage.getItem('currentUserId');
    if (saved) setCurrentUserId(Number(saved));

    fetch('/api/users')
      .then((res) => res.json())
      .then(setAllUsers);
  }, []);

  // ----- Fetch the logged-in user's own record (role, managedByUserId) -----
  useEffect(() => {
    if (!currentUserId) {
      setCurrentUser(null);
      return;
    }
    fetch(`/api/users/${currentUserId}`)
      .then((res) => res.json())
      .then(setCurrentUser);
  }, [currentUserId]);

  // ----- Data fetchers, all keyed on patientId, not currentUserId -----
  const fetchMedications = useCallback(async () => {
    if (!patientId) return;
    const res = await fetch(`/api/medications?userId=${patientId}`);
    const data = await res.json();
    setMedications(data);
  }, [patientId]);

  const fetchTodaysLogs = useCallback(async () => {
    if (!patientId) return;
    const res = await fetch(`/api/doselogs?userId=${patientId}`);
    const data = await res.json();
    setTodaysLogs(data);
  }, [patientId]);

  const fetchAllLogs = useCallback(async () => {
    if (!patientId) return;
    const res = await fetch(`/api/doselogs?userId=${patientId}&all=true`);
    const data = await res.json();
    setAllLogs(data);
  }, [patientId]);

  useEffect(() => {
    fetchMedications();
    fetchTodaysLogs();
    fetchAllLogs();
  }, [fetchMedications, fetchTodaysLogs, fetchAllLogs]);

  const todaysPrnCounts: Record<number, number> = {};
  for (const log of todaysLogs) {
    if (log.status === 'taken') {
      todaysPrnCounts[log.medicationId] = (todaysPrnCounts[log.medicationId] ?? 0) + 1;
    }
  }

  const lowStockMeds = medications.filter(
  (m) => m.quantityOnHand !== null && m.quantityOnHand <= 5
);

const lowRepeatMeds = medications.filter(
  (m) => m.repeatsRemaining !== null && m.repeatsRemaining <= 1
);

  // ----- Stats -----
  function getWeeklyPrnData() {
    const prnIds = new Set(medications.filter((m) => m.type === 'prn').map((m) => m.id));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day);
      nextDay.setDate(day.getDate() + 1);

      const count = allLogs.filter((log) => {
        const scheduled = new Date(log.scheduledFor);
        return log.status === 'taken' && prnIds.has(log.medicationId) && scheduled >= day && scheduled < nextDay;
      }).length;

      days.push({ label: day.toLocaleDateString('en-AU', { weekday: 'short' }), count });
    }
    return days;
  }

  function getMonthlyPrnData() {
    const prnIds = new Set(medications.filter((m) => m.type === 'prn').map((m) => m.id));
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const result = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month, d, 0, 0, 0, 0);
      const nextDay = new Date(year, month, d + 1, 0, 0, 0, 0);

      const count = allLogs.filter((log) => {
        const scheduled = new Date(log.scheduledFor);
        return log.status === 'taken' && prnIds.has(log.medicationId) && scheduled >= day && scheduled < nextDay;
      }).length;

      result.push({ day: d, count });
    }
    return result;
  }

  function heatColor(count: number) {
    if (count === 0) return 'bg-stone-100';
    if (count <= 1) return 'bg-amber-200';
    if (count <= 3) return 'bg-amber-400';
    return 'bg-amber-600';
  }

 // ----- Notifications -----
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted' && currentUser) {
          subscribeToPush(currentUser.id);
        }
      });
    }
  }, [currentUser]);
  

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
      if (!patientId) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;

      const medsRes = await fetch(`/api/medications?userId=${patientId}`);
      const meds: Medication[] = await medsRes.json();
      const logsRes = await fetch(`/api/doselogs?userId=${patientId}`);
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
            { action: 'taken', title: 'Taken' },
            { action: 'skipped', title: 'Skip' },
            { action: 'snoozed', title: 'Snooze' },
          ],
        } as NotificationOptions);

        await fetch('/api/doselogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ medicationId: med.id, scheduledFor: now.toISOString(), status: 'pending' }),
        });

        fetchTodaysLogs();
      }
    };

    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [patientId, fetchTodaysLogs]);

  // ----- Login / user management -----
  function selectUser(id: number) {
    localStorage.setItem('currentUserId', id.toString());
    setCurrentUserId(id);
  }

  function switchUser() {
    localStorage.removeItem('currentUserId');
    setCurrentUserId(null);
    setCurrentUser(null);
  }

 async function addUser() {
    if (!newUserName.trim()) return;
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newUserName.trim(), role: newUserRole, createdByUserId: currentUserId }),
    });
    const created = await res.json();
    setAllUsers((prev) => [...prev, created]);
    setNewUserName('');
  }

  async function saveUserName(userId: number) {
    if (!editingUserName.trim()) return;

    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editingUserName.trim() }),
    });
    const updated = await res.json();

    setAllUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    setEditingUserId(null);
  }

  async function removeUser(id: number, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    setAllUsers((prev) => prev.filter((u) => u.id !== id));
  }

  // ----- Medication CRUD -----
  function updateField(field: keyof typeof emptyForm, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim() || !patientId) return;

    const payload = {
      userId: patientId,
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
    setShowAddMedication(false);
    fetchMedications();
  }

  function startEdit(med: Medication) {
    setShowAddMedication(true);
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
    setShowAddMedication(false);
  }

  async function deleteMedication(id: number) {
    if (!confirm('Delete this medication?')) return;
    const res = await fetch(`/api/medications/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const error = await res.text();
      alert(`Delete failed: ${error}`);
      return;
    }
    if (editingId === id) cancelEdit();
    fetchMedications();
  }

  // ----- Dose actions -----
  async function actionDose(medicationId: number, status: 'taken' | 'skipped' | 'snoozed') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const existing = todaysLogs.find((log) => log.medicationId === medicationId && log.status === 'pending');

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
          body: JSON.stringify({ medicationId, scheduledFor: new Date().toISOString(), status: 'pending' }),
        });
        fetchTodaysLogs();
      }, 10 * 60 * 1000);
    }

    fetchMedications();
    fetchTodaysLogs();
  }

  async function undoDose(medicationId: number) {
    const latestLog = todaysLogs
      .filter((log) => log.medicationId === medicationId)
      .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime())[0];

    if (!latestLog || latestLog.status !== 'taken') return;

    const med = medications.find((m) => m.id === medicationId);
    if (med?.quantityOnHand !== null && med?.quantityOnHand !== undefined) {
      const used = med.doseQuantity ?? 1;
      await fetch(`/api/medications/${medicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...med, quantityOnHand: med.quantityOnHand + used }),
      });
    }

    await fetch(`/api/doselogs/${latestLog.id}`, { method: 'DELETE' });

    fetchMedications();
    fetchTodaysLogs();
    fetchAllLogs();
  }

  // ----- Login screen -----
  if (!currentUserId) {
    return (
      <main className="max-w-md mx-auto p-6 min-h-screen bg-stone-50 flex flex-col justify-center">
        <div className="mb-6 text-center bg-teal-600 rounded-2xl py-5 shadow-sm border-2 border-teal-700">
          <h1 className="text-3xl font-bold text-white tracking-tight">MedTracker</h1>
          <p className="text-teal-100 text-sm mt-1">Who are you?</p>
        </div>

        <ul className="space-y-2 mb-6">
          {allUsers.map((user) => (
            <li key={user.id}>
              <button
                onClick={() => selectUser(user.id)}
                className="w-full text-left bg-white border border-stone-200 rounded-xl px-4 py-3 shadow-sm"
              >
                <span className="font-medium text-slate-800">{user.name}</span>
                <span className="text-sm text-slate-400 ml-2">({user.role})</span>
              </button>
            </li>
          ))}
        </ul>
   {allUsers.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm p-4 border border-stone-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Set up your account</h2>
            <p className="text-xs text-slate-500 mb-3">You'll be the manager — add other people from the Manage screen once you're set up.</p>
            <input
              className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-2 text-slate-800"
              placeholder="Your name"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
            />
            <button
              onClick={async () => {
                setNewUserRole('manager');
                if (!newUserName.trim()) return;
                const res = await fetch('/api/users', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newUserName.trim(), role: 'manager' }),
                });
                const created = await res.json();
                setAllUsers((prev) => [...prev, created]);
                setNewUserName('');
              }}
              className="w-full bg-teal-600 text-white rounded-full px-4 py-2 font-medium"
            >
              Create Manager Account
            </button>
          </div>
        )}
      </main>
    );
  }

  // ----- Main app -----
  return (
    <main className="max-w-md mx-auto p-6 min-h-screen bg-stone-50">
      <div className="mb-6 text-center bg-teal-600 rounded-2xl py-5 shadow-sm border-2 border-teal-700">
        <h1 className="text-3xl font-bold text-white tracking-tight">MedTracker</h1>
        <p className="text-teal-100 text-sm mt-1">Keeping on top of it, together</p>
      </div>
  

      {tab === 'manage' && isManager && (
        <div className="mb-4">
          <button
            onClick={() => setTab('today')}
            className="text-sm font-medium text-slate-700 border border-stone-300 rounded-full px-4 py-2"
          >
            ← Back to Today
          </button>
        </div>
      )}


      {lowStockMeds.length > 0 && (
  <div className="mb-4 border border-rose-300 bg-rose-50 rounded-xl px-4 py-3 text-rose-800">
    <p className="font-semibold mb-1">⚠ Low stock warning</p>
    <ul className="text-sm space-y-1">
      {lowStockMeds.map((med) => (
        <li key={med.id}>
          <span className="font-medium">{med.name}</span> — {med.quantityOnHand} on hand
        </li>
      ))}
    </ul>
  </div>
)}

{lowRepeatMeds.length > 0 && (
  <div className="mb-6 border border-amber-300 bg-amber-50 rounded-xl px-4 py-3 text-amber-800">
    <p className="font-semibold mb-1">⚠ Low script warning</p>
    <ul className="text-sm space-y-1">
      {lowRepeatMeds.map((med) => (
        <li key={med.id}>
          <span className="font-medium">{med.name}</span> — {med.repeatsRemaining} repeat{med.repeatsRemaining === 1 ? '' : 's'} left
        </li>
      ))}
    </ul>
  </div>
)}

      {tab === 'today' && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-slate-800">Today</h2>

          {medications.filter((m) => m.type === 'daily').length === 0 && medications.filter((m) => m.type === 'prn').length === 0 ? (
            <p className="text-sm text-slate-500 mb-4">No medications set up yet.</p>
          ) : (
            <>
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
                              <div className="flex items-center gap-2 mt-2">
                                <span
                                  className={`inline-block text-sm px-3 py-1 rounded-full font-medium ${
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
                                {canAct && latest.status === 'taken' && (
                                  <button
                                    onClick={() => undoDose(med.id)}
                                    className="text-xs text-slate-400 underline"
                                  >
                                    Undo
                                  </button>
                                )}
                              </div>
                            ) : canAct ? (
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
                            ) : null}
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
                            {todaysPrnCounts[med.id] > 0 && (
                              <p className="text-sm text-slate-500">Taken {todaysPrnCounts[med.id]}× today</p>
                            )}
                          </div>
                          {canAct && (
                            <div className="flex items-center gap-2">
                              {todaysPrnCounts[med.id] > 0 && (
                                <button onClick={() => undoDose(med.id)} className="text-xs text-slate-400 underline">
                                  Undo
                                </button>
                              )}
                              <button
                                onClick={() => actionDose(med.id, 'taken')}
                                className="text-sm bg-teal-600 text-white rounded-full px-4 py-1.5 font-medium"
                              >
                                Log dose
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex justify-between items-center mt-8">
            <button
              onClick={switchUser}
              className="text-sm font-medium text-slate-500 border border-stone-300 rounded-full px-4 py-2"
            >
              Switch User
            </button>
            {isManager && (
              <button
                onClick={() => setTab('manage')}
                className="text-sm font-medium text-white bg-slate-600 rounded-full px-5 py-2 shadow-sm"
              >
                Manage
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'manage' && isManager && (
        <>
          <div className="bg-white rounded-xl shadow-sm p-4 border border-stone-200 mb-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">People</h2>
            <ul className="space-y-2">
              {allUsers
                .filter((u) => u.id === currentUserId || u.managedByUserId === currentUserId)
                .map((user) => (
                  <li key={user.id} className="flex justify-between items-center border border-stone-200 rounded-lg px-3 py-2">
                    {editingUserId === user.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          className="flex-1 border border-stone-300 rounded-lg px-2 py-1 text-slate-800"
                          value={editingUserName}
                          onChange={(e) => setEditingUserName(e.target.value)}
                          autoFocus
                        />
                        <button
                          onClick={() => saveUserName(user.id)}
                          className="text-sm text-teal-600 font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingUserId(null)}
                          className="text-sm text-slate-400"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="font-medium text-slate-800">{user.name}</span>
                          <span className="text-sm text-slate-400 ml-2">({user.role})</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              setEditingUserId(user.id);
                              setEditingUserName(user.name);
                            }}
                            className="text-sm text-sky-600 font-medium"
                          >
                            Rename
                          </button>
                          {user.id !== currentUserId && (
                            <button onClick={() => removeUser(user.id, user.name)} className="text-sm text-rose-500 font-medium">
                              Remove
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
            </ul>

            <div className="mt-4 pt-4 border-t border-stone-200">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Add a new person</h3>
              <input
                className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-2 text-slate-800"
                placeholder="Name"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
              />
              <select
                className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-2 text-slate-800"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'client' | 'manager' | 'guardian')}
              >
                <option value="client">Client</option>
                <option value="guardian">Guardian</option>
              </select>
              <button onClick={addUser} className="w-full bg-teal-600 text-white rounded-full px-4 py-2 font-medium">
                Add Person
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center mt-8">
            <button
              onClick={() => setShowAddMedication(!showAddMedication)}
              className="text-sm font-medium text-white bg-emerald-500 rounded-full px-4 py-2"
            >
              {showAddMedication ? 'Cancel' : '+ Add Medication'}
            </button>
            <button
              onClick={() => setTab('stats')}
              className="text-sm font-medium text-white bg-indigo-500 rounded-full px-4 py-2"
            >
              Usage Stats
            </button>
          </div>

          {showAddMedication && (
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
                <button type="submit" className="flex-1 bg-teal-600 text-white rounded-full px-3 py-2 font-medium">
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
          )}

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
                              <span className="text-slate-400 text-sm">
                                {' '}
                                · {med.timeOfDay === 'morning' ? 'Morning' : med.timeOfDay === 'afternoon' ? 'Afternoon' : 'Night'}
                              </span>
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

      {tab === 'stats' && isManager && (
        <>
          <button
            onClick={() => setTab('manage')}
            className="text-sm font-medium text-slate-700 border border-stone-300 rounded-full px-4 py-2 mb-4"
          >
            ← Back to Manage
          </button>
          <div className="bg-white rounded-xl shadow-sm p-4 border border-stone-200 mb-6">
            <h2 className="text-lg font-semibold mb-3 text-slate-800">PRN Usage — Last 7 Days</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={getWeeklyPrnData()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="label" stroke="#78716c" fontSize={12} />
                <YAxis allowDecimals={false} stroke="#78716c" fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4 border border-stone-200 mb-6">
            <h2 className="text-lg font-semibold mb-3 text-slate-800">
              PRN Usage — {new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="grid grid-cols-7 gap-1">
              {getMonthlyPrnData().map(({ day, count }) => (
                <div
                  key={day}
                  className={`aspect-square rounded flex items-center justify-center text-xs font-medium text-slate-700 ${heatColor(count)}`}
                  title={`${count} dose${count === 1 ? '' : 's'}`}
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
              <span>Less</span>
              <div className="w-3 h-3 rounded bg-stone-100" />
              <div className="w-3 h-3 rounded bg-amber-200" />
              <div className="w-3 h-3 rounded bg-amber-400" />
              <div className="w-3 h-3 rounded bg-amber-600" />
              <span>More</span>
            </div>
          </div>
        </>
      )}
    </main>
  );
}