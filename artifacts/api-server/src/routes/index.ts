import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import societyRouter from "./society";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(societyRouter);

export default router;
