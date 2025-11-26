import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  EyeIcon
} from "@heroicons/react/24/outline";
import type { BleachingLevel, BleachResponse, SentenceBankResponse } from "@shared/schema";

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
  const { toast } = useToast();

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

  const isProcessing = bleachMutation.isPending || sentenceBankMutation.isPending;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="h-16 border-b flex items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <SparklesIcon className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">Semantic Bleacher</h1>
        </div>
        <div className="flex items-center gap-4">
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
                <DocumentTextIcon className="w-5 h-5 mr-2" />
                {sentenceBankMutation.isPending ? "Generating..." : "Generate JSONL"}
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
    </div>
  );
}
