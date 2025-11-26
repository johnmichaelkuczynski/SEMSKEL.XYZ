import type { Express } from "express";
import { createServer, type Server } from "http";
import { bleachText } from "./bleach";
import { bleachRequestSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Bleaching API endpoint
  app.post("/api/bleach", async (req, res) => {
    try {
      // Validate request body
      const validatedData = bleachRequestSchema.parse(req.body);

      // Check text length
      if (validatedData.text.length > 50000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 50,000 characters or less.",
        });
      }

      // Perform bleaching
      const bleachedText = await bleachText(
        validatedData.text,
        validatedData.level
      );

      // Return result
      res.json({
        bleachedText,
        originalFilename: validatedData.filename,
      });
    } catch (error) {
      console.error("Bleaching API error:", error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }

      res.status(500).json({
        error: "Bleaching failed",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
