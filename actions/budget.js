"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

function getMonthRangeUTC(year, month) {
  const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { startOfMonth, endOfMonth };
}

export async function getCurrentBudget(accountId) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const budget = await db.budget.findFirst({
      where: { userId: user.id },
    });

    // Current month
    const now = new Date();
    let { startOfMonth, endOfMonth } = getMonthRangeUTC(
      now.getUTCFullYear(),
      now.getUTCMonth()
    );

    // Check if current month has any expenses
    const currentMonthExpenses = await db.transaction.aggregate({
      where: {
        userId: user.id,
        type: "EXPENSE",
        accountId,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    });

    let expenses = currentMonthExpenses;

    // If no expenses found this month, fallback to latest transaction month
    if (!expenses._sum.amount) {
      const latestTx = await db.transaction.findFirst({
        where: { userId: user.id, type: "EXPENSE" },
        orderBy: { date: "desc" },
      });

      if (latestTx) {
        const txDate = new Date(latestTx.date);
        ({ startOfMonth, endOfMonth } = getMonthRangeUTC(
          txDate.getUTCFullYear(),
          txDate.getUTCMonth()
        ));

        expenses = await db.transaction.aggregate({
          where: {
            userId: user.id,
            type: "EXPENSE",
            accountId,
            date: { gte: startOfMonth, lte: endOfMonth },
          },
          _sum: { amount: true },
        });
      }
    }

    return {
      budget: budget
        ? { ...budget, amount: budget.amount.toNumber() }
        : null,
      currentExpenses: expenses._sum.amount
        ? expenses._sum.amount.toNumber()
        : 0,
    };
  } catch (error) {
    console.error("Error fetching budget:", error);
    throw error;
  }
}

export async function updateBudget(amount) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const budget = await db.budget.upsert({
      where: { userId: user.id },
      update: { amount },
      create: { userId: user.id, amount },
    });

    revalidatePath("/dashboard");

    return {
      success: true,
      data: { ...budget, amount: budget.amount.toNumber() },
    };
  } catch (error) {
    console.error("Error updating budget:", error);
    return { success: false, error: error.message };
  }
}
