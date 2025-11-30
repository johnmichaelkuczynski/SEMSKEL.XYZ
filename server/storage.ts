import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { eq, sql, desc, and, inArray } from "drizzle-orm";

// Configure WebSocket for Neon serverless
neonConfig.webSocketConstructor = ws;
import {
  users,
  sentenceEntries,
  authorStyles,
  type User,
  type InsertUser,
  type SentenceEntry,
  type InsertSentenceEntry,
  type AuthorStyle,
  type InsertAuthorStyle,
  type AuthorStyleWithCount,
} from "@shared/schema";

// Create database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

// Storage interface
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Sentence entry operations
  getAllSentenceEntries(): Promise<SentenceEntry[]>;
  getSentenceEntriesPaginated(offset: number, limit: number): Promise<SentenceEntry[]>;
  getSentenceEntriesByUser(userId: number): Promise<SentenceEntry[]>;
  getSentenceEntryCount(): Promise<number>;
  getUserSentenceCount(userId: number): Promise<number>;
  addSentenceEntry(entry: InsertSentenceEntry): Promise<SentenceEntry>;
  addSentenceEntries(entries: InsertSentenceEntry[]): Promise<number>;
  getExistingBleachedTexts(userId: number, bleachedTexts: string[]): Promise<Set<string>>;
  
  // Author style operations
  getAllAuthorStyles(): Promise<AuthorStyleWithCount[]>;
  getAuthorStyle(id: number): Promise<AuthorStyle | undefined>;
  getAuthorStyleByName(name: string): Promise<AuthorStyle | undefined>;
  createAuthorStyle(style: InsertAuthorStyle): Promise<AuthorStyle>;
  getAuthorStyleSentences(authorStyleId: number): Promise<SentenceEntry[]>;
  getAuthorStyleSentenceCount(authorStyleId: number): Promise<number>;
  addSentenceEntriesToAuthorStyle(authorStyleId: number, entries: InsertSentenceEntry[]): Promise<number>;
  getExistingBleachedTextsForAuthor(authorStyleId: number, bleachedTexts: string[]): Promise<Set<string>>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Sentence entry operations
  async getAllSentenceEntries(): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries).orderBy(desc(sentenceEntries.id));
  }

  async getSentenceEntriesPaginated(offset: number, limit: number): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries)
      .orderBy(sentenceEntries.id)
      .offset(offset)
      .limit(limit);
  }

  async getSentenceEntriesByUser(userId: number): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries)
      .where(eq(sentenceEntries.userId, userId))
      .orderBy(desc(sentenceEntries.id));
  }

  async getSentenceEntryCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(sentenceEntries);
    return result[0]?.count || 0;
  }

  async getUserSentenceCount(userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(sentenceEntries)
      .where(eq(sentenceEntries.userId, userId));
    return result[0]?.count || 0;
  }

  async addSentenceEntry(entry: InsertSentenceEntry): Promise<SentenceEntry> {
    const result = await db.insert(sentenceEntries).values(entry).returning();
    return result[0];
  }

  async addSentenceEntries(entries: InsertSentenceEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    
    // Insert in batches of 100 to avoid overwhelming the database
    const BATCH_SIZE = 100;
    let inserted = 0;
    
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await db.insert(sentenceEntries).values(batch);
      inserted += batch.length;
    }
    
    return inserted;
  }

  async getExistingBleachedTexts(userId: number, bleachedTexts: string[]): Promise<Set<string>> {
    if (bleachedTexts.length === 0) return new Set();
    
    // Query for existing entries with matching userId and bleached text
    const existing = await db.select({ bleached: sentenceEntries.bleached })
      .from(sentenceEntries)
      .where(
        and(
          eq(sentenceEntries.userId, userId),
          inArray(sentenceEntries.bleached, bleachedTexts)
        )
      );
    
    return new Set(existing.map(e => e.bleached));
  }

  // Author style operations
  async getAllAuthorStyles(): Promise<AuthorStyleWithCount[]> {
    const styles = await db.select().from(authorStyles).orderBy(authorStyles.name);
    
    // Get sentence counts for each author style
    const result: AuthorStyleWithCount[] = [];
    for (const style of styles) {
      const count = await this.getAuthorStyleSentenceCount(style.id);
      result.push({
        id: style.id,
        name: style.name,
        description: style.description,
        sentenceCount: count,
        createdAt: style.createdAt,
      });
    }
    return result;
  }

  async getAuthorStyle(id: number): Promise<AuthorStyle | undefined> {
    const result = await db.select().from(authorStyles).where(eq(authorStyles.id, id)).limit(1);
    return result[0];
  }

  async getAuthorStyleByName(name: string): Promise<AuthorStyle | undefined> {
    const result = await db.select().from(authorStyles).where(eq(authorStyles.name, name)).limit(1);
    return result[0];
  }

  async createAuthorStyle(style: InsertAuthorStyle): Promise<AuthorStyle> {
    const result = await db.insert(authorStyles).values(style).returning();
    return result[0];
  }

  async getAuthorStyleSentences(authorStyleId: number): Promise<SentenceEntry[]> {
    return await db.select().from(sentenceEntries)
      .where(eq(sentenceEntries.authorStyleId, authorStyleId))
      .orderBy(desc(sentenceEntries.id));
  }

  async getAuthorStyleSentenceCount(authorStyleId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(sentenceEntries)
      .where(eq(sentenceEntries.authorStyleId, authorStyleId));
    return result[0]?.count || 0;
  }

  async addSentenceEntriesToAuthorStyle(authorStyleId: number, entries: InsertSentenceEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    
    // Add authorStyleId to each entry
    const entriesWithAuthor = entries.map(e => ({
      ...e,
      authorStyleId,
    }));
    
    // Insert in batches of 100 to avoid overwhelming the database
    const BATCH_SIZE = 100;
    let inserted = 0;
    
    for (let i = 0; i < entriesWithAuthor.length; i += BATCH_SIZE) {
      const batch = entriesWithAuthor.slice(i, i + BATCH_SIZE);
      await db.insert(sentenceEntries).values(batch);
      inserted += batch.length;
    }
    
    return inserted;
  }

  async getExistingBleachedTextsForAuthor(authorStyleId: number, bleachedTexts: string[]): Promise<Set<string>> {
    if (bleachedTexts.length === 0) return new Set();
    
    // Query for existing entries with matching authorStyleId and bleached text
    const existing = await db.select({ bleached: sentenceEntries.bleached })
      .from(sentenceEntries)
      .where(
        and(
          eq(sentenceEntries.authorStyleId, authorStyleId),
          inArray(sentenceEntries.bleached, bleachedTexts)
        )
      );
    
    return new Set(existing.map(e => e.bleached));
  }
}

export const storage = new DatabaseStorage();
