import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function GET(request: NextRequest) {
  const userId = Number(request.nextUrl.searchParams.get('userId'));
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const logs = await prisma.doseLog.findMany({
    where: {
      scheduledFor: { gte: startOfToday },
      medication: { userId },
    },
  });

  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const log = await prisma.doseLog.create({
    data: {
      medicationId: body.medicationId,
      scheduledFor: new Date(body.scheduledFor),
      status: body.status,
      actionedAt: body.actionedAt ? new Date(body.actionedAt) : null,
    },
  });

  return NextResponse.json(log);
}