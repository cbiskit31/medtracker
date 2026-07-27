import { prisma } from './prisma';
import { sendPushToSubscription } from './push';

const MISSED_DOSE_ALERT_MINUTES = 30;

export async function runReminderCheck() {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // ----- 1. Fire due daily reminders -----
  const dueMeds = await prisma.medication.findMany({
    where: { type: 'daily', reminderTime: currentTime },
  });

  for (const med of dueMeds) {
    const alreadyLogged = await prisma.doseLog.findFirst({
      where: { medicationId: med.id, scheduledFor: { gte: startOfToday } },
    });
    if (alreadyLogged) continue;

    await prisma.doseLog.create({
      data: { medicationId: med.id, scheduledFor: now, status: 'pending' },
    });

    const subs = await prisma.pushSubscription.findMany({ where: { userId: med.userId } });
    for (const sub of subs) {
      await sendPushToSubscription(sub, {
        title: `Time for ${med.name}`,
        body: med.dose ? `${med.dose}${med.notes ? ' — ' + med.notes : ''}` : 'Reminder',
        tag: `med-${med.id}-${currentTime}`,
        medicationId: med.id,
      });
    }
  }

  // ----- 2. Alert managers about missed doses -----
  const cutoff = new Date(now.getTime() - MISSED_DOSE_ALERT_MINUTES * 60 * 1000);

  const overdueLogs = await prisma.doseLog.findMany({
    where: { status: 'pending', scheduledFor: { lte: cutoff, gte: startOfToday } },
    include: { medication: true },
  });

  for (const log of overdueLogs) {
    const patient = await prisma.user.findUnique({ where: { id: log.medication.userId } });
    if (!patient) continue;

    // Find managers linked to this patient: the patient themself if they are the manager,
    // or whoever manages them
    const managerId = patient.role === 'manager' ? patient.id : patient.managedByUserId;
    if (!managerId) continue;

    const managerSubs = await prisma.pushSubscription.findMany({ where: { userId: managerId } });
    for (const sub of managerSubs) {
      await sendPushToSubscription(sub, {
        title: `Missed dose: ${log.medication.name}`,
        body: `${patient.name} hasn't logged this dose yet`,
        tag: `missed-${log.id}`,
      });
    }
  }
}