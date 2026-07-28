import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const userId = Number(request.nextUrl.searchParams.get('userId'));
  const all = request.nextUrl.searchParams.get('all') === 'true';

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const where: any = {
    medication: { userId },
  };

  if (!all) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    where.scheduledFor = { gte: startOfToday };
  }

  const logs = await prisma.doseLog.findMany({ where });

  return NextResponse.json(logs);
}


export async function POST(request: NextRequest) {
  const body = await request.json();

  const log = await prisma.doseLog.create({
    data: {
      medicationId: body.medicationId,
      scheduledFor: body.scheduledFor
        ? new Date(body.scheduledFor)
        : new Date(),
      status: body.status,
      actionedAt: body.actionedAt
        ? new Date(body.actionedAt)
        : undefined,
    },
  });

  return NextResponse.json(log);
}