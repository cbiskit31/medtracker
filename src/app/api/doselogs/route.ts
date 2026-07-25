import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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