import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, FolderOpen, RefreshCw } from "lucide-react"
import { safeOpenFile } from "@/lib/safeOpenFile"

export default function FilesPage() {
    const [files, setFiles] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadFiles()
    }, [])

    const loadFiles = async () => {
        setLoading(true)
        try {
            const data = await window.api.getRecentFiles()
            setFiles(data || [])
        } catch (err) {
            console.error("Failed to load files:", err)
            setFiles([])
        } finally {
            setLoading(false)
        }
    }

    const formatSize = (bytes) => {
        if (!bytes) return ""
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-8 py-4 flex-shrink-0 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Files</h2>
                    <p className="text-sm text-muted-foreground">Your saved lead exports</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={loadFiles}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.api.openOutputFolder()}>
                        <FolderOpen className="mr-2 h-4 w-4" /> Open Folder
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Exports</CardTitle>
                        <CardDescription>All CSV files saved by the scraper. If a file is missing, you'll be notified.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center py-12 text-muted-foreground">
                                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                                Loading files...
                            </div>
                        ) : files.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                                <FileText className="h-12 w-12 mb-4 opacity-20" />
                                <p className="text-lg font-medium">No files yet</p>
                                <p className="text-sm">Run a scrape to generate your first file.</p>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {files.map((file, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between py-3 px-2 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
                                        onClick={() => safeOpenFile(file.path || file.filepath)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-emerald-500/10 rounded-full">
                                                <FileText className="h-4 w-4 text-emerald-500" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{file.name || file.filename}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {file.date ? new Date(file.date).toLocaleDateString('en-US', {
                                                        year: 'numeric', month: 'short', day: 'numeric'
                                                    }) : ""}
                                                    {file.size ? ` • ${formatSize(file.size)}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost" size="sm"
                                            onClick={(e) => { e.stopPropagation(); safeOpenFile(file.path || file.filepath) }}
                                        >
                                            Open
                                        </Button>
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
