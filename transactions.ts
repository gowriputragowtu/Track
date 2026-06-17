import { Router } from "express";
import { db, transactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

function toDateStr(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}
import {
  CreateTransactionBody,
  UpdateTransactionBody,
  GetTransactionParams,
  UpdateTransactionParams,
  DeleteTransactionParams,
  ListTransactionsQueryParams,
} from "@workspace/api-zod";

const router = Router();

// GET /api/transactions
router.get("/transactions", async (req, res) => {
  try {
    const parsed = ListTransactionsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }
    const { type, category, account, limit } = parsed.data;

    let query = db.select().from(transactionsTable).$dynamic();

    if (type) {
      query = query.where(eq(transactionsTable.type, type));
    }

    const rows = await db
      .select()
      .from(transactionsTable)
      .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt))
      .limit(limit ?? 100);

    const filtered = rows
      .filter((r) => !type || r.type === type)
      .filter((r) => !category || r.category === category)
      .filter((r) => !account || r.account === account);

    res.json(
      filtered.map((r) => ({
        ...r,
        amount: Number(r.amount),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list transactions");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/transactions
router.post("/transactions", async (req, res) => {
  try {
    const parsed = CreateTransactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const data = parsed.data;
    const [row] = await db
      .insert(transactionsTable)
      .values({
        type: data.type,
        description: data.description,
        amount: String(data.amount),
        date: toDateStr(data.date),
        account: data.account,
        category: data.category ?? null,
      })
      .returning();
    res.status(201).json({
      ...row,
      amount: Number(row.amount),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/transactions/:id
router.get("/transactions/:id", async (req, res) => {
  try {
    const parsed = GetTransactionParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.id, parsed.data.id));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to get transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/transactions/:id
router.patch("/transactions/:id", async (req, res) => {
  try {
    const paramsParsed = UpdateTransactionParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const bodyParsed = UpdateTransactionBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updates: Record<string, unknown> = {};
    const body = bodyParsed.data;
    if (body.description !== undefined) updates.description = body.description;
    if (body.amount !== undefined) updates.amount = String(body.amount);
    if (body.date !== undefined) updates.date = toDateStr(body.date);
    if (body.account !== undefined) updates.account = body.account;
    if (body.category !== undefined) updates.category = body.category;

    const [row] = await db
      .update(transactionsTable)
      .set(updates)
      .where(eq(transactionsTable.id, paramsParsed.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to update transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/transactions/:id
router.delete("/transactions/:id", async (req, res) => {
  try {
    const parsed = DeleteTransactionParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const deleted = await db
      .delete(transactionsTable)
      .where(eq(transactionsTable.id, parsed.data.id))
      .returning();
    if (!deleted.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
