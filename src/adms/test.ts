import { Request, Response } from "express";

// GET|POST /iclock/test - connectivity test.
export function handleTest(_req: Request, res: Response) {
  res.status(200).type("text/plain; charset=UTF-8").send("OK");
}
