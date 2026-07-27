export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runReminderCheck } = await import('./lib/scheduler');

  setInterval(() => {
    runReminderCheck().catch((err) => console.error('Scheduler error:', err));
  }, 60 * 1000);

  console.log('MedTracker push scheduler started');
}