import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"

const ScrapeContext = createContext(null)

export function useScrape() {
    return useContext(ScrapeContext)
}

export function ScrapeProvider({ children }) {
    const [scrapeState, setScrapeState] = useState({
        active: false,
        step: 1,           // 1=launch, 2=config, 3=scraping, 4=done
        progress: 0,
        leadsScraped: 0,
        speed: 0,
        currentLead: "",
        maxLeads: 200,
        listName: "",
        url: "",
        result: null,      // { totalLeads, filepath }
        error: null,
    })

    const listenerSetup = useRef(false)

    // Set up the progress listener ONCE at the app level
    useEffect(() => {
        if (listenerSetup.current) return
        listenerSetup.current = true

        window.api.onProgress((data) => {
            if (data.phase === "starting") {
                setScrapeState(s => ({ ...s, active: true, step: 3, progress: 0 }))

            } else if (data.phase === "scraping") {
                setScrapeState(s => {
                    const max = s.maxLeads || 200
                    const pct = Math.min((data.leadsScraped / max) * 100, 100)
                    return {
                        ...s,
                        active: true,
                        step: 3,
                        progress: pct,
                        leadsScraped: data.leadsScraped || 0,
                        speed: data.speed || 0,
                        currentLead: data.name || s.currentLead,
                    }
                })

            } else if (data.phase === "complete") {
                setScrapeState(s => ({
                    ...s,
                    active: false,
                    step: 4,
                    progress: 100,
                    result: { totalLeads: data.totalLeads || s.leadsScraped, filepath: data.filepath },
                    error: null,
                }))
                toast.success(`✅ Scrape complete! ${data.totalLeads || 0} leads saved.`, {
                    duration: 8000,
                    action: data.filepath ? {
                        label: "Open File",
                        onClick: () => window.api.openFile(data.filepath)
                    } : undefined
                })

            } else if (data.phase === "stopped") {
                setScrapeState(s => ({
                    ...s,
                    active: false,
                    step: 4,
                    progress: 100,
                    result: { totalLeads: data.totalLeads || s.leadsScraped, filepath: data.filepath },
                    error: null,
                }))
                toast(`⏹ Scrape stopped — ${data.totalLeads || 0} leads saved.`, {
                    duration: 6000,
                    action: data.filepath ? {
                        label: "Open File",
                        onClick: () => window.api.openFile(data.filepath)
                    } : undefined
                })
            }
        })

        window.api.onIssue?.((issue) => {
            if (issue.type === "fatal" || issue.type === "error") {
                setScrapeState(s => ({
                    ...s,
                    active: false,
                    step: 2,
                    error: issue.message,
                }))
                toast.error(`Scrape error: ${issue.message}`, { duration: 10000 })
            }
        })
    }, [])

    // Restore active session on app load
    useEffect(() => {
        const restoreSession = async () => {
            try {
                const status = await window.api.getScrapeStatus()
                if (status?.isActive) {
                    setScrapeState(s => ({
                        ...s,
                        active: true,
                        step: 3,
                        leadsScraped: status.leadsCount || 0,
                        progress: status.progress
                            ? Math.min((status.progress.leadsScraped / (status.progress.maxLeads || 200)) * 100, 100)
                            : 0,
                    }))
                }
            } catch { }
        }
        restoreSession()
    }, [])

    const startScrape = useCallback(async (form) => {
        setScrapeState(s => ({
            ...s,
            active: true,
            step: 3,
            progress: 0,
            leadsScraped: 0,
            speed: 0,
            currentLead: "",
            maxLeads: form.maxLeads || 200,
            listName: form.listName || "",
            url: form.url || "",
            result: null,
            error: null,
        }))

        window.api.startScraping({ ...form, maxLeads: Number(form.maxLeads) || 200 })
            .then((result) => {
                if (result && !result.success && result.error && !result.partialSave) {
                    setScrapeState(s => ({ ...s, active: false, step: 2, error: result.error }))
                    toast.error(`❌ ${result.error}`, { duration: 10000 })
                }
            })
            .catch((err) => {
                setScrapeState(s => ({ ...s, active: false, step: 2, error: err?.message || "Unknown error" }))
                toast.error(`❌ Scraping failed: ${err?.message || "Unknown error"}`, { duration: 10000 })
            })
    }, [])

    const stopScrape = useCallback(async () => {
        await window.api.stopScraping()
    }, [])

    const resetScrape = useCallback(() => {
        setScrapeState({
            active: false, step: 1, progress: 0, leadsScraped: 0,
            speed: 0, currentLead: "", maxLeads: 200, listName: "", url: "",
            result: null, error: null,
        })
    }, [])

    const goToStep = useCallback((step) => {
        setScrapeState(s => ({ ...s, step }))
    }, [])

    return (
        <ScrapeContext.Provider value={{ scrapeState, startScrape, stopScrape, resetScrape, goToStep }}>
            {children}
        </ScrapeContext.Provider>
    )
}
