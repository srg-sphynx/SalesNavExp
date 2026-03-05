import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Link2, Cpu, Info } from "lucide-react"

export function AboutModal({ open, onClose }) {
    const [sysInfo, setSysInfo] = useState(null)

    useEffect(() => {
        if (open) {
            window.api.getSystemInfo?.().then(setSysInfo).catch(() => { })
        }
    }, [open])

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl border-border/60">
                {/* Gradient hero */}
                <div className="relative h-28 bg-gradient-to-br from-blue-600 via-violet-600 to-indigo-800 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/10" />
                    <div className="relative flex flex-col items-center gap-2">
                        <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shadow-lg border border-white/20">
                            <Link2 className="w-7 h-7 text-white" />
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4">
                    <DialogHeader className="space-y-0.5">
                        <DialogTitle className="text-xl font-bold tracking-tight text-center">
                            LinkedIn Scraper
                        </DialogTitle>
                        <p className="text-center text-sm text-muted-foreground font-medium">Version 3.1.0</p>
                    </DialogHeader>

                    {/* Chip info */}
                    {sysInfo && (
                        <div className="flex items-center justify-center gap-2 px-3 py-2 bg-muted/60 rounded-lg">
                            <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground font-mono">
                                {sysInfo.chip}
                                {sysInfo.totalMemGB ? ` · ${sysInfo.totalMemGB} GB` : ""}
                            </span>
                        </div>
                    )}

                    <div className="space-y-2 pt-1">
                        <Row label="Built by" value="Reddy" />
                        <Row label="Powered by" value="Antigravity" highlight />
                        <Row label="AI Model" value="Claude Sonnet 4.5" />
                    </div>

                    <p className="text-[11px] text-muted-foreground/60 text-center pt-2 pb-1">
                        © 2026 LinkedIn Scraper. All rights reserved.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function Row({ label, value, highlight }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`text-xs font-semibold ${highlight ? "bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent" : "text-foreground"}`}>
                {value}
            </span>
        </div>
    )
}
