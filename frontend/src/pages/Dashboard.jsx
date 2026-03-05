import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    BarChart, Bar, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Cell
} from "recharts"
import {
    Users, TrendingUp, Clock, FileText, Zap,
    FolderOpen, File, Activity
} from "lucide-react"
import { useScrape } from "@/contexts/ScrapeContext"
import { toast } from "sonner"

// Custom tooltip for charts
function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
        <div className="bg-card border rounded-lg px-3 py-2 text-sm shadow-lg pointer-events-none">
            <p className="font-medium mb-1 text-foreground">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>
            ))}
        </div>
    )
}

export default function Dashboard() {
    const navigate = useNavigate()
    const { scrapeState } = useScrape()

    const [stats, setStats] = useState({
        totalLeads: 0,
        totalScrapes: 0,
        avgLeadsPerScrape: 0,
        totalTime: 0,
        dailyStats: [],
        weeklyStats: [],
    })
    const [history, setHistory] = useState([])
    const [recentFiles, setRecentFiles] = useState([])

    const safeOpenFile = useCallback(async (filepath) => {
        if (!filepath) return
        const res = await window.api.openFile(filepath)
        if (res && res.found === false) {
            toast.error(res.error || "File not found — it may have been moved or deleted.")
        }
    }, [])

    useEffect(() => {
        loadAll()
    }, [])

    // Refresh stats when a scrape completes
    useEffect(() => {
        if (!scrapeState.active && scrapeState.step === 4) {
            loadAll()
        }
    }, [scrapeState.active, scrapeState.step])

    const loadAll = async () => {
        try {
            const [statsData, historyData, filesData] = await Promise.all([
                window.api.getStats(),
                window.api.getHistory(),
                window.api.getRecentFiles(),
            ])

            const s = statsData || {}
            setStats({
                totalLeads: s.totalLeadsScraped || 0,
                totalScrapes: s.totalScrapes || 0,
                avgLeadsPerScrape: s.totalScrapes > 0 ? Math.round(s.totalLeadsScraped / s.totalScrapes) : 0,
                totalTime: Math.round((s.totalTimeSeconds || 0) / 60),
                dailyStats: (s.dailyStats || []).slice(-14).map(d => ({
                    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    leads: d.leads,
                    scrapes: d.scrapes,
                })),
                weeklyStats: (s.weeklyStats || []).slice(-8).map(w => ({
                    week: new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    leads: w.leads,
                    scrapes: w.scrapes,
                })),
            })
            setHistory(historyData || [])
            setRecentFiles(filesData || [])
        } catch (err) {
            console.error("Dashboard load error:", err)
        }
    }

    const statCards = [
        {
            title: "Total Leads",
            value: stats.totalLeads.toLocaleString(),
            icon: Users,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
            sub: `${stats.totalScrapes} sessions`
        },
        {
            title: "Avg per Session",
            value: stats.avgLeadsPerScrape,
            icon: TrendingUp,
            color: "text-violet-500",
            bg: "bg-violet-500/10",
            sub: "leads / scrape"
        },
        {
            title: "Time Scraped",
            value: `${stats.totalTime}m`,
            icon: Clock,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
            sub: "total minutes"
        },
        {
            title: "Saved Files",
            value: recentFiles.length,
            icon: FileText,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
            sub: "CSV exports"
        },
    ]

    // Placeholder sample chart data if no real data
    const chartData = stats.dailyStats.length > 0
        ? stats.dailyStats
        : Array.from({ length: 7 }, (_, i) => {
            const d = new Date()
            d.setDate(d.getDate() - (6 - i))
            return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), leads: 0, scrapes: 0 }
        })

    return (
        <div className="flex flex-col h-full">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-8 py-4 flex-shrink-0 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
                    <p className="text-sm text-muted-foreground">Your scraping overview</p>
                </div>
                <div className="flex items-center gap-2">
                    {scrapeState.active && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full mr-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs font-medium text-green-600">Scraping: {scrapeState.leadsScraped} leads</span>
                        </div>
                    )}
                    <Button onClick={() => navigate('/scrape')}>
                        <Zap className="mr-2 h-4 w-4" /> Quick Scrape
                    </Button>
                </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">

                {/* Stat Cards */}
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                    {statCards.map((stat) => (
                        <Card key={stat.title}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                                <div className={`p-2 rounded-md ${stat.bg}`}>
                                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stat.value}</div>
                                <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Charts row */}
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                    {/* Daily Leads - Area chart */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                <Activity className="h-4 w-4 text-blue-500" /> Leads (Last 14 Days)
                            </CardTitle>
                            <CardDescription>Daily lead count from all scrapes</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={220}>
                                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.5 }} />
                                    <Area type="monotone" dataKey="leads" name="Leads" stroke="#3b82f6" fill="url(#leadsGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />

                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {/* Weekly Bar chart */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                                <TrendingUp className="h-4 w-4 text-violet-500" /> Weekly Summary
                            </CardTitle>
                            <CardDescription>Leads scraped per week</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart
                                    data={stats.weeklyStats.length > 0 ? stats.weeklyStats : chartData.slice(-4)}
                                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                                    style={{ cursor: 'default' }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis dataKey={stats.weeklyStats.length > 0 ? "week" : "date"} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                                    <Bar
                                        dataKey="leads" name="Leads" fill="#8b5cf6"
                                        radius={[4, 4, 0, 0]} maxBarSize={48}
                                        activeBar={{ fill: '#8b5cf6', opacity: 0.8 }}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>

                {/* Bottom row */}
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-5">
                    {/* Recent Activity */}
                    <Card className="lg:col-span-3">
                        <CardHeader>
                            <CardTitle className="text-sm font-semibold">Recent Sessions</CardTitle>
                            <CardDescription>Your last scrape sessions</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {history.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                                    <Clock className="h-8 w-8 mb-3 opacity-30" />
                                    <p className="text-sm">No sessions yet</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {history.slice(0, 6).map((item, i) => (
                                        <div
                                            key={i}
                                            className="flex items-center justify-between py-2 px-2 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
                                            onClick={() => safeOpenFile(item.filepath)}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="p-1.5 bg-blue-500/10 rounded-full flex-shrink-0">
                                                    <File className="h-3.5 w-3.5 text-blue-500" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-medium text-sm truncate">{item.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                        {item.count ? ` · ${item.count} leads` : ""}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" className="shrink-0 text-xs">Open</Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => navigate('/scrape')}>
                                <Zap className="mr-2 h-4 w-4 text-blue-500" /> New Scrape
                            </Button>
                            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => window.api.openOutputFolder()}>
                                <FolderOpen className="mr-2 h-4 w-4 text-emerald-500" /> Open Output Folder
                            </Button>
                            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => navigate('/history')}>
                                <Clock className="mr-2 h-4 w-4 text-violet-500" /> View History
                            </Button>
                            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => window.api.openLogsFolder()}>
                                <FileText className="mr-2 h-4 w-4 text-amber-500" /> View Logs
                            </Button>
                        </CardContent>
                    </Card>
                </div>

            </div>
        </div>
    )
}
