import { Router } from "express";
import { db, transactionsTable } from "@workspace/db";
import { eq, and, gte, lte, like, desc } from "drizzle-orm";
import { ListGodownSalesQueryParams } from "@workspace/api-zod";

const router = Router();

// GET /api/godown-sales
router.get("/godown-sales", async (req, res) => {
  try {
    const parsed = ListGodownSalesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }
    const { from, to, search } = parsed.data;

    const conditions = [
      eq(transactionsTable.type, "income"),
      eq(transactionsTable.category, "godown_sale"),
    ];

    if (from) {
      const fromStr = from instanceof Date ? from.toISOString().slice(0, 10) : String(from);
      conditions.push(gte(transactionsTable.date, fromStr));
    }
    if (to) {
      const toStr = to instanceof Date ? to.toISOString().slice(0, 10) : String(to);
      conditions.push(lte(transactionsTable.date, toStr));
    }
    if (search) {
      conditions.push(like(transactionsTable.description, `%${search}%`));
    }

    const rows = await db
      .select()
      .from(transactionsTable)
      .where(and(...conditions))
      .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt));

    const sales = rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      createdAt: r.createdAt.toISOString(),
    }));

    const totalEarned = sales.reduce((sum, s) => sum + s.amount, 0);

    res.json({ sales, totalEarned, count: sales.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list godown sales");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
