import { Router } from "express";
import { db, stocksTable, transactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

function toDateStr(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}
import {
  CreateStockBody,
  UpdateStockBody,
  UpdateStockParams,
  DeleteStockParams,
  SellStockBody,
  SellStockParams,
} from "@workspace/api-zod";

const router = Router();

// GET /api/stocks
router.get("/stocks", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(stocksTable)
      .orderBy(desc(stocksTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        estimatedValue: Number(r.estimatedValue),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list stocks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/stocks
router.post("/stocks", async (req, res) => {
  try {
    const parsed = CreateStockBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const data = parsed.data;
    const [row] = await db
      .insert(stocksTable)
      .values({
        cropName: data.cropName,
        quantity: String(data.quantity),
        unit: data.unit,
        estimatedValue: String(data.estimatedValue),
        notes: data.notes ?? null,
      })
      .returning();
    res.status(201).json({
      ...row,
      quantity: Number(row.quantity),
      estimatedValue: Number(row.estimatedValue),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create stock");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/stocks/:id
router.patch("/stocks/:id", async (req, res) => {
  try {
    const paramsParsed = UpdateStockParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const bodyParsed = UpdateStockBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updates: Record<string, unknown> = {};
    const body = bodyParsed.data;
    if (body.cropName !== undefined) updates.crop_name = body.cropName;
    if (body.quantity !== undefined) updates.quantity = String(body.quantity);
    if (body.unit !== undefined) updates.unit = body.unit;
    if (body.estimatedValue !== undefined) updates.estimated_value = String(body.estimatedValue);
    if (body.notes !== undefined) updates.notes = body.notes;

    const [row] = await db
      .update(stocksTable)
      .set(updates)
      .where(eq(stocksTable.id, paramsParsed.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...row,
      quantity: Number(row.quantity),
      estimatedValue: Number(row.estimatedValue),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update stock");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/stocks/:id/sell
router.post("/stocks/:id/sell", async (req, res) => {
  try {
    const paramsParsed = SellStockParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const bodyParsed = SellStockBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
      return;
    }

    const stockId = paramsParsed.data.id;
    const body = bodyParsed.data;

    // Fetch the stock
    const [stock] = await db.select().from(stocksTable).where(eq(stocksTable.id, stockId));
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }

    const currentQty = Number(stock.quantity);
    const soldQty = body.saleType === "full" ? currentQty : body.quantity;

    if (soldQty <= 0) {
      res.status(400).json({ error: "Quantity must be greater than zero" });
      return;
    }
    if (soldQty > currentQty) {
      res.status(400).json({ error: `Cannot sell ${soldQty} — only ${currentQty} in stock` });
      return;
    }

    const totalAmount = soldQty * body.sellingPricePerUnit;
    const description = body.description?.trim() ||
      `Sale of ${stock.cropName} — ${soldQty} ${stock.unit} @ ₹${body.sellingPricePerUnit}/${stock.unit}`;

    // Create the income transaction
    const [newTx] = await db
      .insert(transactionsTable)
      .values({
        type: "income",
        amount: String(totalAmount),
        description,
        date: toDateStr(body.date),
        account: body.account,
        category: "godown_sale",
      })
      .returning();

    const remainingQty = currentQty - soldQty;

    // Update or delete the stock
    let updatedStock: typeof stock | null = null;
    if (remainingQty <= 0) {
      await db.delete(stocksTable).where(eq(stocksTable.id, stockId));
    } else {
      // Recalculate estimated value proportionally
      const newValue = (Number(stock.estimatedValue) / currentQty) * remainingQty;
      const [updated] = await db
        .update(stocksTable)
        .set({ quantity: String(remainingQty), estimatedValue: String(newValue) })
        .where(eq(stocksTable.id, stockId))
        .returning();
      updatedStock = updated ?? null;
    }

    res.json({
      stock: updatedStock
        ? {
            ...updatedStock,
            quantity: Number(updatedStock.quantity),
            estimatedValue: Number(updatedStock.estimatedValue),
            createdAt: updatedStock.createdAt.toISOString(),
          }
        : null,
      transaction: {
        ...newTx,
        amount: Number(newTx.amount),
        createdAt: newTx.createdAt.toISOString(),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to sell stock");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/stocks/:id
router.delete("/stocks/:id", async (req, res) => {
  try {
    const parsed = DeleteStockParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const deleted = await db
      .delete(stocksTable)
      .where(eq(stocksTable.id, parsed.data.id))
      .returning();
    if (!deleted.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete stock");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
