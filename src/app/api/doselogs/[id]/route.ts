import { prisma } from '@/lib/prisma';

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.doseLog.delete({
    where: { id: Number(id) },
  });

  return NextResponse.json({ success: true });
}



