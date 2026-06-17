import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transactionsRouter from "./transactions";
import stocksRouter from "./stocks";
import summaryRouter from "./summary";
import godownSalesRouter from "./godownSales";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transactionsRouter);
router.use(stocksRouter);
router.use(summaryRouter);
router.use(godownSalesRouter);

export default router;
