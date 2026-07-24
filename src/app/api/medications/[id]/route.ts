import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const medication = await prisma.medication.update({
    where: { id: Number(id) },
    data: {
      name: body.name,
      dose: body.dose,
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.medication.delete({ where: { id: Number(id) } });
  return NextResponse.json({ success: true });
}