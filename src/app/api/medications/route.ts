import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const userId = Number(request.nextUrl.searchParams.get('userId'));
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const medications = await prisma.medication.findMany({
    where: { userId },
    include: { doseLogs: true },
  });

  return NextResponse.json(medications);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const medication = await prisma.medication.create({
    data: {
      userId: body.userId,
      name: body.name,
      dose: body.dose,
      doseQuantity: body.doseQuantity ?? 1,
      form: body.form,
      type: body.type,
      timeOfDay: body.timeOfDay,
      reminderTime: body.reminderTime,
      notes: body.notes,
      quantityOnHand: body.quantityOnHand,
      quantityPerRefill: body.quantityPerRefill,
      repeatsRemaining: body.repeatsRemaining,
    },
  });

  return NextResponse.json(medication);
}