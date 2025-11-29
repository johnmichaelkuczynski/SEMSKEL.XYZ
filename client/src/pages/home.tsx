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
import type { BleachingLevel, BleachResponse, SentenceBankResponse, MatchResponse, MatchResult, HumanizeResponse, HumanizedSentence } from "@shared/schema";

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
  const { toast } = useToast();

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

  useEffect(() => {
    if (bankStatusQuery.data) {
      setTotalBankSize(bankStatusQuery.data.count);
    }
  }, [bankStatusQuery.data]);

  // Bleaching mutation
  const bleachMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel; filename?: string }) => {
      const response = await apiRequest("POST", "/api/bleach", data);
      return await response.json() as BleachResponse;
    },
    onSuccess: (data) => {
      setOutputText(data.bleachedText);
      toast({
        title: "Text bleached successfully",
        description: `Applied ${bleachingLevel} bleaching to your text.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while bleaching the text.";
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
      return await response.json() as SentenceBankResponse;
    },
    onSuccess: (data) => {
      setJsonlContent(data.jsonlContent);
      setSentenceCount(data.sentenceCount);
      if (data.totalBankSize) {
        setTotalBankSize(data.totalBankSize);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sentence-bank/status"] });
      toast({
        title: "Saved to sentence bank",
        description: `Added ${data.sentenceCount} sentences. Bank now has ${data.totalBankSize || data.sentenceCount} total entries.`,
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

  // Action handlers
  const handleBleach = () => {
    if (!inputText.trim()) return;
    
    bleachMutation.mutate({
      text: inputText,
      level: bleachingLevel,
      filename: uploadedFile?.name,
    });
  };

  const handleGenerateJsonl = () => {
    if (!inputText.trim()) return;
    
    sentenceBankMutation.mutate({
      text: inputText,
      level: bleachingLevel,
    });
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
    setInputText("");
    setOutputText("");
    setUploadedFile(null);
    setJsonlContent(null);
    setSentenceCount(0);
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

  const isProcessing = bleachMutation.isPending || sentenceBankMutation.isPending;

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
                <DialogTitle className="flex items-center justify-between">
                  <span>Sentence Bank ({bankContentQuery.data?.count || 0} patterns)</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadBankJsonl}
                    disabled={!bankContentQuery.data?.entries?.length}
                    data-testid="button-download-bank-jsonl"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                    Download JSONL
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadBankTxt}
                    disabled={!bankContentQuery.data?.entries?.length}
                    data-testid="button-download-bank-txt"
                  >
                    <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                    Download TXT
                  </Button>
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto bg-muted/50 rounded-lg p-4 font-mono text-xs">
                {bankContentQuery.isLoading ? (
                  <div className="text-center text-muted-foreground py-8">Loading bank...</div>
                ) : bankContentQuery.data?.entries?.length ? (
                  <div className="space-y-4">
                    {bankContentQuery.data.entries.map((entry, index) => (
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

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleBleach}
                disabled={!inputText.trim() || isProcessing}
                size="lg"
                className="flex-1 h-11 text-base font-semibold"
                data-testid="button-bleach"
              >
                <SparklesIcon className="w-5 h-5 mr-2" />
                {bleachMutation.isPending ? "Bleaching..." : "Bleach Text"}
              </Button>
              <Button
                onClick={handleGenerateJsonl}
                disabled={!inputText.trim() || isProcessing}
                variant="secondary"
                size="lg"
                className="flex-1 h-11 text-base font-semibold"
                data-testid="button-generate-jsonl"
              >
                <DocumentTextIcon className={`w-5 h-5 mr-2 ${sentenceBankMutation.isPending ? "animate-pulse" : ""}`} />
                {sentenceBankMutation.isPending ? "Processing... (this may take a while)" : "Generate JSONL"}
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
      </div>
    </div>
  );
}
