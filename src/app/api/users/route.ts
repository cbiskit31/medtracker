import { prisma } from '@/lib/prisma';

export async function GET() {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      name: body.name,
      role: body.role,
      managedByUserId: body.role !== 'manager' ? body.createdByUserId : null,
    },
  });
  return NextResponse.json(user);
}