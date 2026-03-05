import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Square, FileText, CheckCircle, HardDrive, User, Loader2, Globe, RefreshCw } from "lucide-react"
import { useScrape } from "@/contexts/ScrapeContext"
import { safeOpenFile } from "@/lib/safeOpenFile"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// Browser icon components (inline SVGs for no extra deps)
function BrowserIcon({ id, className }) {
    const icons = {
        chrome: (
            <svg viewBox="0 0 24 24" className={className} fill="none">
                <circle cx="12" cy="12" r="4" fill="#4285F4" />
                <path d="M12 8h8.7A10 10 0 0 1 12 22" stroke="#34A853" strokeWidth="2.5" fill="none" />
                <path d="M3.3 8A10 10 0 0 0 12 22L7.5 14" stroke="#FBBC05" strokeWidth="2.5" fill="none" />
                <path d="M12 8H3.3A10 10 0 0 1 20.7 8" stroke="#EA4335" strokeWidth="2.5" fill="none" />
            </svg>
        ),
        firefox: (
            <svg viewBox="0 0 24 24" className={className}>
                <circle cx="12" cy="12" r="10" fill="#FF6611" opacity="0.15" />
                <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" fill="#FF6611" />
                <path d="M16 8c-1-1.5-3-2-4-2-2.5 0-5 2-5 5 0 4 3 6 5 6s5-2 5-5c0-2-.5-3-.5-3l-3 1.5 1.5 1.5-2 1.5" fill="#FF9900" />
            </svg>
        ),
        brave: (
            <svg viewBox="0 0 24 24" className={className}>
                <path d="M12 2L4 6v5c0 4.5 3.4 8.7 8 10 4.6-1.3 8-5.5 8-10V6l-8-4z" fill="#FB542B" />
                <path d="M15 10l-3 3-3-3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
        ),
        edge: (
            <svg viewBox="0 0 24 24" className={className}>
                <path d="M16 8C15 5 12 3 9 4c-4 1.5-5 7-3 10 1 2 3 3 5 3h7c1 0 2-.4 2-1.5C20 11 18 8 16 8z" fill="#0078D7" />
                <path d="M4 14c0 4 3.5 7 8 7 2 0 3.5-.5 5-2H9c-3 0-5-2-5-5z" fill="#1AB9E8" />
            </svg>
        )
    }
    return icons[id] || <Globe className={className} />
}

