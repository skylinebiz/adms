import "express";

declare global {
  namespace Express {
    interface Request {
      adminUser?: {
        id: string;
        email: string;
        role: "SUPER_ADMIN" | "COMPANY_ADMIN";
        companyId: string | null;
      };
    }
  }
}

export {};
