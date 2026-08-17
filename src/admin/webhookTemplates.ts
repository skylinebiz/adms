import { Router } from "express";
import { WEBHOOK_TEMPLATES } from "../webhooks/templates";

export const webhookTemplatesRouter = Router();

// Static, hardcoded list - no company scoping, no params. Any
// authenticated admin can see every available template.
webhookTemplatesRouter.get("/", (_req, res) => {
  res.json({ templates: WEBHOOK_TEMPLATES });
});
