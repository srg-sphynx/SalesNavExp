import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { FileText, Search, FolderOpen, Clock, Trash2, AlertTriangle } from "lucide-react"
import { safeOpenFile } from "@/lib/safeOpenFile"
import { toast } from "sonner"

// Group history items by calendar day
function groupByDay(items) {
    const groups = {}
    items.forEach(item => {
        const date = item.date ? new Date(item.date) : null
        let key = "Unknown Date"
        if (date) {
            const today = new Date()
            const yesterday = new Date()
            yesterday.setDate(today.getDate() - 1)

            if (date.toDateString() === today.toDateString()) key = "Today"
            else if (date.toDateString() === yesterday.toDateString()) key = "Yesterday"
            else {
                key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
            }
        }
        if (!groups[key]) groups[key] = []
        groups[key].push(item)
    })
    return groups
}

export default function HistoryPage() {
    const [history, setHistory] = useState([])
    const [searchTerm, setSearchTerm] = useState("")
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadHistory()
    }, [])

    const loadHistory = async () => {
        setLoading(true)
        try {
            const data = await window.api.getHistory()
            setHistory(data || [])
        } catch (err) {
            console.error("Failed to load history:", err)
            setHistory([])
        } finally {
            setLoading(false)
        }
    }

    const handleClearHistory = async () => {
        try {
            await window.api.clearHistory()
            setHistory([])
            toast.success("History cleared.")
        } catch (err) {
            toast.error("Failed to clear history.")
        }
    }

    const filtered = history.filter(item =>
        !searchTerm ||
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.filename?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const grouped = groupByDay(filtered)
    const dayKeys = Object.keys(grouped)

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-8 py-4 flex-shrink-0 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">History</h2>
                    <p className="text-sm text-muted-foreground">Your past scraping sessions</p>
                </div>
                <div className="flex items-center gap-2">
                    {history.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30">
                                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear History
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle className="flex items-center gap-2">
                                        <AlertTriangle className="w-5 h-5 text-destructive" />
                                        Clear All History?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will remove all {history.length} scrape session records from the history log.
                                        Your CSV files on disk will <strong>not</strong> be deleted.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleClearHistory}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                        Clear History
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <Button variant="outline" size="sm" onClick={() => window.api.openOutputFolder()}>
                        <FolderOpen className="mr-2 h-4 w-4" /> Output Folder
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Scrape Sessions</CardTitle>
                                <CardDescription>Click a row to reveal the file in Finder.</CardDescription>
                            </div>
                            <div className="relative w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search..."
                                    className="pl-8"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center py-12 text-muted-foreground">
                                <Clock className="h-6 w-6 animate-spin mr-2" />
                                Loading...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                                <Clock className="h-12 w-12 mb-4 opacity-20" />
                                <p className="text-lg font-medium">No history yet</p>
                                <p className="text-sm">Complete a scrape to see it here.</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {dayKeys.map(day => (
                                    <div key={day}>
                                        {/* Day group header */}
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                                                {day}
                                            </span>
                                            <div className="flex-1 h-px bg-border" />
                                        </div>

                                        {/* Items for this day */}
                                        <div className="divide-y rounded-lg border overflow-hidden">
                                            {grouped[day].map((item, index) => (
                                                <HistoryRow key={item.id || index} item={item} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

function HistoryRow({ item }) {
    const [fileState, setFileState] = useState("unknown") // 'unknown' | 'exists' | 'missing'

    useEffect(() => {
        if (item.filepath) {
            window.api.openFile(item.filepath)
                .then(res => setFileState(res.found ? "exists" : "missing"))
                .catch(() => setFileState("missing"))
        }
    }, [item.filepath])

    const handleOpen = async (e) => {
        e?.stopPropagation?.()
        const res = await safeOpenFile(item.filepath)
        if (res && res.found === false) setFileState("missing")
    }

    return (
        <div
            className="flex items-center justify-between py-3 px-3 hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={handleOpen}
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-full flex-shrink-0 ${fileState === "missing" ? "bg-red-500/10" : "bg-primary/10"}`}>
                    <FileText className={`h-4 w-4 ${fileState === "missing" ? "text-red-400" : "text-primary"}`} />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{item.name || "Unnamed List"}</p>
                        {fileState === "missing" && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 flex-shrink-0">
                                File missing
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {item.date ? new Date(item.date).toLocaleTimeString('en-US', {
                            hour: '2-digit', minute: '2-digit'
                        }) : "Unknown time"}
                        {item.count ? ` · ${item.count} leads` : ""}
                    </p>
                </div>
            </div>
            <Button
                variant="ghost" size="sm"
                disabled={fileState === "missing"}
                onClick={handleOpen}
                className="flex-shrink-0"
            >
                {fileState === "missing" ? "Missing" : "Open"}
            </Button>
        </div>
    )
}
