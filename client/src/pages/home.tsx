import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  ArrowUpTrayIcon, 
  ClipboardDocumentIcon, 
  ArrowDownTrayIcon, 
  XMarkIcon,
  SparklesIcon,
  DocumentTextIcon,
  CircleStackIcon,
  EyeIcon,
  UserIcon,
  ArrowRightStartOnRectangleIcon
} from "@heroicons/react/24/outline";
import type { BleachingLevel, BleachResponse, SentenceBankResponse, MatchResponse, MatchResult, HumanizeResponse, HumanizedSentence, GPTZeroResponse, RewriteStyleResponse, RewrittenSentence, ContentSimilarityResponse, AuthorStyleWithCount, ChunkMetadata, ChunkPreviewResponse } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheckIcon } from "@heroicons/react/24/solid";

interface LoggedInUser {
  id: number;
  username: string;
  createdAt: string;
}

interface BankEntry {
  original: string;
  bleached: string;
  char_length: number;
  token_length: number;
  clause_count: number;
  clause_order: string;
  punctuation_pattern: string;
  structure: string;
}

type OutputMode = "bleach" | "jsonl";

// Helper: calculate word count
function getWordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// Helper: calculate estimated chunks (2000 words per chunk)
function getEstimatedChunks(wordCount: number): number {
  return Math.ceil(wordCount / 2000);
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [bleachingLevel, setBleachingLevel] = useState<BleachingLevel>("Heavy");
  const [uploadedFile, setUploadedFile] = useState<{ name: string } | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>("bleach");
  const [jsonlContent, setJsonlContent] = useState<string | null>(null);
  const [sentenceCount, setSentenceCount] = useState<number>(0);
  const [totalBankSize, setTotalBankSize] = useState<number>(0);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [aiTextInput, setAiTextInput] = useState("");
  const [aiUploadedFile, setAiUploadedFile] = useState<{ name: string } | null>(null);
  const [matchResults, setMatchResults] = useState<MatchResult[] | null>(null);
  const [matchStats, setMatchStats] = useState<{ total: number; matched: number } | null>(null);
  const [humanizeResults, setHumanizeResults] = useState<HumanizedSentence[] | null>(null);
  const [humanizeStats, setHumanizeStats] = useState<{ total: number; successful: number } | null>(null);
  const [currentUser, setCurrentUser] = useState<LoggedInUser | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadJsonlContent, setUploadJsonlContent] = useState("");
  const [aiDetectionResult, setAiDetectionResult] = useState<GPTZeroResponse | null>(null);
  const [humanizeContentSimilarityResult, setHumanizeContentSimilarityResult] = useState<ContentSimilarityResponse | null>(null);
  
  // Style Transfer state
  const [styleTargetText, setStyleTargetText] = useState("");
  const [styleSampleText, setStyleSampleText] = useState("");
  const [styleTargetFile, setStyleTargetFile] = useState<{ name: string } | null>(null);
  const [styleSampleFile, setStyleSampleFile] = useState<{ name: string } | null>(null);
  const [styleRewriteResults, setStyleRewriteResults] = useState<RewrittenSentence[] | null>(null);
  const [styleRewriteStats, setStyleRewriteStats] = useState<{ total: number; successful: number; patternsExtracted: number } | null>(null);
  const [styleAiDetectionResult, setStyleAiDetectionResult] = useState<GPTZeroResponse | null>(null);
  const [contentSimilarityResult, setContentSimilarityResult] = useState<ContentSimilarityResponse | null>(null);
  
  // Author Style state (for Style Transfer)
  const [selectedAuthorStyleId, setSelectedAuthorStyleId] = useState<number | null>(null);
  
  // Chunk Selection state
  const [chunks, setChunks] = useState<ChunkMetadata[]>([]);
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<number>>(new Set());
  const [showChunkSelection, setShowChunkSelection] = useState(false);
  
  // Bank download state
  const [downloadingInstallment, setDownloadingInstallment] = useState<number | null>(null);
  
  const { toast } = useToast();
  
  // Calculate word count and estimated chunks for the input text
  const inputWordCount = getWordCount(inputText);
  const estimatedChunks = getEstimatedChunks(inputWordCount);
  const isLargeText = inputWordCount > 2000;

  // Load user from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("semantic_bleacher_user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("semantic_bleacher_user");
      }
    }
  }, []);

  // Fetch sentence bank status
  const bankStatusQuery = useQuery<{ count: number }>({
    queryKey: ["/api/sentence-bank/status"],
  });

  // Fetch full bank when dialog opens
  const bankContentQuery = useQuery<{ entries: BankEntry[]; count: number }>({
    queryKey: ["/api/sentence-bank"],
    enabled: bankDialogOpen,
  });
  
  // Fetch author styles for dropdown
  const authorStylesQuery = useQuery<AuthorStyleWithCount[]>({
    queryKey: ["/api/author-styles"],
  });

  useEffect(() => {
    if (bankStatusQuery.data) {
      setTotalBankSize(bankStatusQuery.data.count);
    }
  }, [bankStatusQuery.data]);
  
  // Reset chunk selection when input text changes significantly
  useEffect(() => {
    setChunks([]);
    setSelectedChunkIds(new Set());
    setShowChunkSelection(false);
  }, [inputText]);

  // Clear similarity result when style texts change
  useEffect(() => {
    setContentSimilarityResult(null);
  }, [styleTargetText, styleSampleText]);

  // Clear humanize similarity result when AI text changes or new results come in
  useEffect(() => {
    setHumanizeContentSimilarityResult(null);
  }, [aiTextInput, humanizeResults]);

  // Bleaching mutation
  const bleachMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel; filename?: string }) => {
      const response = await apiRequest("POST", "/api/bleach", data);
      return await response.json() as BleachResponse & { chunksProcessed?: number; totalChunks?: number; failedChunks?: number[] };
    },
    onSuccess: (data) => {
      setOutputText(data.bleachedText);
      const chunkInfo = data.totalChunks && data.totalChunks > 1 
        ? ` (processed ${data.chunksProcessed}/${data.totalChunks} chunks)` 
        : "";
      
      if (data.failedChunks && data.failedChunks.length > 0) {
        toast({
          title: "Text partially bleached",
          description: `${data.failedChunks.length} chunk(s) failed, but processed the rest${chunkInfo}.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Text bleached successfully",
          description: `Applied ${bleachingLevel} bleaching to your text${chunkInfo}.`,
        });
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while bleaching the text. Please try again.";
      toast({
        title: "Bleaching failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Sentence bank mutation
  const sentenceBankMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel }) => {
      const response = await apiRequest("POST", "/api/build-sentence-bank", data);
      return await response.json() as SentenceBankResponse & { chunksProcessed?: number; totalChunks?: number };
    },
    onSuccess: (data) => {
      setJsonlContent(data.jsonlContent);
      setSentenceCount(data.sentenceCount);
      if (data.totalBankSize) {
        setTotalBankSize(data.totalBankSize);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sentence-bank/status"] });
      const chunkInfo = data.totalChunks && data.totalChunks > 1 
        ? ` from ${data.totalChunks} chunks` 
        : "";
      toast({
        title: "Saved to sentence bank",
        description: `Added ${data.sentenceCount} sentences${chunkInfo}. Bank now has ${data.totalBankSize || data.sentenceCount} total entries.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while building the sentence bank.";
      toast({
        title: "JSONL generation failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Chunk preview mutation - fetches chunk metadata for selection
  const chunkPreviewMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/chunk-preview", { text, chunkSize: 2000 });
      return await response.json() as ChunkPreviewResponse;
    },
    onSuccess: (data) => {
      setChunks(data.chunks);
      // Select all chunks by default
      setSelectedChunkIds(new Set(data.chunks.map(c => c.id)));
      setShowChunkSelection(true);
      
      if (!data.needsChunking) {
        toast({
          title: "Text loaded",
          description: `${data.totalWords.toLocaleString()} words, ${data.totalSentences} sentences - no chunking needed.`,
        });
      } else {
        toast({
          title: "Text divided into chunks",
          description: `${data.chunks.length} chunks created from ${data.totalWords.toLocaleString()} words. Select which chunks to process.`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to preview chunks",
        description: error?.message || "Could not divide text into chunks.",
        variant: "destructive",
      });
    },
  });

  // Bleach selected chunks mutation
  const bleachChunksMutation = useMutation({
    mutationFn: async (data: { chunks: { id: number; text: string }[]; level: BleachingLevel }) => {
      const response = await apiRequest("POST", "/api/bleach-chunks", data);
      return await response.json() as { bleachedText: string; chunksProcessed: number; totalChunks: number; failedChunks?: number[] };
    },
    onSuccess: (data) => {
      setOutputText(data.bleachedText);
      if (data.failedChunks && data.failedChunks.length > 0) {
        toast({
          title: "Text partially bleached",
          description: `Processed ${data.chunksProcessed} of ${data.totalChunks} chunks. ${data.failedChunks.length} chunk(s) failed.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Text bleached successfully",
          description: `Processed ${data.chunksProcessed} of ${data.totalChunks} chunks.`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Bleaching failed",
        description: error?.message || "An error occurred. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Build sentence bank from selected chunks mutation
  const sentenceBankChunksMutation = useMutation({
    mutationFn: async (data: { chunks: { id: number; text: string }[]; level: BleachingLevel; userId?: number }) => {
      const response = await apiRequest("POST", "/api/build-sentence-bank-chunks", data);
      return await response.json() as { jsonl: string; entries: number; chunksProcessed: number; savedToBank: number; failedSentences?: number };
    },
    onSuccess: (data) => {
      setJsonlContent(data.jsonl);
      setSentenceCount(data.entries);
      queryClient.invalidateQueries({ queryKey: ["/api/sentence-bank/status"] });
      if (data.failedSentences && data.failedSentences > 0) {
        toast({
          title: "Sentence bank partially built",
          description: `Added ${data.entries} sentences from ${data.chunksProcessed} chunks. ${data.failedSentences} sentence(s) failed.${data.savedToBank > 0 ? ` Saved ${data.savedToBank} to your bank.` : ""}`,
          variant: "default",
        });
      } else {
        toast({
          title: "Saved to sentence bank",
          description: `Added ${data.entries} sentences from ${data.chunksProcessed} chunks.${data.savedToBank > 0 ? ` Saved ${data.savedToBank} to your bank.` : ""}`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "JSONL generation failed",
        description: error?.message || "An error occurred. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Match mutation (Step 2 - find human patterns for AI text)
  const matchMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel }) => {
      const response = await apiRequest("POST", "/api/match", data);
      return await response.json() as MatchResponse;
    },
    onSuccess: (data) => {
      setMatchResults(data.matches);
      setMatchStats({ total: data.totalSentences, matched: data.matchedCount });
      toast({
        title: "Matching complete",
        description: `Found patterns for ${data.matchedCount} of ${data.totalSentences} sentences.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while matching.";
      toast({
        title: "Matching failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Humanize mutation (Step 3 - rewrite AI text using human patterns)
  const humanizeMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel }) => {
      const response = await apiRequest("POST", "/api/humanize", data);
      return await response.json() as HumanizeResponse;
    },
    onSuccess: (data) => {
      setHumanizeResults(data.sentences);
      setHumanizeStats({ total: data.totalSentences, successful: data.successfulRewrites });
      toast({
        title: "Humanization complete",
        description: `Rewrote ${data.successfulRewrites} of ${data.totalSentences} sentences.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while humanizing.";
      toast({
        title: "Humanization failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // AI Detection mutation (GPTZero)
  const aiDetectMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/detect-ai", { text });
      return await response.json() as GPTZeroResponse;
    },
    onSuccess: (data) => {
      setAiDetectionResult(data);
      const classification = data.documentClassification;
      const prob = Math.round(data.completelyGeneratedProb * 100);
      toast({
        title: `Detection: ${classification.replace("_", " ")}`,
        description: `${prob}% AI probability (${data.confidenceCategory} confidence)`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "AI detection failed.";
      toast({
        title: "Detection failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (username: string) => {
      const response = await apiRequest("POST", "/api/login", { username });
      return await response.json() as LoggedInUser;
    },
    onSuccess: (data) => {
      setCurrentUser(data);
      localStorage.setItem("semantic_bleacher_user", JSON.stringify(data));
      setUsernameInput("");
      toast({
        title: `Welcome, ${data.username}!`,
        description: "You can now upload your own sentence bank files.",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Login failed.";
      toast({
        title: "Login failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Upload JSONL mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: { jsonlContent: string; userId?: number }) => {
      const response = await apiRequest("POST", "/api/sentence-bank/upload", data);
      return await response.json() as { uploadedCount: number; totalBankSize: number };
    },
    onSuccess: (data) => {
      setTotalBankSize(data.totalBankSize);
      setUploadJsonlContent("");
      setUploadDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sentence-bank/status"] });
      toast({
        title: "Upload successful",
        description: `Added ${data.uploadedCount} patterns. Bank now has ${data.totalBankSize} total.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Upload failed.";
      toast({
        title: "Upload failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Style Transfer mutation
  const styleRewriteMutation = useMutation({
    mutationFn: async (data: { targetText: string; styleSample?: string; level: BleachingLevel; userId?: number; authorStyleId?: number }) => {
      const response = await apiRequest("POST", "/api/rewrite-style", data);
      return await response.json() as RewriteStyleResponse;
    },
    onSuccess: (data) => {
      setStyleRewriteResults(data.sentences);
      setStyleRewriteStats({
        total: data.totalSentences,
        successful: data.successfulRewrites,
        patternsExtracted: data.stylePatternsExtracted,
      });
      // Clear previous analysis results when a new rewrite is done
      setStyleAiDetectionResult(null);
      setContentSimilarityResult(null);
      
      // Show different message if patterns were saved
      const savedInfo = data.patternsSavedToBank && data.patternsSavedToBank > 0
        ? ` Saved ${data.patternsSavedToBank} patterns to your bank.`
        : "";
      
      toast({
        title: "Style transfer complete",
        description: `Rewrote ${data.successfulRewrites} of ${data.totalSentences} sentences using ${data.stylePatternsExtracted} extracted patterns.${savedInfo}`,
      });
      
      // Invalidate bank status if patterns were saved
      if (data.patternsSavedToBank && data.patternsSavedToBank > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/sentence-bank/status"] });
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Style transfer failed.";
      toast({
        title: "Style transfer failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Style Transfer AI Detection mutation (GPTZero)
  const styleAiDetectMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/detect-ai", { text });
      return await response.json() as GPTZeroResponse;
    },
    onSuccess: (data) => {
      setStyleAiDetectionResult(data);
      const classification = data.documentClassification;
      const prob = Math.round(data.completelyGeneratedProb * 100);
      toast({
        title: `Detection: ${classification.replace("_", " ")}`,
        description: `${prob}% AI probability (${data.confidenceCategory} confidence)`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "AI detection failed.";
      toast({
        title: "Detection failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Content Similarity mutation (for Style Transfer)
  const contentSimilarityMutation = useMutation({
    mutationFn: async (data: { originalText: string; rewrittenText: string }) => {
      const response = await apiRequest("POST", "/api/content-similarity", data);
      return await response.json() as ContentSimilarityResponse;
    },
    onSuccess: (data) => {
      setContentSimilarityResult(data);
      const scoreDescription = data.similarityScore >= 95 ? "Excellent" :
        data.similarityScore >= 85 ? "Good" :
        data.similarityScore >= 70 ? "Fair" : "Low";
      toast({
        title: `Content Similarity: ${data.similarityScore}% (${scoreDescription})`,
        description: data.discrepancies === "None" ? "Content fully preserved" : data.discrepancies.substring(0, 100),
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Similarity analysis failed.";
      toast({
        title: "Analysis failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Content Similarity mutation (for Humanize section)
  const humanizeContentSimilarityMutation = useMutation({
    mutationFn: async (data: { originalText: string; rewrittenText: string }) => {
      const response = await apiRequest("POST", "/api/content-similarity", data);
      return await response.json() as ContentSimilarityResponse;
    },
    onSuccess: (data) => {
      setHumanizeContentSimilarityResult(data);
      const scoreDescription = data.similarityScore >= 95 ? "Excellent" :
        data.similarityScore >= 85 ? "Good" :
        data.similarityScore >= 70 ? "Fair" : "Low";
      toast({
        title: `Content Similarity: ${data.similarityScore}% (${scoreDescription})`,
        description: data.discrepancies === "None" ? "Content fully preserved" : data.discrepancies.substring(0, 100),
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Similarity analysis failed.";
      toast({
        title: "Analysis failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Targeted Rewrite mutations (for Humanize section)
  const humanizeRewriteForSimilarityMutation = useMutation({
    mutationFn: async (data: { currentText: string; originalText: string }) => {
      const response = await apiRequest("POST", "/api/rewrite-for-similarity", data);
      return await response.json() as { rewrittenText: string; mode: string };
    },
    onSuccess: (data) => {
      // Update the humanized results with the new text
      if (humanizeResults) {
        const sentences = data.rewrittenText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        const updatedResults = humanizeResults.map((r, i) => ({
          ...r,
          humanizedRewrite: sentences[i] || r.humanizedRewrite,
        }));
        setHumanizeResults(updatedResults);
      }
      toast({
        title: "Rewritten for better content match",
        description: "Text has been adjusted to better preserve the original meaning.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rewrite failed",
        description: error?.message || "Could not rewrite for similarity.",
        variant: "destructive",
      });
    },
  });

  const humanizeRewriteForAIBypassMutation = useMutation({
    mutationFn: async (data: { currentText: string; originalText: string }) => {
      const response = await apiRequest("POST", "/api/rewrite-for-ai-bypass", data);
      return await response.json() as { rewrittenText: string; mode: string };
    },
    onSuccess: (data) => {
      // Update the humanized results with the new text
      if (humanizeResults) {
        const sentences = data.rewrittenText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        const updatedResults = humanizeResults.map((r, i) => ({
          ...r,
          humanizedRewrite: sentences[i] || r.humanizedRewrite,
        }));
        setHumanizeResults(updatedResults);
      }
      toast({
        title: "Rewritten to sound more human",
        description: "Text has been adjusted to pass AI detection better.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rewrite failed",
        description: error?.message || "Could not rewrite for AI bypass.",
        variant: "destructive",
      });
    },
  });

  // Targeted Rewrite mutations (for Style Transfer section)
  const styleRewriteForSimilarityMutation = useMutation({
    mutationFn: async (data: { currentText: string; originalText: string }) => {
      const response = await apiRequest("POST", "/api/rewrite-for-similarity", data);
      return await response.json() as { rewrittenText: string; mode: string };
    },
    onSuccess: (data) => {
      // Update the style rewrite results with the new text
      if (styleRewriteResults) {
        const sentences = data.rewrittenText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        const updatedResults = styleRewriteResults.map((r, i) => ({
          ...r,
          rewrite: sentences[i] || r.rewrite,
        }));
        setStyleRewriteResults(updatedResults);
      }
      toast({
        title: "Rewritten for better content match",
        description: "Text has been adjusted to better preserve the original meaning.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rewrite failed",
        description: error?.message || "Could not rewrite for similarity.",
        variant: "destructive",
      });
    },
  });

  const styleRewriteForAIBypassMutation = useMutation({
    mutationFn: async (data: { currentText: string; originalText: string }) => {
      const response = await apiRequest("POST", "/api/rewrite-for-ai-bypass", data);
      return await response.json() as { rewrittenText: string; mode: string };
    },
    onSuccess: (data) => {
      // Update the style rewrite results with the new text
      if (styleRewriteResults) {
        const sentences = data.rewrittenText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        const updatedResults = styleRewriteResults.map((r, i) => ({
          ...r,
          rewrite: sentences[i] || r.rewrite,
        }));
        setStyleRewriteResults(updatedResults);
      }
      toast({
        title: "Rewritten to sound more human",
        description: "Text has been adjusted to pass AI detection better.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rewrite failed",
        description: error?.message || "Could not rewrite for AI bypass.",
        variant: "destructive",
      });
    },
  });

  // File upload handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setInputText(text);
        setUploadedFile({ name: file.name });
        toast({
          title: "File uploaded",
          description: `${file.name} loaded successfully.`,
        });
      };
      reader.readAsText(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload a .txt file.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/plain": [".txt"] },
    multiple: false,
    noClick: false,
  });

  // Humanizer file upload handling
  const onDropAiText = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setAiTextInput(text);
        setAiUploadedFile({ name: file.name });
        toast({
          title: "AI text uploaded",
          description: `${file.name} loaded successfully.`,
        });
      };
      reader.readAsText(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload a .txt file.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const { getRootProps: getAiRootProps, getInputProps: getAiInputProps, isDragActive: isAiDragActive } = useDropzone({
    onDrop: onDropAiText,
    accept: { "text/plain": [".txt"] },
    multiple: false,
    noClick: false,
  });

  const handleClearAiText = () => {
    setAiTextInput("");
    setAiUploadedFile(null);
    setMatchResults(null);
    setMatchStats(null);
    setHumanizeResults(null);
    setHumanizeStats(null);
  };

  const handleMatch = () => {
    if (!aiTextInput.trim()) return;
    matchMutation.mutate({
      text: aiTextInput,
      level: bleachingLevel,
    });
  };

  const handleHumanize = () => {
    if (!aiTextInput.trim()) return;
    humanizeMutation.mutate({
      text: aiTextInput,
      level: bleachingLevel,
    });
  };

  const handleDetectAI = () => {
    if (!humanizeResults || humanizeResults.length === 0) {
      toast({
        title: "No text to analyze",
        description: "Humanize your text first before running AI detection.",
        variant: "destructive",
      });
      return;
    }
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    aiDetectMutation.mutate(humanizedText);
  };

  const handleHumanizeContentSimilarity = () => {
    if (!humanizeResults || humanizeResults.length === 0 || !aiTextInput) {
      toast({
        title: "No text to analyze",
        description: "Humanize your text first before checking content similarity.",
        variant: "destructive",
      });
      return;
    }
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    humanizeContentSimilarityMutation.mutate({
      originalText: aiTextInput,
      rewrittenText: humanizedText,
    });
  };

  // Targeted rewrite handlers for Humanize section
  const handleHumanizeRewriteForSimilarity = () => {
    if (!humanizeResults || humanizeResults.length === 0 || !aiTextInput) {
      toast({
        title: "No text to rewrite",
        description: "Humanize your text first.",
        variant: "destructive",
      });
      return;
    }
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    humanizeRewriteForSimilarityMutation.mutate({
      currentText: humanizedText,
      originalText: aiTextInput,
    });
  };

  const handleHumanizeRewriteForAIBypass = () => {
    if (!humanizeResults || humanizeResults.length === 0 || !aiTextInput) {
      toast({
        title: "No text to rewrite",
        description: "Humanize your text first.",
        variant: "destructive",
      });
      return;
    }
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    humanizeRewriteForAIBypassMutation.mutate({
      currentText: humanizedText,
      originalText: aiTextInput,
    });
  };

  // Targeted rewrite handlers for Style Transfer section
  const handleStyleRewriteForSimilarity = () => {
    if (!styleRewriteResults || styleRewriteResults.length === 0 || !styleTargetText) {
      toast({
        title: "No text to rewrite",
        description: "Rewrite in style first.",
        variant: "destructive",
      });
      return;
    }
    const rewrittenText = styleRewriteResults.map(r => r.rewritten).join(" ");
    styleRewriteForSimilarityMutation.mutate({
      currentText: rewrittenText,
      originalText: styleTargetText,
    });
  };

  const handleStyleRewriteForAIBypass = () => {
    if (!styleRewriteResults || styleRewriteResults.length === 0 || !styleTargetText) {
      toast({
        title: "No text to rewrite",
        description: "Rewrite in style first.",
        variant: "destructive",
      });
      return;
    }
    const rewrittenText = styleRewriteResults.map(r => r.rewritten).join(" ");
    styleRewriteForAIBypassMutation.mutate({
      currentText: rewrittenText,
      originalText: styleTargetText,
    });
  };

  const handleCopyHumanized = async () => {
    if (!humanizeResults) return;
    
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    
    try {
      await navigator.clipboard.writeText(humanizedText);
      toast({
        title: "Copied to clipboard",
        description: "Humanized text copied successfully.",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadHumanized = () => {
    if (!humanizeResults) return;
    
    const humanizedText = humanizeResults.map(r => r.humanizedRewrite).join(" ");
    const timestamp = Date.now();
    const filename = `humanized_text_${timestamp}.txt`;
    
    const blob = new Blob([humanizedText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading ${filename}`,
    });
  };

  // Style Transfer file handlers
  const onDropStyleTarget = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setStyleTargetText(text);
        setStyleTargetFile({ name: file.name });
        toast({
          title: "Target text uploaded",
          description: `${file.name} loaded successfully.`,
        });
      };
      reader.readAsText(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload a .txt file.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const onDropStyleSample = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setStyleSampleText(text);
        setStyleSampleFile({ name: file.name });
        toast({
          title: "Style sample uploaded",
          description: `${file.name} loaded successfully.`,
        });
      };
      reader.readAsText(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload a .txt file.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const { getRootProps: getStyleTargetProps, getInputProps: getStyleTargetInputProps, isDragActive: isStyleTargetDragActive } = useDropzone({
    onDrop: onDropStyleTarget,
    accept: { "text/plain": [".txt"] },
    multiple: false,
    noClick: false,
  });

  const { getRootProps: getStyleSampleProps, getInputProps: getStyleSampleInputProps, isDragActive: isStyleSampleDragActive } = useDropzone({
    onDrop: onDropStyleSample,
    accept: { "text/plain": [".txt"] },
    multiple: false,
    noClick: false,
  });

  const handleStyleRewrite = () => {
    // Need either style sample text or a selected author style
    if (!styleTargetText.trim()) return;
    if (!styleSampleText.trim() && !selectedAuthorStyleId) return;
    
    const mutationData: { 
      targetText: string; 
      styleSample?: string; 
      level: BleachingLevel; 
      userId?: number; 
      authorStyleId?: number 
    } = {
      targetText: styleTargetText,
      level: bleachingLevel,
    };
    
    if (selectedAuthorStyleId) {
      // Using author style
      mutationData.authorStyleId = selectedAuthorStyleId;
    } else {
      // Using custom style sample
      mutationData.styleSample = styleSampleText;
      mutationData.userId = currentUser?.id; // Only save patterns when using custom sample
    }
    
    styleRewriteMutation.mutate(mutationData);
  };

  const handleCopyStyleRewrite = async () => {
    if (!styleRewriteResults) return;
    
    const rewrittenText = styleRewriteResults.map(r => r.rewrite).join(" ");
    
    try {
      await navigator.clipboard.writeText(rewrittenText);
      toast({
        title: "Copied to clipboard",
        description: "Rewritten text copied successfully.",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadStyleRewrite = () => {
    if (!styleRewriteResults) return;
    
    const rewrittenText = styleRewriteResults.map(r => r.rewrite).join(" ");
    const timestamp = Date.now();
    const filename = `style_rewrite_${timestamp}.txt`;
    
    const blob = new Blob([rewrittenText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading ${filename}`,
    });
  };

  const handleClearStyleTransfer = () => {
    setStyleTargetText("");
    setStyleSampleText("");
    setStyleTargetFile(null);
    setStyleSampleFile(null);
    setStyleRewriteResults(null);
    setStyleRewriteStats(null);
    setStyleAiDetectionResult(null);
    setContentSimilarityResult(null);
    setSelectedAuthorStyleId(null);
  };

  const handleStyleDetectAI = () => {
    if (!styleRewriteResults || styleRewriteResults.length === 0) {
      toast({
        title: "No text to analyze",
        description: "Rewrite your text first before running AI detection.",
        variant: "destructive",
      });
      return;
    }
    const rewrittenText = styleRewriteResults.map(r => r.rewrite).join(" ");
    styleAiDetectMutation.mutate(rewrittenText);
  };

  const handleContentSimilarity = () => {
    if (!styleTargetText.trim()) {
      toast({
        title: "No target text",
        description: "Enter target text to compare.",
        variant: "destructive",
      });
      return;
    }
    if (!styleRewriteResults || styleRewriteResults.length === 0) {
      toast({
        title: "No rewritten text",
        description: "Rewrite your text first before checking content similarity.",
        variant: "destructive",
      });
      return;
    }
    const rewrittenText = styleRewriteResults.map(r => r.rewrite).join(" ");
    contentSimilarityMutation.mutate({
      originalText: styleTargetText,
      rewrittenText: rewrittenText,
    });
  };

  // Action handlers
  // Chunk selection helpers
  const handlePreviewChunks = () => {
    if (!inputText.trim()) return;
    chunkPreviewMutation.mutate(inputText);
  };

  const handleToggleChunk = (chunkId: number) => {
    setSelectedChunkIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chunkId)) {
        newSet.delete(chunkId);
      } else {
        newSet.add(chunkId);
      }
      return newSet;
    });
  };

  const handleSelectAllChunks = () => {
    setSelectedChunkIds(new Set(chunks.map(c => c.id)));
  };

  const handleDeselectAllChunks = () => {
    setSelectedChunkIds(new Set());
  };

  const getSelectedChunks = () => {
    return chunks
      .filter(c => selectedChunkIds.has(c.id))
      .map(c => ({ id: c.id, text: c.text }));
  };

  const handleBleach = () => {
    if (!inputText.trim()) return;
    
    // If chunks are loaded and we have selections, use chunk-based processing
    if (showChunkSelection && chunks.length > 0) {
      const selectedChunks = getSelectedChunks();
      if (selectedChunks.length === 0) {
        toast({
          title: "No chunks selected",
          description: "Please select at least one chunk to process.",
          variant: "destructive",
        });
        return;
      }
      bleachChunksMutation.mutate({
        chunks: selectedChunks,
        level: bleachingLevel,
      });
    } else {
      // Standard processing for small texts or when chunks not loaded
      bleachMutation.mutate({
        text: inputText,
        level: bleachingLevel,
        filename: uploadedFile?.name,
      });
    }
  };

  const handleGenerateJsonl = () => {
    if (!inputText.trim()) return;
    
    // If chunks are loaded and we have selections, use chunk-based processing
    if (showChunkSelection && chunks.length > 0) {
      const selectedChunks = getSelectedChunks();
      if (selectedChunks.length === 0) {
        toast({
          title: "No chunks selected",
          description: "Please select at least one chunk to process.",
          variant: "destructive",
        });
        return;
      }
      sentenceBankChunksMutation.mutate({
        chunks: selectedChunks,
        level: bleachingLevel,
        userId: currentUser?.id,
      });
    } else {
      // Standard processing
      sentenceBankMutation.mutate({
        text: inputText,
        level: bleachingLevel,
      });
    }
  };

  const handleCopyOutput = async () => {
    if (!outputText) return;
    
    try {
      await navigator.clipboard.writeText(outputText);
      toast({
        title: "Copied to clipboard",
        description: "Bleached text copied successfully.",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadOutput = () => {
    if (!outputText) return;
    
    const filename = uploadedFile?.name 
      ? uploadedFile.name.replace(/\.txt$/, "_bleached.txt")
      : "bleached_output.txt";
    
    const blob = new Blob([outputText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Saving as ${filename}`,
    });
  };

  const handleDownloadJsonl = () => {
    if (!jsonlContent) return;
    
    const timestamp = Date.now();
    const filename = uploadedFile?.name 
      ? uploadedFile.name.replace(/\.txt$/, `_${timestamp}.jsonl`)
      : `sentence_bank_${timestamp}.jsonl`;
    
    const blob = new Blob([jsonlContent], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading ${filename}`,
    });
  };

  const handleDownloadTxt = () => {
    if (!jsonlContent) return;
    
    const lines = jsonlContent.trim().split("\n");
    let txtContent = "";
    
    lines.forEach((line, index) => {
      try {
        const entry = JSON.parse(line);
        txtContent += `--- Sentence ${index + 1} ---\n`;
        txtContent += `Original: ${entry.original}\n`;
        txtContent += `Bleached: ${entry.bleached}\n`;
        txtContent += `Length: ${entry.length} | Clauses: ${entry.clauseCount} | Punctuation: ${entry.punctuation}\n`;
        txtContent += `\n`;
      } catch {
        // Skip invalid lines
      }
    });
    
    const timestamp = Date.now();
    const filename = uploadedFile?.name 
      ? uploadedFile.name.replace(/\.txt$/, `_${timestamp}_bank.txt`)
      : `sentence_bank_${timestamp}.txt`;
    
    const blob = new Blob([txtContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading ${filename}`,
    });
  };

  const handleClearInput = () => {
    setInputText("");
    setUploadedFile(null);
  };

  const handleClearOutput = () => {
    setOutputText("");
    setJsonlContent(null);
    setSentenceCount(0);
  };

  const handleClearAll = () => {
    // Clear bleaching section
    setInputText("");
    setOutputText("");
    setUploadedFile(null);
    setJsonlContent(null);
    setSentenceCount(0);
    // Clear chunk selection
    setChunks([]);
    setSelectedChunkIds(new Set());
    setShowChunkSelection(false);
    // Clear pattern matcher section
    setAiTextInput("");
    setAiUploadedFile(null);
    setMatchResults(null);
    setMatchStats(null);
    // Clear humanizer section
    setHumanizeResults(null);
    setHumanizeStats(null);
    // Clear AI detection
    setAiDetectionResult(null);
    // Clear style transfer
    setStyleTargetText("");
    setStyleSampleText("");
    setStyleTargetFile(null);
    setStyleSampleFile(null);
    setStyleRewriteResults(null);
    setStyleRewriteStats(null);
    setStyleAiDetectionResult(null);
  };

  const handleLogin = () => {
    if (usernameInput.trim()) {
      loginMutation.mutate(usernameInput.trim());
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("semantic_bleacher_user");
    toast({
      title: "Logged out",
      description: "You've been logged out successfully.",
    });
  };

  const handleUploadJsonl = () => {
    if (!uploadJsonlContent.trim()) return;
    uploadMutation.mutate({
      jsonlContent: uploadJsonlContent,
      userId: currentUser?.id,
    });
  };

  // Dropzone for JSONL/TXT upload
  const onUploadDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && (file.name.endsWith(".jsonl") || file.name.endsWith(".txt"))) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setUploadJsonlContent(text);
        toast({
          title: "File loaded",
          description: `Loaded ${file.name} for upload`,
        });
      };
      reader.readAsText(file);
    } else {
      toast({
        title: "Invalid file",
        description: "Please upload a .jsonl or .txt file",
        variant: "destructive",
      });
    }
  }, [toast]);

  const { getRootProps: getUploadRootProps, getInputProps: getUploadInputProps, isDragActive: isUploadDragActive } = useDropzone({
    onDrop: onUploadDrop,
    accept: { 
      "application/json": [".jsonl"],
      "text/plain": [".txt"]
    },
    multiple: false,
  });

  const handleDownloadBankTxt = () => {
    if (!bankContentQuery.data?.entries?.length) return;
    
    let txtContent = `=== SENTENCE BANK ===\n`;
    txtContent += `Total Patterns: ${bankContentQuery.data.count}\n`;
    txtContent += `Downloaded: ${new Date().toLocaleString()}\n\n`;
    
    bankContentQuery.data.entries.forEach((entry, index) => {
      txtContent += `--- Pattern ${index + 1} ---\n`;
      txtContent += `Original: ${entry.original}\n`;
      txtContent += `Bleached: ${entry.bleached}\n`;
      txtContent += `Chars: ${entry.char_length} | Tokens: ${entry.token_length} | Clauses: ${entry.clause_count}\n`;
      txtContent += `Clause Order: ${entry.clause_order}\n`;
      txtContent += `Punctuation: ${entry.punctuation_pattern || '(none)'}\n`;
      txtContent += `\n`;
    });
    
    const timestamp = Date.now();
    const filename = `sentence_bank_full_${timestamp}.txt`;
    
    const blob = new Blob([txtContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading full bank as ${filename}`,
    });
  };

  const handleDownloadBankJsonl = () => {
    if (!bankContentQuery.data?.entries?.length) return;
    
    const jsonlLines = bankContentQuery.data.entries.map((entry) => {
      return JSON.stringify({
        original: entry.original,
        bleached: entry.bleached,
        char_length: entry.char_length,
        token_length: entry.token_length,
        clause_count: entry.clause_count,
        clause_order: entry.clause_order,
        punctuation_pattern: entry.punctuation_pattern,
        structure: entry.structure || entry.bleached,
      });
    });
    
    const jsonlContent = jsonlLines.join("\n");
    const timestamp = Date.now();
    const filename = `sentence_bank_${timestamp}.jsonl`;
    
    const blob = new Blob([jsonlContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Download started",
      description: `Downloading bank as ${filename}`,
    });
  };

  const handleDownloadInstallment = async (installmentNum: number) => {
    setDownloadingInstallment(installmentNum);
    
    try {
      const response = await fetch(`/api/sentence-bank/download/${installmentNum}`);
      const data = await response.json() as {
        entries?: BankEntry[];
        count?: number;
        installment?: number;
        totalInstallments?: number;
        totalCount?: number;
        rangeStart?: number;
        rangeEnd?: number;
        error?: string;
        message?: string;
      };
      
      if (!response.ok) {
        throw new Error(data.message || data.error || "Download failed");
      }
      
      if (!data.entries || data.entries.length === 0) {
        throw new Error("No entries returned from server");
      }
      
      const entries = data.entries;
      const totalInstallments = data.totalInstallments || 1;
      const rangeStart = data.rangeStart || 1;
      const rangeEnd = data.rangeEnd || entries.length;
      
      const jsonlLines = entries.map((entry) => {
        return JSON.stringify({
          original: entry.original,
          bleached: entry.bleached,
          char_length: entry.char_length,
          token_length: entry.token_length,
          clause_count: entry.clause_count,
          clause_order: entry.clause_order,
          punctuation_pattern: entry.punctuation_pattern,
          structure: entry.structure || entry.bleached,
        });
      });
      
      const jsonlContent = jsonlLines.join("\n");
      const timestamp = Date.now();
      const filename = `sentence_bank_part${installmentNum}_of_${totalInstallments}_${timestamp}.jsonl`;
      
      const blob = new Blob([jsonlContent], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Download started",
        description: `Downloading patterns ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} as ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setDownloadingInstallment(null);
    }
  };

  const isProcessing = bleachMutation.isPending || sentenceBankMutation.isPending || 
    chunkPreviewMutation.isPending || bleachChunksMutation.isPending || sentenceBankChunksMutation.isPending;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="h-16 border-b flex items-center justify-between px-8 sticky top-0 bg-background z-50">
        <div className="flex items-center gap-3">
          <SparklesIcon className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">Semantic Bleacher</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Login Widget */}
          {currentUser ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                <UserIcon className="w-4 h-4 inline mr-1" />
                {currentUser.username}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="Username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-32 h-8 text-sm"
                data-testid="input-username"
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleLogin}
                disabled={!usernameInput.trim() || loginMutation.isPending}
                data-testid="button-login"
              >
                {loginMutation.isPending ? "..." : "Login"}
              </Button>
            </div>
          )}

          {/* Upload Button (only when logged in) */}
          {currentUser && (
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-upload-bank">
                  <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
                  Upload Bank
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Upload Sentence Bank</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div
                    {...getUploadRootProps()}
                    className={`h-24 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors hover-elevate ${
                      isUploadDragActive ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    data-testid="dropzone-upload-jsonl"
                  >
                    <input {...getUploadInputProps()} data-testid="input-upload-jsonl" />
                    <ArrowUpTrayIcon className="w-6 h-6 text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">
                      Drag a .jsonl or .txt file here or click to browse
                    </p>
                  </div>
                  <Textarea
                    value={uploadJsonlContent}
                    onChange={(e) => setUploadJsonlContent(e.target.value)}
                    placeholder="Or paste JSONL/TXT content here..."
                    className="h-40 font-mono text-xs"
                    data-testid="textarea-upload-jsonl"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleUploadJsonl}
                      disabled={!uploadJsonlContent.trim() || uploadMutation.isPending}
                      data-testid="button-confirm-upload"
                    >
                      {uploadMutation.isPending ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="button-view-bank">
                <CircleStackIcon className="w-4 h-4 mr-2" />
                <strong>{totalBankSize}</strong>&nbsp;patterns
                <EyeIcon className="w-4 h-4 ml-2" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Sentence Bank ({totalBankSize.toLocaleString()} patterns)</DialogTitle>
              </DialogHeader>
              
              {/* Download Section */}
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Download Bank</span>
                  <span className="text-xs text-muted-foreground">
                    {totalBankSize > 10000 
                      ? `${Math.ceil(totalBankSize / 10000)} installments of 10,000 patterns each`
                      : "Single file download"}
                  </span>
                </div>
                
                {totalBankSize > 10000 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {Array.from({ length: Math.ceil(totalBankSize / 10000) }, (_, i) => {
                      const installmentNum = i + 1;
                      const rangeStart = i * 10000 + 1;
                      const rangeEnd = Math.min((i + 1) * 10000, totalBankSize);
                      return (
                        <Button
                          key={installmentNum}
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadInstallment(installmentNum)}
                          disabled={downloadingInstallment !== null}
                          className="text-xs"
                          data-testid={`button-download-installment-${installmentNum}`}
                        >
                          {downloadingInstallment === installmentNum ? (
                            <span className="animate-pulse">Downloading...</span>
                          ) : (
                            <>
                              <ArrowDownTrayIcon className="w-3 h-3 mr-1" />
                              Part {installmentNum} ({rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()})
                            </>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadInstallment(1)}
                      disabled={totalBankSize === 0 || downloadingInstallment !== null}
                      data-testid="button-download-bank-jsonl"
                    >
                      {downloadingInstallment === 1 ? (
                        <span className="animate-pulse">Downloading...</span>
                      ) : (
                        <>
                          <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                          Download JSONL
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              
              {/* Bank Preview */}
              <div className="flex-1 overflow-auto bg-muted/50 rounded-lg p-4 font-mono text-xs">
                {bankContentQuery.isLoading ? (
                  <div className="text-center text-muted-foreground py-8">Loading bank preview...</div>
                ) : bankContentQuery.data?.entries?.length ? (
                  <div className="space-y-4">
                    <div className="text-muted-foreground text-center pb-2 border-b">
                      Showing first {Math.min(bankContentQuery.data.entries.length, 100)} patterns
                      {bankContentQuery.data.entries.length > 100 && " (download for full content)"}
                    </div>
                    {bankContentQuery.data.entries.slice(0, 100).map((entry, index) => (
                      <div key={index} className="border-b border-border pb-3 last:border-0">
                        <div className="text-muted-foreground mb-1">--- Pattern {index + 1} ---</div>
                        <div><span className="text-muted-foreground">Original:</span> {entry.original}</div>
                        <div><span className="text-muted-foreground">Bleached:</span> {entry.bleached}</div>
                        <div className="text-muted-foreground text-[10px] mt-1">
                          Chars: {entry.char_length} | Tokens: {entry.token_length} | Clauses: {entry.clause_count} | {entry.clause_order} | Punct: {entry.punctuation_pattern || '(none)'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">Bank is empty. Generate some JSONL to add patterns.</div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="default"
            onClick={handleClearAll}
            data-testid="button-clear-all"
          >
            <XMarkIcon className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        </div>
      </header>

      {/* Main Content - Split Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Input */}
        <div className="flex-1 flex flex-col border-r">
          <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">
            {/* File Upload Zone */}
            <div
              {...getRootProps()}
              className={`h-24 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors hover-elevate ${
                isDragActive ? "border-primary bg-primary/5" : "border-border"
              }`}
              data-testid="dropzone-file-upload"
            >
              <input {...getInputProps()} data-testid="input-file" />
              <ArrowUpTrayIcon className="w-6 h-6 text-muted-foreground mb-1" />
              <p className="text-sm font-medium text-foreground">
                {uploadedFile ? uploadedFile.name : "Drag .txt file here or click to browse"}
              </p>
            </div>

            {/* Text Input Area */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">Input Text</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearInput}
                  disabled={!inputText}
                  data-testid="button-clear-input"
                >
                  <XMarkIcon className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              </div>
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type or paste your text here..."
                className="flex-1 resize-none font-mono text-sm leading-relaxed min-h-[200px]"
                data-testid="textarea-input"
              />
            </div>

            {/* Bleaching Level Selector */}
            <Card className="p-4">
              <Label className="text-sm font-semibold mb-3 block">Bleaching Level</Label>
              <RadioGroup
                value={bleachingLevel}
                onValueChange={(value) => setBleachingLevel(value as BleachingLevel)}
                className="flex flex-wrap gap-4"
                data-testid="radiogroup-bleaching-level"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Light" id="light" data-testid="radio-light" />
                  <Label htmlFor="light" className="font-normal cursor-pointer text-sm">Light</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Moderate" id="moderate" data-testid="radio-moderate" />
                  <Label htmlFor="moderate" className="font-normal cursor-pointer text-sm">Moderate</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Moderate-Heavy" id="moderate-heavy" data-testid="radio-moderate-heavy" />
                  <Label htmlFor="moderate-heavy" className="font-normal cursor-pointer text-sm">Moderate-Heavy</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Heavy" id="heavy" data-testid="radio-heavy" />
                  <Label htmlFor="heavy" className="font-normal cursor-pointer text-sm">
                    Heavy <span className="text-xs text-muted-foreground">(Default)</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Very Heavy" id="very-heavy" data-testid="radio-very-heavy" />
                  <Label htmlFor="very-heavy" className="font-normal cursor-pointer text-sm">Very Heavy</Label>
                </div>
              </RadioGroup>
            </Card>

            {/* Word count and chunk estimate */}
            {inputText.trim() && (
              <div className="space-y-3 mb-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {inputWordCount.toLocaleString()} words
                    {isLargeText && !showChunkSelection && (
                      <span className="ml-2">
                        (will process in ~{estimatedChunks} chunks of 2000 words each)
                      </span>
                    )}
                  </div>
                  {isLargeText && !showChunkSelection && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePreviewChunks}
                      disabled={chunkPreviewMutation.isPending}
                      data-testid="button-preview-chunks"
                    >
                      {chunkPreviewMutation.isPending ? "Loading..." : "Select Chunks"}
                    </Button>
                  )}
                </div>

                {/* Chunk Selection Panel */}
                {showChunkSelection && chunks.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-sm font-semibold">
                        Select Chunks to Process ({selectedChunkIds.size}/{chunks.length} selected)
                      </Label>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleSelectAllChunks}
                          disabled={selectedChunkIds.size === chunks.length}
                          data-testid="button-select-all-chunks"
                        >
                          Select All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleDeselectAllChunks}
                          disabled={selectedChunkIds.size === 0}
                          data-testid="button-deselect-all-chunks"
                        >
                          Deselect All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowChunkSelection(false);
                            setChunks([]);
                            setSelectedChunkIds(new Set());
                          }}
                          data-testid="button-close-chunk-selection"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-[200px] overflow-auto space-y-2 border rounded-lg p-2 bg-muted/30">
                      {chunks.map((chunk) => (
                        <div
                          key={chunk.id}
                          className={`flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                            selectedChunkIds.has(chunk.id) 
                              ? "bg-primary/10 border border-primary/20" 
                              : "bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => handleToggleChunk(chunk.id)}
                          data-testid={`chunk-item-${chunk.id}`}
                        >
                          <Checkbox
                            checked={selectedChunkIds.has(chunk.id)}
                            onCheckedChange={() => handleToggleChunk(chunk.id)}
                            className="mt-0.5"
                            data-testid={`checkbox-chunk-${chunk.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                Chunk {chunk.id + 1}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({chunk.wordCount.toLocaleString()} words, {chunk.sentenceCount} sentences)
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {chunk.preview}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedChunkIds.size > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Selected: {Array.from(selectedChunkIds)
                          .map(id => chunks.find(c => c.id === id)?.wordCount || 0)
                          .reduce((a, b) => a + b, 0)
                          .toLocaleString()} words total
                      </p>
                    )}
                  </Card>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleBleach}
                disabled={!inputText.trim() || isProcessing}
                size="lg"
                className="flex-1 h-11 text-base font-semibold"
                data-testid="button-bleach"
              >
                <SparklesIcon className={`w-5 h-5 mr-2 ${(bleachMutation.isPending || bleachChunksMutation.isPending) ? "animate-spin" : ""}`} />
                {bleachMutation.isPending || bleachChunksMutation.isPending
                  ? (showChunkSelection ? `Processing ${selectedChunkIds.size} chunks...` : (isLargeText ? `Processing ${estimatedChunks} chunks...` : "Bleaching..."))
                  : (showChunkSelection && selectedChunkIds.size > 0 ? `Bleach ${selectedChunkIds.size} Chunks` : "Bleach Text")}
              </Button>
              <Button
                onClick={handleGenerateJsonl}
                disabled={!inputText.trim() || isProcessing}
                variant="secondary"
                size="lg"
                className="flex-1 h-11 text-base font-semibold"
                data-testid="button-generate-jsonl"
              >
                <DocumentTextIcon className={`w-5 h-5 mr-2 ${(sentenceBankMutation.isPending || sentenceBankChunksMutation.isPending) ? "animate-pulse" : ""}`} />
                {sentenceBankMutation.isPending || sentenceBankChunksMutation.isPending
                  ? (showChunkSelection ? `Processing ${selectedChunkIds.size} chunks...` : (isLargeText ? `Processing ${estimatedChunks} chunks...` : "Processing..."))
                  : (showChunkSelection && selectedChunkIds.size > 0 ? `Generate JSONL (${selectedChunkIds.size} Chunks)` : "Generate JSONL")}
              </Button>
            </div>
          </div>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 flex flex-col">
          <Tabs 
            value={outputMode} 
            onValueChange={(v) => setOutputMode(v as OutputMode)} 
            className="flex-1 flex flex-col"
          >
            {/* Tab Header */}
            <div className="h-14 border-b px-6 flex items-center justify-between">
              <TabsList className="h-9">
                <TabsTrigger value="bleach" className="text-sm" data-testid="tab-bleach">
                  Bleached Text
                </TabsTrigger>
                <TabsTrigger value="jsonl" className="text-sm" data-testid="tab-jsonl">
                  JSONL Output
                </TabsTrigger>
              </TabsList>
              <div className="flex gap-2">
                {outputMode === "bleach" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyOutput}
                      disabled={!outputText}
                      data-testid="button-copy"
                    >
                      <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDownloadOutput}
                      disabled={!outputText}
                      data-testid="button-download"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDownloadJsonl}
                      disabled={!jsonlContent}
                      data-testid="button-download-jsonl"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                      JSONL
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDownloadTxt}
                      disabled={!jsonlContent}
                      data-testid="button-download-txt"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                      TXT
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearOutput}
                  disabled={!outputText && !jsonlContent}
                  data-testid="button-clear-output"
                >
                  <XMarkIcon className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>

            {/* Bleach Output Tab */}
            <TabsContent value="bleach" className="flex-1 p-6 m-0 overflow-hidden">
              {outputText ? (
                <Textarea
                  value={outputText}
                  readOnly
                  className="w-full h-full resize-none font-mono text-sm leading-relaxed"
                  data-testid="textarea-output"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <SparklesIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-base">Bleached text will appear here</p>
                    <p className="text-sm mt-2">Enter text and click "Bleach Text"</p>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* JSONL Output Tab */}
            <TabsContent value="jsonl" className="flex-1 p-6 m-0 overflow-hidden">
              {jsonlContent ? (
                <div className="h-full flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{sentenceCount}</span> sentences processed
                    </p>
                  </div>
                  <div className="flex-1 bg-muted/50 rounded-lg p-4 font-mono text-xs overflow-auto">
                    <pre className="whitespace-pre-wrap break-all" data-testid="jsonl-content">
                      {jsonlContent}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-base">JSONL output will appear here</p>
                    <p className="text-sm mt-2">Enter text and click "Generate JSONL"</p>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Humanizer Section */}
      <div className="border-t bg-muted/30">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <SparklesIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Pattern Matcher</h2>
              <p className="text-sm text-muted-foreground">Find human sentence patterns for AI text (Step 2)</p>
            </div>
          </div>

          {/* Clear button row */}
          {(aiTextInput || matchResults) && (
            <div className="flex justify-end mb-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAiText}
                data-testid="button-clear-ai-text"
              >
                <XMarkIcon className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>
          )}

          <div className="flex gap-4">
            {/* AI Text Input */}
            <div className="flex-1 flex flex-col gap-3">
              {/* Drop zone for AI text */}
              <div
                {...getAiRootProps()}
                className={`h-16 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors hover-elevate ${
                  isAiDragActive ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="dropzone-ai-text"
              >
                <input {...getAiInputProps()} data-testid="input-ai-file" />
                <ArrowUpTrayIcon className="w-5 h-5 text-muted-foreground mr-2" />
                <p className="text-sm text-muted-foreground">
                  {aiUploadedFile ? aiUploadedFile.name : "Drag .txt file here or click to upload AI text"}
                </p>
              </div>

              {/* AI Text Textarea */}
              <Textarea
                placeholder="Or type/paste your AI-written text here..."
                value={aiTextInput}
                onChange={(e) => setAiTextInput(e.target.value)}
                className="min-h-[150px] resize-none text-sm"
                data-testid="textarea-ai-input"
              />

              {aiTextInput && (
                <p className="text-xs text-muted-foreground">
                  {aiTextInput.length.toLocaleString()} characters
                </p>
              )}
            </div>

            {/* Match Results */}
            <div className="flex-1 flex flex-col gap-3">
              {matchResults && matchResults.length > 0 ? (
                <div className="flex-1 min-h-[200px] bg-muted/50 rounded-lg p-4 overflow-auto">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium">
                      Matched <span className="text-primary">{matchStats?.matched}</span> of {matchStats?.total} sentences
                    </p>
                  </div>
                  <div className="space-y-4">
                    {matchResults.map((result, index) => (
                      <div key={index} className="border-b border-border pb-3 last:border-0" data-testid={`match-result-${index}`}>
                        <div className="mb-2">
                          <p className="text-xs text-muted-foreground mb-1">AI Sentence #{index + 1}</p>
                          <p className="text-sm">{result.original}</p>
                        </div>
                        {result.pattern ? (
                          <div className="bg-primary/5 rounded p-2 mt-2">
                            <p className="text-xs text-primary mb-1">Matched Human Pattern</p>
                            <p className="text-sm font-mono">{result.pattern}</p>
                          </div>
                        ) : (
                          <div className="bg-destructive/10 rounded p-2 mt-2">
                            <p className="text-xs text-destructive">No matching pattern found</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-[200px] bg-muted/50 rounded-lg p-4 flex items-center justify-center">
                  {matchMutation.isPending ? (
                    <div className="text-center text-muted-foreground">
                      <SparklesIcon className="w-12 h-12 mx-auto mb-3 animate-pulse" />
                      <p className="font-medium">Finding matches...</p>
                      <p className="text-sm mt-1">Analyzing AI sentences against human patterns</p>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <SparklesIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">Match results will appear here</p>
                      <p className="text-sm mt-1">Enter AI text and click "Find Matches"</p>
                      <p className="text-xs mt-3 max-w-xs mx-auto">
                        Step 2 finds human sentence patterns that match your AI text structure.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <Button 
                onClick={handleMatch}
                disabled={!aiTextInput.trim() || matchMutation.isPending || totalBankSize === 0}
                className="w-full" 
                data-testid="button-find-matches"
              >
                <SparklesIcon className="w-4 h-4 mr-2" />
                {matchMutation.isPending ? "Finding Matches..." : "Find Matches (Step 2)"}
              </Button>
              {totalBankSize === 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Add human text to the sentence bank first using the bleacher above
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Step 3: Humanizer Section */}
      <div className="border-t bg-primary/5">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <SparklesIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Humanizer</h2>
              <p className="text-sm text-muted-foreground">Rewrite AI text using human sentence patterns (Step 3)</p>
            </div>
          </div>

          <div className="flex gap-4">
            {/* Left side - Input (uses same AI text as Step 2) */}
            <div className="flex-1 flex flex-col gap-3">
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">Uses the same AI text from Step 2 above</p>
                {aiTextInput ? (
                  <p className="text-sm line-clamp-3">{aiTextInput}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No AI text entered yet</p>
                )}
              </div>
              
              <Button 
                onClick={handleHumanize}
                disabled={!aiTextInput.trim() || humanizeMutation.isPending || totalBankSize === 0}
                className="w-full"
                size="lg"
                data-testid="button-humanize"
              >
                <SparklesIcon className="w-5 h-5 mr-2" />
                {humanizeMutation.isPending ? "Humanizing... (this may take a while)" : "Humanize Text (Step 3)"}
              </Button>
              
              {totalBankSize === 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Add human text to the sentence bank first
                </p>
              )}
            </div>

            {/* Right side - Humanized Results */}
            <div className="flex-[2] flex flex-col gap-3">
              {humanizeResults && humanizeResults.length > 0 ? (
                <div className="flex-1 min-h-[300px] bg-background rounded-lg border p-4 overflow-auto">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium">
                      Humanized <span className="text-primary">{humanizeStats?.successful}</span> of {humanizeStats?.total} sentences
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyHumanized}
                        data-testid="button-copy-humanized"
                      >
                        <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                        Copy All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadHumanized}
                        data-testid="button-download-humanized"
                      >
                        <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  
                  {/* Analysis Buttons Row */}
                  <div className="flex gap-2 mb-4">
                    <Button
                      onClick={handleHumanizeContentSimilarity}
                      disabled={humanizeContentSimilarityMutation.isPending}
                      variant="outline"
                      className="flex-1 gap-2"
                      data-testid="button-humanize-content-similarity"
                    >
                      <DocumentTextIcon className="w-4 h-4" />
                      {humanizeContentSimilarityMutation.isPending ? "Analyzing..." : "Content Similarity"}
                    </Button>
                    <Button
                      onClick={handleDetectAI}
                      disabled={aiDetectMutation.isPending}
                      variant="outline"
                      className="flex-1 gap-2"
                      data-testid="button-detect-ai"
                    >
                      <ShieldCheckIcon className="w-4 h-4" />
                      {aiDetectMutation.isPending ? "Detecting..." : "Detect AI"}
                    </Button>
                  </div>

                  {/* Content Similarity Result Display */}
                  {humanizeContentSimilarityResult && (
                    <div className={`p-3 rounded-lg border mb-4 ${
                      humanizeContentSimilarityResult.similarityScore >= 95 
                        ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                        : humanizeContentSimilarityResult.similarityScore >= 85
                        ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                        : humanizeContentSimilarityResult.similarityScore >= 70
                        ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <DocumentTextIcon className={`w-5 h-5 ${
                          humanizeContentSimilarityResult.similarityScore >= 95
                            ? "text-green-600 dark:text-green-400"
                            : humanizeContentSimilarityResult.similarityScore >= 85
                            ? "text-blue-600 dark:text-blue-400"
                            : humanizeContentSimilarityResult.similarityScore >= 70
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-red-600 dark:text-red-400"
                        }`} />
                        <span className="font-semibold text-sm">
                          Content Similarity: {humanizeContentSimilarityResult.similarityScore}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({humanizeContentSimilarityResult.similarityScore >= 95 ? "Excellent" :
                            humanizeContentSimilarityResult.similarityScore >= 85 ? "Good" :
                            humanizeContentSimilarityResult.similarityScore >= 70 ? "Fair" : "Low"})
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><strong>Preserved:</strong> {humanizeContentSimilarityResult.agreementSummary}</p>
                        {humanizeContentSimilarityResult.discrepancies !== "None" && (
                          <p><strong>Differences:</strong> {humanizeContentSimilarityResult.discrepancies}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* AI Detection Result Display */}
                  {aiDetectionResult && (
                    <div className={`p-3 rounded-lg border mb-4 ${
                      aiDetectionResult.documentClassification === "HUMAN_ONLY" 
                        ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                        : aiDetectionResult.documentClassification === "AI_ONLY"
                        ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                        : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <ShieldCheckIcon className={`w-5 h-5 ${
                          aiDetectionResult.documentClassification === "HUMAN_ONLY"
                            ? "text-green-600 dark:text-green-400"
                            : aiDetectionResult.documentClassification === "AI_ONLY"
                            ? "text-red-600 dark:text-red-400"
                            : "text-yellow-600 dark:text-yellow-400"
                        }`} />
                        <span className="font-medium text-sm">
                          {aiDetectionResult.documentClassification.replace("_", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({aiDetectionResult.confidenceCategory} confidence)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI Probability: {Math.round(aiDetectionResult.completelyGeneratedProb * 100)}%
                      </p>
                    </div>
                  )}

                  {/* Targeted Rewrite Buttons */}
                  <div className="flex gap-2 mb-4">
                    <Button
                      onClick={handleHumanizeRewriteForSimilarity}
                      disabled={humanizeRewriteForSimilarityMutation.isPending}
                      variant="secondary"
                      className="flex-1 gap-2"
                      data-testid="button-rewrite-for-similarity"
                    >
                      <DocumentTextIcon className="w-4 h-4" />
                      {humanizeRewriteForSimilarityMutation.isPending ? "Rewriting..." : "Boost Content Match"}
                    </Button>
                    <Button
                      onClick={handleHumanizeRewriteForAIBypass}
                      disabled={humanizeRewriteForAIBypassMutation.isPending}
                      variant="secondary"
                      className="flex-1 gap-2"
                      data-testid="button-rewrite-for-ai-bypass"
                    >
                      <ShieldCheckIcon className="w-4 h-4" />
                      {humanizeRewriteForAIBypassMutation.isPending ? "Rewriting..." : "Boost Human Score"}
                    </Button>
                  </div>

                  {/* Combined humanized text */}
                  <div className="bg-primary/5 rounded-lg p-4 mb-4">
                    <p className="text-xs text-primary font-medium mb-2">HUMANIZED OUTPUT</p>
                    <p className="text-sm leading-relaxed" data-testid="humanized-output">
                      {humanizeResults.map(r => r.humanizedRewrite).join(" ")}
                    </p>
                  </div>

                  {/* Detailed breakdown */}
                  <div className="space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sentence-by-Sentence Breakdown</p>
                    {humanizeResults.map((result, index) => (
                      <div key={index} className="border rounded-lg p-3 bg-muted/30" data-testid={`humanize-result-${index}`}>
                        <div className="grid gap-3">
                          {/* AI Sentence */}
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">AI Sentence #{index + 1}</p>
                            <p className="text-sm">{result.aiSentence}</p>
                          </div>
                          
                          {/* Best Matched Pattern */}
                          {result.bestPattern.original && (
                            <div className="bg-muted rounded p-2">
                              <p className="text-xs text-muted-foreground mb-1">
                                Matched Human Pattern (Score: {result.bestPattern.score})
                              </p>
                              <p className="text-sm font-mono text-xs">{result.bestPattern.bleached}</p>
                              <p className="text-xs text-muted-foreground mt-1">From: "{result.bestPattern.original.substring(0, 80)}..."</p>
                            </div>
                          )}
                          
                          {/* Humanized Rewrite */}
                          <div className="bg-primary/10 rounded p-2">
                            <p className="text-xs text-primary mb-1">Humanized Rewrite</p>
                            <p className="text-sm font-medium">{result.humanizedRewrite}</p>
                          </div>
                          
                          {/* Top 3 Patterns (collapsible info) */}
                          {result.matchedPatterns.length > 1 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                Show top {result.matchedPatterns.length} matched patterns
                              </summary>
                              <div className="mt-2 space-y-1 pl-2 border-l-2 border-muted">
                                {result.matchedPatterns.map((pattern, pIdx) => (
                                  <div key={pIdx} className="text-muted-foreground">
                                    <span className="font-medium">#{pattern.rank}</span> (Score: {pattern.score}): {pattern.original.substring(0, 60)}...
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-[300px] bg-background rounded-lg border p-4 flex items-center justify-center">
                  {humanizeMutation.isPending ? (
                    <div className="text-center text-muted-foreground">
                      <SparklesIcon className="w-16 h-16 mx-auto mb-4 animate-pulse text-primary" />
                      <p className="font-medium text-lg">Humanizing your text...</p>
                      <p className="text-sm mt-2">Matching patterns and rewriting sentences</p>
                      <p className="text-xs mt-4 max-w-md mx-auto">
                        This process bleaches each AI sentence, finds the best human pattern matches, 
                        and rewrites using human sentence geometry.
                      </p>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <SparklesIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                      <p className="font-medium text-lg">Humanized text will appear here</p>
                      <p className="text-sm mt-2">Enter AI text above and click "Humanize Text"</p>
                      <p className="text-xs mt-4 max-w-md mx-auto">
                        Step 3 takes each AI sentence, finds matching human patterns, 
                        and rewrites the sentence using real human sentence structures.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Style Transfer Section */}
        <div className="border-t p-6">
          <div className="flex items-center gap-3 mb-4">
            <SparklesIcon className="w-6 h-6 text-primary" />
            <h2 className="text-lg font-semibold">Rewrite in Same Style</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Style Transfer</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Rewrite your target text using the sentence patterns from a style sample. 
            <span className="text-primary font-medium"> Tip: Use a style sample much longer than your target</span> to increase the likelihood of natural pattern matches.
          </p>

          {/* Top Row: Target Text (Left) | Rewrite (Right) */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Target Text Box (Left) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Target Text</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setStyleTargetText(""); setStyleTargetFile(null); }}
                  disabled={!styleTargetText}
                  data-testid="button-clear-style-target"
                >
                  <XMarkIcon className="w-4 h-4" />
                </Button>
              </div>
              <div
                {...getStyleTargetProps()}
                className={`h-16 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors hover-elevate ${
                  isStyleTargetDragActive ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="dropzone-style-target"
              >
                <input {...getStyleTargetInputProps()} data-testid="input-style-target-file" />
                <p className="text-xs text-muted-foreground">
                  {styleTargetFile ? styleTargetFile.name : "Drop target .txt or click to browse"}
                </p>
              </div>
              <Textarea
                placeholder="Paste or type the text you want rewritten..."
                value={styleTargetText}
                onChange={(e) => setStyleTargetText(e.target.value)}
                className="min-h-[200px] resize-none"
                data-testid="textarea-style-target"
              />
              {styleTargetText && (
                <p className="text-xs text-muted-foreground">
                  {getWordCount(styleTargetText)} words
                </p>
              )}
            </div>

            {/* Rewrite Output Box (Right) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Rewritten Text</Label>
                {styleRewriteResults && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyStyleRewrite}
                      data-testid="button-copy-style-rewrite"
                    >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDownloadStyleRewrite}
                      data-testid="button-download-style-rewrite"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Analysis Buttons for Style Transfer */}
              {styleRewriteResults && styleRewriteResults.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleContentSimilarity}
                    disabled={contentSimilarityMutation.isPending}
                    className="flex-1"
                    data-testid="button-content-similarity"
                  >
                    <DocumentTextIcon className="w-4 h-4 mr-2" />
                    {contentSimilarityMutation.isPending ? "Analyzing..." : "Content Similarity"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStyleDetectAI}
                    disabled={styleAiDetectMutation.isPending}
                    className="flex-1"
                    data-testid="button-style-detect-ai"
                  >
                    <ShieldCheckIcon className="w-4 h-4 mr-2" />
                    {styleAiDetectMutation.isPending ? "Detecting..." : "Detect AI"}
                  </Button>
                </div>
              )}

              {/* Content Similarity Result Display */}
              {contentSimilarityResult && (
                <div className={`p-3 rounded-lg border ${
                  contentSimilarityResult.similarityScore >= 95 
                    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                    : contentSimilarityResult.similarityScore >= 85
                    ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                    : contentSimilarityResult.similarityScore >= 70
                    ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
                    : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <DocumentTextIcon className={`w-5 h-5 ${
                      contentSimilarityResult.similarityScore >= 95
                        ? "text-green-600 dark:text-green-400"
                        : contentSimilarityResult.similarityScore >= 85
                        ? "text-blue-600 dark:text-blue-400"
                        : contentSimilarityResult.similarityScore >= 70
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-red-600 dark:text-red-400"
                    }`} />
                    <span className="font-semibold text-sm">
                      Content Similarity: {contentSimilarityResult.similarityScore}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({contentSimilarityResult.similarityScore >= 95 ? "Excellent" :
                        contentSimilarityResult.similarityScore >= 85 ? "Good" :
                        contentSimilarityResult.similarityScore >= 70 ? "Fair" : "Low"})
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Preserved:</strong> {contentSimilarityResult.agreementSummary}</p>
                    {contentSimilarityResult.discrepancies !== "None" && (
                      <p><strong>Differences:</strong> {contentSimilarityResult.discrepancies}</p>
                    )}
                  </div>
                </div>
              )}

              {/* AI Detection Result Display */}
              {styleAiDetectionResult && (
                <div className={`p-3 rounded-lg border ${
                  styleAiDetectionResult.documentClassification === "HUMAN_ONLY" 
                    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                    : styleAiDetectionResult.documentClassification === "AI_ONLY"
                    ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                    : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheckIcon className={`w-5 h-5 ${
                      styleAiDetectionResult.documentClassification === "HUMAN_ONLY"
                        ? "text-green-600 dark:text-green-400"
                        : styleAiDetectionResult.documentClassification === "AI_ONLY"
                        ? "text-red-600 dark:text-red-400"
                        : "text-yellow-600 dark:text-yellow-400"
                    }`} />
                    <span className="font-medium text-sm">
                      {styleAiDetectionResult.documentClassification.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({styleAiDetectionResult.confidenceCategory} confidence)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    AI Probability: {Math.round(styleAiDetectionResult.completelyGeneratedProb * 100)}%
                  </p>
                </div>
              )}

              {/* Targeted Rewrite Buttons for Style Transfer */}
              {styleRewriteResults && styleRewriteResults.length > 0 && (
                <div className="flex gap-2 mb-3">
                  <Button
                    onClick={handleStyleRewriteForSimilarity}
                    disabled={styleRewriteForSimilarityMutation.isPending}
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-2"
                    data-testid="button-style-rewrite-for-similarity"
                  >
                    <DocumentTextIcon className="w-4 h-4" />
                    {styleRewriteForSimilarityMutation.isPending ? "Rewriting..." : "Boost Content Match"}
                  </Button>
                  <Button
                    onClick={handleStyleRewriteForAIBypass}
                    disabled={styleRewriteForAIBypassMutation.isPending}
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-2"
                    data-testid="button-style-rewrite-for-ai-bypass"
                  >
                    <ShieldCheckIcon className="w-4 h-4" />
                    {styleRewriteForAIBypassMutation.isPending ? "Rewriting..." : "Boost Human Score"}
                  </Button>
                </div>
              )}

              <div className="flex-1 min-h-[200px] border rounded-lg p-3 bg-muted/30 overflow-auto">
                {styleRewriteResults && styleRewriteResults.length > 0 ? (
                  <div className="space-y-2">
                    {styleRewriteStats && (
                      <p className="text-xs text-muted-foreground mb-2">
                        Rewrote <span className="text-primary font-medium">{styleRewriteStats.successful}</span> of {styleRewriteStats.total} sentences using {styleRewriteStats.patternsExtracted} extracted patterns
                      </p>
                    )}
                    <p className="text-sm leading-relaxed" data-testid="style-rewrite-output">
                      {styleRewriteResults.map(r => r.rewrite).join(" ")}
                    </p>
                  </div>
                ) : styleRewriteMutation.isPending ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <SparklesIcon className="w-12 h-12 mx-auto mb-2 animate-pulse text-primary" />
                      <p className="text-sm font-medium">Transferring style...</p>
                      <p className="text-xs mt-1">Extracting patterns and rewriting</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Rewritten text will appear here
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Author Style Selection OR Custom Style Sample */}
          <div className="flex flex-col gap-4">
            {/* Author Style Dropdown */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Author Style</Label>
              <div className="flex items-center gap-3">
                <Select
                  value={selectedAuthorStyleId?.toString() || "custom"}
                  onValueChange={(value) => {
                    if (value === "custom") {
                      setSelectedAuthorStyleId(null);
                    } else {
                      setSelectedAuthorStyleId(parseInt(value));
                      // Clear custom style sample when selecting an author
                      setStyleSampleText("");
                      setStyleSampleFile(null);
                    }
                  }}
                  data-testid="select-author-style"
                >
                  <SelectTrigger className="w-[250px]" data-testid="trigger-author-style">
                    <SelectValue placeholder="Select an author style..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom" data-testid="option-custom-style">
                      Custom Style Sample
                    </SelectItem>
                    {authorStylesQuery.data?.map((style) => (
                      <SelectItem 
                        key={style.id} 
                        value={style.id.toString()}
                        disabled={style.sentenceCount === 0}
                        data-testid={`option-author-${style.id}`}
                      >
                        {style.name} ({style.sentenceCount} patterns)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAuthorStyleId && (
                  <p className="text-xs text-muted-foreground">
                    Using {authorStylesQuery.data?.find(s => s.id === selectedAuthorStyleId)?.name}'s sentence patterns
                  </p>
                )}
              </div>
            </div>
            
            {/* Custom Style Sample (only shown when not using an author style) */}
            {!selectedAuthorStyleId && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Style Sample (reference text for sentence patterns)</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setStyleSampleText(""); setStyleSampleFile(null); }}
                    disabled={!styleSampleText}
                    data-testid="button-clear-style-sample"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </Button>
                </div>
                <div
                  {...getStyleSampleProps()}
                  className={`h-16 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors hover-elevate ${
                    isStyleSampleDragActive ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  data-testid="dropzone-style-sample"
                >
                  <input {...getStyleSampleInputProps()} data-testid="input-style-sample-file" />
                  <p className="text-xs text-muted-foreground">
                    {styleSampleFile ? styleSampleFile.name : "Drop style sample .txt or click to browse"}
                  </p>
                </div>
                <Textarea
                  placeholder="Paste or type a style sample text (ideally longer than your target)..."
                  value={styleSampleText}
                  onChange={(e) => setStyleSampleText(e.target.value)}
                  className="min-h-[150px] resize-none"
                  data-testid="textarea-style-sample"
                />
                {styleSampleText && (
                  <p className="text-xs text-muted-foreground">
                    {getWordCount(styleSampleText)} words
                    {styleTargetText && getWordCount(styleSampleText) < getWordCount(styleTargetText) && (
                      <span className="text-yellow-600 ml-2">
                        (Consider using a longer style sample for better results)
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-4">
            <Button
              onClick={handleStyleRewrite}
              disabled={!styleTargetText.trim() || (!styleSampleText.trim() && !selectedAuthorStyleId) || styleRewriteMutation.isPending}
              className="flex-1"
              data-testid="button-style-rewrite"
            >
              <SparklesIcon className="w-4 h-4 mr-2" />
              {styleRewriteMutation.isPending ? "Rewriting..." : selectedAuthorStyleId ? "Rewrite in Author's Style" : "Rewrite in Same Style"}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearStyleTransfer}
              disabled={!styleTargetText && !styleSampleText && !styleRewriteResults && !selectedAuthorStyleId}
              data-testid="button-clear-style-transfer"
            >
              <XMarkIcon className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>

          {/* Sentence-by-sentence breakdown */}
          {styleRewriteResults && styleRewriteResults.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Sentence-by-Sentence Breakdown
              </p>
              <div className="space-y-3 max-h-[400px] overflow-auto">
                {styleRewriteResults.map((result, index) => (
                  <div key={index} className="border rounded-lg p-3 bg-muted/30" data-testid={`style-result-${index}`}>
                    <div className="grid gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Original #{index + 1}</p>
                        <p className="text-sm">{result.original}</p>
                      </div>
                      {result.matchedPattern && (
                        <div className="bg-muted rounded p-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            Matched Style Pattern (Score: {result.matchedPattern.score})
                          </p>
                          <p className="text-xs font-mono">{result.matchedPattern.bleached}</p>
                        </div>
                      )}
                      <div className="bg-primary/10 rounded p-2">
                        <p className="text-xs text-primary mb-1">Rewritten</p>
                        <p className="text-sm font-medium">{result.rewrite}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
