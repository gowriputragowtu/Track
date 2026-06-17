import { Router } from "express";
import { db, transactionsTable, stocksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

// GET /api/summary
router.get("/summary", async (req, res) => {
  try {
    const transactions = await db.select().from(transactionsTable);
    const stocks = await db.select().from(stocksTable);

    let cashBalance = 0;
    let bankBalance = 0;
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const t of transactions) {
      const amount = Number(t.amount);
      if (t.type === "income") {
        totalIncome += amount;
        if (t.account === "cash") cashBalance += amount;
        else bankBalance += amount;
      } else {
        totalExpenses += amount;
        if (t.account === "cash") cashBalance -= amount;
        else bankBalance -= amount;
      }
    }

    const totalStockValue = stocks.reduce((sum, s) => sum + Number(s.estimatedValue), 0);

    res.json({
      cashBalance: Math.max(0, cashBalance),
      bankBalance: Math.max(0, bankBalance),
      totalStockValue,
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/summary/expenses-by-category
router.get("/summary/expenses-by-category", async (req, res) => {
  try {
    const result = await db
      .select({
        category: transactionsTable.category,
        total: sql<string>`sum(${transactionsTable.amount})`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.type, "expense"))
      .groupBy(transactionsTable.category);

    const breakdown = result.map((r) => ({
      category: r.category ?? "other",
      total: Number(r.total ?? 0),
      count: r.count,
    }));

    res.json(breakdown);
  } catch (err) {
    req.log.error({ err }, "Failed to get expenses by category");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/summary/monthly-trend
router.get("/summary/monthly-trend", async (req, res) => {
  try {
    const transactions = await db.select().from(transactionsTable);

    // Build a map of YYYY-MM → { income, expenses }
    const map: Record<string, { income: number; expenses: number }> = {};

    for (const t of transactions) {
      const month = t.date.slice(0, 7); // "YYYY-MM"
      if (!map[month]) map[month] = { income: 0, expenses: 0 };
      const amount = Number(t.amount);
      if (t.type === "income") map[month].income += amount;
      else map[month].expenses += amount;
    }

    // Build last 6 calendar months (including current)
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push(key);
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const result = months.map((month) => {
      const [year, mon] = month.split("-");
      const label = `${monthNames[parseInt(mon, 10) - 1]} ${year!.slice(2)}`;
      return {
        month,
        label,
        income: map[month]?.income ?? 0,
        expenses: map[month]?.expenses ?? 0,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get monthly trend");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