export default function ScrapePage() {
    const { scrapeState, startScrape, stopScrape, resetScrape, goToStep } = useScrape()
    const { step, progress, leadsScraped, speed, currentLead, maxLeads, listName, url, result, error, active } = scrapeState

    const [form, setForm] = useState({ url: url || "", listName: listName || "", maxLeads: maxLeads || 200 })
    const [uploading, setUploading] = useState(false)
    const [driveStatus, setDriveStatus] = useState(null)

    // Browser detection state
    const [browsers, setBrowsers] = useState([])
    const [browsersLoading, setBrowsersLoading] = useState(false)
    const [selectedBrowser, setSelectedBrowser] = useState(null)
    const [browserLaunching, setBrowserLaunching] = useState(false)

    useEffect(() => {
        if (step === 1) detectBrowsers()
    }, [step])

    const detectBrowsers = async () => {
        setBrowsersLoading(true)
        try {
            const list = await window.api.detectBrowsers()
            setBrowsers(list || [])
            // Auto-select first available
            const first = (list || []).find(b => b.available)
            if (first) setSelectedBrowser(first.id)
        } catch (err) {
            toast.error("Could not detect browsers.")
        } finally {
            setBrowsersLoading(false)
        }
    }

    const handleLaunchBrowser = async () => {
        if (!selectedBrowser) {
            toast.error("Please select a browser first.")
            return
        }
        setBrowserLaunching(true)
        try {
            await window.api.launchBrowser({ browserType: selectedBrowser })
            goToStep(2)
            const name = browsers.find(b => b.id === selectedBrowser)?.name || selectedBrowser
            toast.success(`${name} launched — navigate to your Sales Navigator list.`)
        } catch (err) {
            toast.error("Failed to launch browser.")
        } finally {
            setBrowserLaunching(false)
        }
    }

    const handleStartScrape = () => {
        startScrape({ ...form, maxLeads: Number(form.maxLeads) || 200 })
    }

    const handleStopScrape = async () => {
        await stopScrape()
        toast("Stop requested — saving scraped leads...")
    }

    const handleDriveUpload = async () => {
        if (!result?.filepath) return
        setUploading(true)
        setDriveStatus(null)
        try {
            const res = await window.api.driveUpload(result.filepath)
            if (res.success) {
                setDriveStatus('success')
                toast.success("Uploaded to Google Drive!")
            } else {
                setDriveStatus('error')
                toast.error("Drive upload failed: " + (res.error || "Unknown error"))
            }
        } catch (err) {
            setDriveStatus('error')
            toast.error("Drive upload error: " + (err?.message || "Unknown"))
        } finally {
            setUploading(false)
        }
    }

    const stepLabels = ["Launch Browser", "Configure", "Scraping", "Complete"]

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header with step indicator */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-8 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">
                            {active ? "Active Scrape" : "New Scrape"}
                        </h2>
                        <p className="text-sm text-muted-foreground">Follow the steps to scrape leads</p>
                    </div>
                    {active && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs font-medium text-green-600">Scraping Active</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-2xl mx-auto space-y-6">
                    {/* Step indicator */}
                    <div className="flex gap-2">
                        {[1, 2, 3, 4].map((s) => (
                            <div key={s} className="flex-1 flex flex-col items-center gap-1">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step > s ? "bg-green-500 text-white"
                                    : step === s ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                    }`}>
                                    {step > s ? <CheckCircle className="w-4 h-4" /> : s}
                                </div>
                                <span className="text-xs text-muted-foreground hidden sm:block">{stepLabels[s - 1]}</span>
                                <div className={`h-1 w-full rounded-full ${step >= s ? "bg-primary" : "bg-muted"}`} />
                            </div>
                        ))}
                    </div>

                    {/* Error banner */}
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                            ❌ {error}
                        </div>
                    )}

                    {/* Step 1: Launch Browser */}
                    {step === 1 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Launch Browser</CardTitle>
                                <CardDescription>
                                    Choose a browser to open with remote debugging for scraping.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {browsersLoading ? (
                                    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm">Detecting browsers...</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 gap-3">
                                            {browsers.map((b) => (
                                                <button
                                                    key={b.id}
                                                    disabled={!b.available}
                                                    onClick={() => setSelectedBrowser(b.id)}
                                                    className={cn(
                                                        "flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                        !b.available && "opacity-35 cursor-not-allowed",
                                                        selectedBrowser === b.id && b.available
                                                            ? "border-primary bg-primary/5 shadow-sm"
                                                            : "border-border hover:border-primary/40 hover:bg-muted/50"
                                                    )}
                                                >
                                                    <BrowserIcon id={b.id} className="w-10 h-10" />
                                                    <div className="text-center">
                                                        <p className="text-sm font-medium leading-tight">{b.name}</p>
                                                        <p className={cn(
                                                            "text-xs mt-0.5",
                                                            b.available ? "text-green-500" : "text-muted-foreground"
                                                        )}>
                                                            {b.available ? "Available" : "Not installed"}
                                                        </p>
                                                    </div>
                                                    {selectedBrowser === b.id && b.available && (
                                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                                    )}
                                                </button>
                                            ))}
                                        </div>

                                        <p className="text-xs text-muted-foreground text-center">
                                            The browser will open with remote debugging enabled on port 9222.
                                        </p>

                                        <div className="flex gap-3">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={detectBrowsers}
                                                className="gap-1.5"
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                                Refresh
                                            </Button>
                                            <Button
                                                className="flex-1"
                                                size="lg"
                                                onClick={handleLaunchBrowser}
                                                disabled={!selectedBrowser || browserLaunching}
                                            >
                                                {browserLaunching
                                                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Launching...</>
                                                    : `Launch ${browsers.find(b => b.id === selectedBrowser)?.name || "Browser"}`
                                                }
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 2: Configure */}
                    {step === 2 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Configure Scrape</CardTitle>
                                <CardDescription>Navigate to your Sales Navigator results first, then configure below.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Search URL <span className="text-muted-foreground text-xs">(Optional)</span></Label>
                                    <Input
                                        placeholder="https://www.linkedin.com/sales/search/..."
                                        value={form.url}
                                        onChange={(e) => setForm(f => ({ ...f, url: e.target.value }))}
                                    />
                                    <p className="text-xs text-muted-foreground">Leave blank to scrape the current open page.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>List Name</Label>
                                    <Input
                                        placeholder="e.g. SaaS Founders — March 2026"
                                        value={form.listName}
                                        onChange={(e) => setForm(f => ({ ...f, listName: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Leads</Label>
                                    <Input
                                        type="number" min="1" max="2000"
                                        value={form.maxLeads}
                                        onChange={(e) => setForm(f => ({ ...f, maxLeads: e.target.value }))}
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <Button variant="outline" onClick={() => goToStep(1)}>← Back</Button>
                                    <Button className="flex-1" size="lg" onClick={handleStartScrape}>
                                        Start Scraping →
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 3: In Progress */}
                    {step === 3 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Scraping in Progress</CardTitle>
                                <CardDescription>You can navigate away — this will keep running in the background.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Progress</span>
                                        <span className="font-medium">{leadsScraped} / {maxLeads} leads</span>
                                    </div>
                                    <Progress value={progress} className="h-3" />
                                    <p className="text-xs text-right text-muted-foreground">{progress.toFixed(1)}%</p>
                                </div>

                                {currentLead && (
                                    <div className="flex items-center gap-2.5 p-3 bg-primary/5 border border-primary/10 rounded-lg">
                                        <User className="h-4 w-4 text-primary shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-xs text-muted-foreground">Currently scraping</p>
                                            <p className="font-medium text-sm truncate">{currentLead}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-muted rounded-lg text-center">
                                        <span className="block text-3xl font-bold">{leadsScraped}</span>
                                        <span className="text-xs text-muted-foreground">Leads Scraped</span>
                                    </div>
                                    <div className="p-4 bg-muted rounded-lg text-center">
                                        <span className="block text-3xl font-bold">{Number(speed).toFixed(1)}</span>
                                        <span className="text-xs text-muted-foreground">Leads / Min</span>
                                    </div>
                                </div>

                                <Button variant="destructive" className="w-full" onClick={handleStopScrape}>
                                    <Square className="w-4 h-4 mr-2" /> Stop & Save
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 4: Complete */}
                    {step === 4 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-green-600">
                                    <CheckCircle className="w-5 h-5" /> Scraping Complete
                                </CardTitle>
                                <CardDescription>Your leads have been saved to a CSV file.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="p-5 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                                    <p className="text-3xl font-bold text-green-600">{result?.totalLeads || leadsScraped || 0}</p>
                                    <p className="text-sm text-green-600 mt-1">Leads scraped successfully</p>
                                </div>

                                <div className="flex gap-3">
                                    <Button className="flex-1" variant="outline"
                                        onClick={() => safeOpenFile(result?.filepath)}
                                        disabled={!result?.filepath}>
                                        <FileText className="w-4 h-4 mr-2" /> Open File
                                    </Button>
                                    <Button className="flex-1" variant="outline"
                                        onClick={handleDriveUpload}
                                        disabled={uploading || !result?.filepath}>
                                        <HardDrive className="w-4 h-4 mr-2" />
                                        {uploading ? "Uploading..." : driveStatus === "success" ? "✓ Uploaded" : "Save to Drive"}
                                    </Button>
                                </div>

                                <Separator />

                                <Button className="w-full" onClick={resetScrape}>
                                    Start Another Scrape
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    )
}
