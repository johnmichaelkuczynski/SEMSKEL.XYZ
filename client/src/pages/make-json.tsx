import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  ArrowUpTrayIcon, 
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ArrowLeftIcon
} from "@heroicons/react/24/outline";
import { Link } from "wouter";
import type { BleachingLevel, SentenceBankResponse } from "@shared/schema";

export default function MakeJson() {
  const [uploadedText, setUploadedText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [bleachingLevel, setBleachingLevel] = useState<BleachingLevel>("Heavy");
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [sentenceCount, setSentenceCount] = useState<number>(0);
  const { toast } = useToast();

  const processMutation = useMutation({
    mutationFn: async (data: { text: string; level: BleachingLevel }) => {
      const response = await apiRequest("POST", "/api/build-sentence-bank", data);
      return await response.json() as SentenceBankResponse;
    },
    onSuccess: (data) => {
      setGeneratedContent(data.jsonlContent);
      setSentenceCount(data.sentenceCount);
      toast({
        title: "Processing complete",
        description: `Generated ${data.sentenceCount} sentences. Ready to download.`,
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "An error occurred while processing.";
      toast({
        title: "Processing failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setUploadedText(text);
        setUploadedFileName(file.name);
        setGeneratedContent(null);
        setSentenceCount(0);
        toast({
          title: "File uploaded",
          description: `${file.name} loaded successfully.`,
        });
      };
      reader.readAsText(file);
    }
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/plain": [".txt"] },
    multiple: false,
  });

  const handleProcess = () => {
    if (!uploadedText.trim()) return;
    setGeneratedContent(null);
    processMutation.mutate({
      text: uploadedText,
      level: bleachingLevel,
    });
  };

  const handleDownload = () => {
    if (!generatedContent) return;
    
    const timestamp = Date.now();
    const filename = uploadedFileName 
      ? uploadedFileName.replace(/\.txt$/, `_${timestamp}.jsonl`)
      : `output_${timestamp}.jsonl`;
    
    const blob = new Blob([generatedContent], { type: "application/jsonl" });
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

  const handleClear = () => {
    setUploadedText("");
    setUploadedFileName(null);
    setGeneratedContent(null);
    setSentenceCount(0);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeftIcon className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <DocumentTextIcon className="w-7 h-7 text-primary" />
              JSONL Sentence Bank Generator
            </h1>
            <p className="text-muted-foreground mt-1">
              Upload any text file → Get a downloadable JSONL file with bleached sentences and metadata
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-6">
          <div
            {...getRootProps()}
            className={`h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors hover-elevate ${
              isDragActive ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="dropzone-json-upload"
          >
            <input {...getInputProps()} data-testid="input-json-file" />
            <ArrowUpTrayIcon className="w-10 h-10 text-muted-foreground mb-3" />
            {uploadedFileName ? (
              <>
                <p className="text-base font-medium text-foreground">{uploadedFileName}</p>
                <p className="text-sm text-muted-foreground">Click or drag to replace</p>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-foreground">
                  {isDragActive ? "Drop your file here" : "Drag & drop any .txt file"}
                </p>
                <p className="text-sm text-muted-foreground">or click to browse</p>
              </>
            )}
          </div>

          {uploadedText && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{uploadedText.split(/(?<=[.!?])\s+/).filter(s => s.trim()).length}</span> sentences detected
                <span className="mx-2">•</span>
                <span className="font-medium text-foreground">{uploadedText.length.toLocaleString()}</span> characters
              </p>
            </div>
          )}

          <div>
            <Label className="text-base font-semibold mb-3 block">Bleaching Level</Label>
            <RadioGroup
              value={bleachingLevel}
              onValueChange={(value) => setBleachingLevel(value as BleachingLevel)}
              className="grid grid-cols-2 gap-3"
              data-testid="radiogroup-json-level"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Light" id="json-light" data-testid="radio-json-light" />
                <Label htmlFor="json-light" className="font-normal cursor-pointer">Light</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Moderate" id="json-moderate" data-testid="radio-json-moderate" />
                <Label htmlFor="json-moderate" className="font-normal cursor-pointer">Moderate</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Moderate-Heavy" id="json-moderate-heavy" data-testid="radio-json-moderate-heavy" />
                <Label htmlFor="json-moderate-heavy" className="font-normal cursor-pointer">Moderate-Heavy</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Heavy" id="json-heavy" data-testid="radio-json-heavy" />
                <Label htmlFor="json-heavy" className="font-normal cursor-pointer">Heavy</Label>
              </div>
              <div className="flex items-center space-x-2 col-span-2">
                <RadioGroupItem value="Very Heavy" id="json-very-heavy" data-testid="radio-json-very-heavy" />
                <Label htmlFor="json-very-heavy" className="font-normal cursor-pointer">Very Heavy</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleProcess}
              disabled={!uploadedText.trim() || processMutation.isPending}
              className="flex-1 h-12 text-base font-semibold"
              data-testid="button-process"
            >
              {processMutation.isPending ? "Processing..." : "Process Text"}
            </Button>
            {uploadedText && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={processMutation.isPending}
                data-testid="button-clear-json"
              >
                Clear
              </Button>
            )}
          </div>
        </Card>

        {generatedContent && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">JSONL Ready</h2>
                <p className="text-sm text-muted-foreground">
                  {sentenceCount} sentences processed
                </p>
              </div>
              <Button
                onClick={handleDownload}
                size="lg"
                className="gap-2"
                data-testid="button-download-jsonl"
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
                Download JSONL
              </Button>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg font-mono text-xs overflow-x-auto max-h-48 overflow-y-auto">
              <pre className="whitespace-pre-wrap break-all">
                {generatedContent.split('\n').slice(0, 5).join('\n')}
                {generatedContent.split('\n').length > 5 && (
                  <span className="text-muted-foreground block mt-2">
                    ... and {generatedContent.split('\n').length - 5} more lines
                  </span>
                )}
              </pre>
            </div>
          </Card>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Nothing is stored. Each upload is processed independently and the output is downloaded directly to your computer.
        </p>
      </div>
    </div>
  );
}
