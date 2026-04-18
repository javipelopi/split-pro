import { expect, test as setup } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DATA_FILE, E2E_GROUP_PUBLIC_ID, E2E_USER, type SeededData } from './constants';

setup('seed test data', async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: E2E_USER.email.toLowerCase() },
    });
    expect(user, 'auth setup should have created the e2e user').not.toBeNull();
    const userId = user!.id;

    await prisma.group.deleteMany({ where: { publicId: E2E_GROUP_PUBLIC_ID } });

    const group = await prisma.group.create({
      data: {
        name: 'E2E Smoke Group',
        publicId: E2E_GROUP_PUBLIC_ID,
        userId,
        groupUsers: { create: [{ userId }] },
      },
    });

    const expense = await prisma.expense.create({
      data: {
        name: 'E2E Smoke Expense',
        paidBy: userId,
        addedBy: userId,
        category: 'general',
        amount: 10000n,
        currency: 'USD',
        groupId: group.id,
        expenseParticipants: {
          create: [{ userId, amount: 10000n }],
        },
      },
    });

    mkdirSync(dirname(DATA_FILE), { recursive: true });
    const payload: SeededData = {
      userId,
      groupId: group.id,
      expenseId: expense.id,
    };
    writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
  } finally {
    await prisma.$disconnect();
  }
});
