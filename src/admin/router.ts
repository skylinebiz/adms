import { Router } from "express";
import { authRouter } from "./auth";
import { companiesRouter } from "./companies";
import { adminUsersRouter } from "./adminUsers";
import { devicesRouter } from "./devices";
import { punchRecordsRouter } from "./punchRecords";
import { rawRequestsRouter } from "./rawRequests";
import { requireAdminAuth } from "../middleware/requireAdminAuth";

// Fully separate namespace + middleware stack from /iclock/*. authRouter
// itself gates /me and /me/password with requireAdminAuth; /login and
// /logout stay public. Every other sub-router is protected as a whole.
export const adminApiRouter = Router();

adminApiRouter.use("/auth", authRouter);
adminApiRouter.use("/companies", requireAdminAuth, companiesRouter);
adminApiRouter.use("/admin-users", requireAdminAuth, adminUsersRouter);
adminApiRouter.use("/devices", requireAdminAuth, devicesRouter);
adminApiRouter.use("/punch-records", requireAdminAuth, punchRecordsRouter);
// rawRequestsRouter applies its own requireSuperAdmin internally, on top of
// requireAdminAuth here.
adminApiRouter.use("/raw-requests", requireAdminAuth, rawRequestsRouter);
