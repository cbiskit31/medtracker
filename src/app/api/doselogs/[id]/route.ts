import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const log = await prisma.doseLog.update({
    where: { id: Number(id) },
    data: {
      status: body.status,
      actionedAt: body.actionedAt ? new Date(body.actionedAt) : new Date(),
    },
  });

  return NextResponse.json(log);
}