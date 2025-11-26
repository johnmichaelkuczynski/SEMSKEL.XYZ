import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  ArrowUpTrayIcon, 
  ClipboardDocumentIcon, 
  ArrowDownTrayIcon, 
  XMarkIcon,
  SparklesIcon,
  DocumentTextIcon
} from "@heroicons/react/24/outline";
import { Link } from "wouter";
import type { BleachingLevel, BleachResponse, SentenceBankResponse } from "@shared/schema";

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [bleachingLevel, setBleachingLevel] = useState<BleachingLevel>("Heavy");
  const [uploadedFile, setUploadedFile] = useState<{ name: string } | null>(null);
  const { toast } = useToast();

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
      const filename = uploadedFile?.name 
        ? uploadedFile.name.replace(/\.txt$/, "_sentence_bank.jsonl")
        : "sentence_bank.jsonl";
      
      const blob = new Blob([data.jsonlContent], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Sentence bank created",
        description: `Generated ${data.sentenceCount} sentences. Downloading ${filename}`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while building the sentence bank.";
      toast({
        title: "Sentence bank failed",
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

  const handleClearInput = () => {
    setInputText("");
    setUploadedFile(null);
  };

  const handleClearOutput = () => {
    setOutputText("");
  };

  const handleClearAll = () => {
    setInputText("");
    setOutputText("");
    setUploadedFile(null);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="h-20 border-b flex items-center justify-between px-12">
        <div className="flex items-center gap-3">
          <SparklesIcon className="w-7 h-7 text-primary" />
          <h1 className="text-xl font-bold">Semantic Bleacher</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/make-json">
            <Button variant="outline" size="default" data-testid="button-make-json">
              <DocumentTextIcon className="w-4 h-4 mr-2" />
              JSONL Generator
            </Button>
          </Link>
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
          <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
            {/* File Upload Zone */}
            <div
              {...getRootProps()}
              className={`h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors hover-elevate ${
                isDragActive ? "border-primary bg-primary/5" : "border-border"
              }`}
              data-testid="dropzone-file-upload"
            >
              <input {...getInputProps()} data-testid="input-file" />
              <ArrowUpTrayIcon className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-foreground">
                {uploadedFile ? uploadedFile.name : "Drag .txt file here"}
              </p>
              <p className="text-xs text-muted-foreground">
                {uploadedFile ? "Click to upload a different file" : "or click to browse"}
              </p>
            </div>

            {/* Text Input Area */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-lg font-semibold">Input Text</Label>
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
                className="flex-1 resize-none font-mono text-sm leading-relaxed"
                data-testid="textarea-input"
              />
            </div>

            {/* Bleaching Level Selector */}
            <Card className="p-6">
              <Label className="text-base font-semibold mb-4 block">Bleaching Level</Label>
              <RadioGroup
                value={bleachingLevel}
                onValueChange={(value) => setBleachingLevel(value as BleachingLevel)}
                className="space-y-3"
                data-testid="radiogroup-bleaching-level"
              >
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="Light" id="light" data-testid="radio-light" />
                  <Label htmlFor="light" className="font-normal cursor-pointer">
                    Light
                  </Label>
                </div>
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="Moderate" id="moderate" data-testid="radio-moderate" />
                  <Label htmlFor="moderate" className="font-normal cursor-pointer">
                    Moderate
                  </Label>
                </div>
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="Moderate-Heavy" id="moderate-heavy" data-testid="radio-moderate-heavy" />
                  <Label htmlFor="moderate-heavy" className="font-normal cursor-pointer">
                    Moderate-Heavy
                  </Label>
                </div>
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="Heavy" id="heavy" data-testid="radio-heavy" />
                  <Label htmlFor="heavy" className="font-normal cursor-pointer">
                    Heavy <span className="text-xs text-muted-foreground ml-2">(Default)</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="Very Heavy" id="very-heavy" data-testid="radio-very-heavy" />
                  <Label htmlFor="very-heavy" className="font-normal cursor-pointer">
                    Very Heavy
                  </Label>
                </div>
              </RadioGroup>
            </Card>

            {/* Bleach Button */}
            <Button
              onClick={handleBleach}
              disabled={!inputText.trim() || bleachMutation.isPending}
              size="lg"
              className="h-12 text-base font-semibold"
              data-testid="button-bleach"
            >
              {bleachMutation.isPending ? "Bleaching..." : "Bleach Text"}
            </Button>
          </div>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 flex flex-col">
          {/* Panel Header with Controls */}
          <div className="h-14 border-b px-6 flex items-center justify-between">
            <Label className="text-lg font-semibold">Output</Label>
            <div className="flex gap-2">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearOutput}
                disabled={!outputText}
                data-testid="button-clear-output"
              >
                <XMarkIcon className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Output Text Area */}
          <div className="flex-1 p-6">
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
                  <p className="text-sm mt-2">Select your text and bleaching level, then click "Bleach Text"</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
