import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { useScrape } from "@/contexts/ScrapeContext"
import { AboutModal } from "@/components/AboutModal"
import {
    LayoutDashboard,
    Zap,
    Clock,
    FolderOpen,
    Settings,
    Link2,
    Info,
    Radio
} from "lucide-react"

export function Sidebar() {
    const location = useLocation()
    const { scrapeState } = useScrape()
    const isActive = scrapeState?.active === true
    const [aboutOpen, setAboutOpen] = useState(false)

    const sidebarItems = [
        { icon: LayoutDashboard, label: "Dashboard", path: "/" },
        {
            icon: isActive ? Radio : Zap,
            label: isActive ? "Active Scrape" : "New Scrape",
            path: "/scrape",
            pulse: isActive
        },
        { icon: Clock, label: "History", path: "/history" },
        { icon: FolderOpen, label: "Files", path: "/files" },
        { icon: Settings, label: "Settings", path: "/settings" },
    ]

    return (
        <>
            <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

            <div className="w-56 border-r bg-card flex flex-col flex-shrink-0 h-full">
                {/* Full-width drag region at the top of sidebar */}
                <div
                    className="h-10 w-full flex-shrink-0 select-none"
                    style={{ WebkitAppRegion: "drag" }}
                />

                {/* Brand */}
                <div className="px-5 pb-4 flex items-center gap-2 flex-shrink-0">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white flex-shrink-0">
                        <Link2 className="w-4 h-4" />
                    </div>
                    <h1 className="font-semibold text-base bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-violet-600 truncate">
                        Scraper V3.1
                    </h1>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
                    {sidebarItems.map((item) => {
                        const active = location.pathname === item.path
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                    active
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                <div className="relative flex-shrink-0">
                                    <item.icon className="w-4 h-4" />
                                    {item.pulse && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    )}
                                </div>
                                <span className={cn(item.pulse && "text-green-500 dark:text-green-400")}>
                                    {item.label}
                                </span>
                            </Link>
                        )
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t flex-shrink-0 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">v3.1.0</p>
                    <button
                        onClick={() => setAboutOpen(true)}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                        title="About LinkedIn Scraper"
                    >
                        <Info className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </>
    )
}
