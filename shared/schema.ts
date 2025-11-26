import { z } from "zod";

// Bleaching level options
export const bleachingLevels = ["Light", "Moderate", "Heavy", "Very Heavy"] as const;
export type BleachingLevel = typeof bleachingLevels[number];

// Request schema for bleaching API
export const bleachRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels),
  filename: z.string().optional(),
});

export type BleachRequest = z.infer<typeof bleachRequestSchema>;

// Response schema for bleaching API
export const bleachResponseSchema = z.object({
  bleachedText: z.string(),
  originalFilename: z.string().optional(),
});

export type BleachResponse = z.infer<typeof bleachResponseSchema>;
